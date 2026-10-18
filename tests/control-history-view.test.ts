import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, id, keccak256 } from 'ethers';
import { encodeCall, REGISTER_ENTRY_TYPES } from '../src/codec/abi.ts';
import { RpcFullControlHistoryReader } from '../src/controls/historyView.ts';
import { buildForwardProgress } from '../src/wallet/forwardProgress.ts';
import type { Eip1193Provider } from '../src/adapters/signing/eip1193Signer.ts';

// Synthetic definitions, not a deployed/account/chain acceptance record.
const a=(n:string)=>'0x'+n.repeat(40),h=(n:string)=>'0x'+n.repeat(64);
const abi=AbiCoder.defaultAbiCoder(),code='0x60006000',sequenceId=h('1'),anchorHash=h('a'),eventHash=h('b'),txHash=h('c');
const pin={chainId:560048n,controller:a('1'),runtimeCodeHash:keccak256(code)};
const topic=id('LegDetached(bytes32,bytes32,uint256,address,address,bytes32,bytes32,address,bytes32,bytes32)');
const sequenceTypes=['address','uint256','address','address','address','bytes32','bytes32','bytes32',
  'uint256','uint256','uint256','uint256','uint256','bytes32','bool'];
const legTypes=['bytes32','address','address','bytes32','bytes32','address','bytes32','uint8'];
const anchor=()=>({blockNumber:16n,blockHash:anchorHash});
function fixture(count=3,limits:{blocksPerRequest?:bigint;maximumWindows?:bigint;maximumRecords?:bigint;maximumRetainedLegs?:bigint}={}) {
  let commitment=keccak256(abi.encode(['bytes32','bytes32'],[id('8415Wallet/DetachedResponsibilities/v1'),sequenceId]));
  const records=Array.from({length:count},(_,i)=>{
    const r={occurrence:BigInt(i),legId:keccak256(abi.encode(['uint256'],[i+1])),fromAccount:a(i%2===0?'3':'4'),
      toAccount:a(i%2===0?'4':'3'),termsHash:h('2'),acceptanceHash:keccak256(abi.encode(['uint256'],[i+1000])),returnAuthority:a('5'),returnConditionHash:h('4'),
      detachedCommitment:''};
    commitment=keccak256(abi.encode(['bytes32','uint256','bytes32','address','address','bytes32','bytes32','address','bytes32'],
      [commitment,r.occurrence,r.legId,r.fromAccount,r.toAccount,r.termsHash,r.acceptanceHash,r.returnAuthority,r.returnConditionHash]));
    r.detachedCommitment=commitment;return r;
  });
  const finalCommitment=count===0?h('0'):commitment,boundary=a(count%2===0?'3':'4');
  const logs=records.map((r,i)=>({address:pin.controller,topics:[topic,sequenceId,r.legId,abi.encode(['uint256'],[r.occurrence])],
    data:abi.encode(['address','address','bytes32','bytes32','address','bytes32','bytes32'],
      [r.fromAccount,r.toAccount,r.termsHash,r.acceptanceHash,r.returnAuthority,r.returnConditionHash,r.detachedCommitment]),
    removed:false,blockNumber:'0x9',blockHash:eventHash,transactionHash:txHash,transactionIndex:'0x2',logIndex:'0x'+(i+1).toString(16)}));
  const entry=[h('5'),h('6'),h('7'),a('4'),1n,64n,0n];
  const flags={appendedOverride:null as bigint|null,activeLegId:h('f'),owner:a('7'),holder:a('4'),holderIndex:1n,entry,bindingAvailable:true,bindingDigest:null as string|null,
    tokenCode:code,register:h('5'),profile:h('6'),erc165:true,invalid:false,projection:true,settlement:true,
    sequenceRevisionShiftAt:Infinity,logs:structuredClone(logs),receiptLogs:structuredClone(logs),commitment:finalCommitment,boundary,
    receiptStatus:'0x1',receiptHash:eventHash,receiptTransaction:txHash,missingReceipt:false,eventCode:code,terminal:1n,
    failWindow:false,eventReorgAt:Infinity,anchorReorgAt:Infinity,chainSwitchAt:Infinity,
    malformedLogs:null as unknown,onRequest:null as null|((method:string)=>void)};
  const calls:{method:string;params:readonly unknown[]}[]=[];let chains=0,eventReads=0,anchorReads=0,sequenceReads=0;
  const provider:Eip1193Provider={async request({method,params=[]}){
    calls.push({method,params:structuredClone(params)});flags.onRequest?.(method);
    if(method==='eth_chainId')return ++chains>=flags.chainSwitchAt?'0x1':'0x88bb0';
    if(method==='eth_getCode'){
      const at=params[1] as {blockHash?:string};
      return params[0]===a('6')?flags.tokenCode:typeof at==='object'&&at.blockHash===eventHash?flags.eventCode:code;
    }
    if(method==='eth_getBlockByNumber'){
      assert.notEqual(params[0],'latest');
      if(params[0]==='0x10')return {number:'0x10',timestamp:'0x80',hash:++anchorReads>=flags.anchorReorgAt?h('e'):anchorHash};
      assert.equal(params[0],'0x9');return {number:'0x9',timestamp:'0x60',hash:++eventReads>=flags.eventReorgAt?h('e'):eventHash};
    }
    if(method==='eth_call'){
      assert.deepEqual(params[1],{blockHash:anchorHash,requireCanonical:true});
      const tx=params[0] as {to:string;data:string};
      const is=(sig:string,types:readonly string[],values:readonly any[])=>tx.data===encodeCall(sig,types as any,values);
      if(tx.to===a('6')) {
        for(const [interfaceId,supported] of [['0x01ffc9a7',flags.erc165],['0xffffffff',flags.invalid],
          ['0x6309e170',flags.projection],['0xf4a7d71b',flags.settlement]] as const)
          if(is('supportsInterface(bytes4)',['bytes4'],[interfaceId]))return abi.encode(['bool'],[supported]);
        if(is('registerId()',[],[]))return abi.encode(['bytes32'],[flags.register]);
        if(is('verificationProfile()',[],[]))return abi.encode(['bytes32'],[flags.profile]);
        if(is('ownerOf(uint256)',['uint256'],[7n]))return abi.encode(['address'],[flags.owner]);
        if(is('entryAsOf(uint256,uint64)',['uint256','uint64'],[7n,128n]))return abi.encode([...REGISTER_ENTRY_TYPES],flags.entry);
        if(is('holderAsOf(uint256,uint64)',['uint256','uint64'],[7n,128n]))return abi.encode(['address'],[flags.holder]);
        if(is('isFinalAsOf(uint256,uint64)',['uint256','uint64'],[7n,128n]))return abi.encode(['bool'],[false]);
        if(is('openGapOf(uint256)',['uint256'],[7n]))return abi.encode(['bytes32'],[h('0')]);
        throw Error('UNEXPECTED_TOKEN_READ');
      }
      assert.equal(tx.to,pin.controller);
      if(is('admissionBinding(bytes32,uint64)',['bytes32','uint64'],[sequenceId,1n]))
        return abi.encode(['bool','uint256','bytes32'],[flags.bindingAvailable,flags.holderIndex,
          flags.bindingDigest??keccak256(abi.encode([...REGISTER_ENTRY_TYPES].slice(0,6),flags.entry.slice(0,6)))]);
      if(is('sequence(bytes32)',['bytes32'],[sequenceId]))return abi.encode(sequenceTypes,
        [a('6'),7n,a('3'),a('7'),a('5'),h('5'),h('6'),keccak256(code),BigInt(count+5)+(++sequenceReads>=flags.sequenceRevisionShiftAt?1n:0n),BigInt(count+1),BigInt(count),0n,
          flags.appendedOverride??BigInt(count+1),flags.commitment,false]);
      if(is('legCount(bytes32)',['bytes32'],[sequenceId]))return abi.encode(['uint256'],[count+1]);
      if(is('legAt(bytes32,uint256)',['bytes32','uint256'],[sequenceId,BigInt(count)]))return abi.encode(legTypes,
        [flags.activeLegId,boundary,a('7'),h('2'),h('3'),a('5'),h('4'),0n]);
      if(is('inheritedHash(bytes32)',['bytes32'],[sequenceId]))return abi.encode(['bytes32'],[h('8')]);
      if(is('boundaryAccount(bytes32)',['bytes32'],[sequenceId]))return abi.encode(['address'],[flags.boundary]);
      if(records.some(r=>is('legTerminalOutcome(bytes32,bytes32)',['bytes32','bytes32'],[sequenceId,r.legId])))
        return abi.encode(['uint8'],[flags.terminal]);
    }
    if(method==='eth_getLogs'){
      if(flags.failWindow)throw Error('synthetic archive unavailable');
      if(flags.malformedLogs!==null)return flags.malformedLogs;
      const f=params[0] as {address:string;fromBlock:string;toBlock:string;topics:string[]};
      assert.equal(f.address,pin.controller);assert.deepEqual(f.topics,[topic,sequenceId]);
      return BigInt(f.fromBlock)<=9n&&BigInt(f.toBlock)>=9n?flags.logs:[];
    }
    if(method==='eth_getTransactionReceipt'){
      assert.equal(params[0],txHash);if(flags.missingReceipt)return null;
      return {status:flags.receiptStatus,transactionHash:flags.receiptTransaction,blockNumber:'0x9',
        blockHash:flags.receiptHash,transactionIndex:'0x2',logs:flags.receiptLogs};
    }
    throw Error('UNEXPECTED_NON_READ_ONLY_RPC');
  }};
  return {flags,calls,records,reader:new RpcFullControlHistoryReader(provider,pin,limits)};
}
const observe=(f:ReturnType<typeof fixture>,from=0n,at=anchor())=>f.reader.observeAt(sequenceId,from,at);
test('full historical source composes verified detached prefix and live tail at one canonical anchor',async()=>{
  const f=fixture(2),r=await observe(f);
  assert.equal(r.snapshot.initialHolder,a('3'));assert.equal(r.snapshot.legs.length,3);
  assert.deepEqual(r.snapshot.legs.map(x=>x.outcome),['completed','completed','active']);
  assert.equal(r.snapshot.offChainDetached,0n);assert.equal(r.source.detachedCount,2n);
  assert.equal(r.source.appendedCount,3n);assert.equal(r.source.detachedCommitment,f.flags.commitment);
  assert.equal(r.source.principalEntitlement,'not-evaluated');assert.equal(r.source.displayMilestone,'not-evaluated');
  assert.equal(r.source.canExecute,false);assert.equal(r.evidence.kind,'bound');
  if(r.evidence.kind!=='bound')assert.fail('synthetic full binding expected');
  assert.equal(r.evidence.owner.occurrenceId,r.snapshot.legs[2]!.buyerOccurrenceId);
  assert.equal(r.evidence.admittedHolder.occurrenceId,r.snapshot.legs[0]!.buyerOccurrenceId);
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.snapshot)&&Object.isFrozen(r.snapshot.legs)&&
    r.snapshot.legs.every(x=>Object.isFrozen(x)&&Object.isFrozen(x.control)));
});
test('a detached holder occurrence is not replaced with the equal-address origin or boundary',async()=>{
  const f=fixture(3);f.flags.holder=a('3');f.flags.entry[3]=a('3');f.flags.holderIndex=2n;
  const r=await observe(f);assert.equal(r.evidence.kind,'bound');
  if(r.evidence.kind!=='bound')assert.fail('synthetic full binding expected');
  assert.equal(r.evidence.admittedHolder.occurrenceId,r.snapshot.legs[1]!.buyerOccurrenceId);
  assert.notEqual(r.evidence.admittedHolder.occurrenceId,r.snapshot.initialOccurrenceId);
});
test('full-history progress can retain an old user position without cropping the current chain',async()=>{
  const f=fixture(4),r=await observe(f),p=buildForwardProgress(r.snapshot,r.evidence,r.snapshot.legs[0]!.buyerOccurrenceId);
  assert.equal(p.userPosition,'1');assert.equal(p.knownEnd,'5');assert.equal(p.scaleEnd,'6');
  assert.equal(p.state,'DONE');assert.equal(p.holder.position,'1');assert.equal(p.owner.position,'5');
  assert.equal(p.commercialExecution,'not-evaluated');assert.equal(p.canExecute,false);
});
test('130 detached legs remain a readable prefix rather than a 128-leg lifetime cap',async()=>{
  const f=fixture(130),r=await observe(f);assert.equal(r.snapshot.legs.length,131);
  assert.equal(r.source.detachedCount,130n);assert.equal(r.source.appendedCount,131n);
});
test('no detached prefix still uses explicit same-anchor token projections',async()=>{
  const f=fixture(0);f.flags.holder=a('3');f.flags.entry[3]=a('3');f.flags.holderIndex=0n;
  const r=await observe(f);assert.equal(r.snapshot.legs.length,1);assert.equal(r.source.detachedCount,0n);
  assert.equal(r.source.detachedCommitment,h('0'));assert.equal(r.evidence.kind,'bound');
  assert.equal(f.calls.some(x=>x.method==='eth_getLogs'),false);
});
test('an absent admitted binding is unavailable, not an owner-derived holder proof',async()=>{
  const f=fixture(2);f.flags.bindingAvailable=false;
  const r=await observe(f);assert.deepEqual(r.evidence,{kind:'unavailable'});
  assert.equal(r.projection.holder,a('4'));assert.equal(r.projection.protocolFinality,false);
});
test('owner outside the control cursor remains unavailable after a standalone exit',async()=>{
  const f=fixture(2);f.flags.owner=a('9');
  const r=await observe(f);assert.deepEqual(r.evidence,{kind:'unavailable'});
  assert.equal(r.projection.owner,a('9'));
});
test('admitted holder account, immutable entry digest and absolute occurrence are all bound',async()=>{
  for(const change of [{holder:a('9')},{holderIndex:9n},{bindingDigest:h('f')}]){
    const f=fixture(2);Object.assign(f.flags,change);
    await assert.rejects(observe(f),/CONTROL_HISTORY_(ADMISSION_BINDING|OCCURRENCE)_REFUSED/);
  }
});
test('token runtime, register and verification profile cannot drift across composition',async()=>{
  for(const change of [{tokenCode:'0x6001'},{register:h('f')},{profile:h('f')}]){
    const f=fixture(2);Object.assign(f.flags,change);
    await assert.rejects(observe(f),/CONTROL_HISTORY_(TOKEN_IDENTITY|PROJECTION_IDENTITY)_CHANGED/);
  }
});
test('actual historical interface discovery is required, including invalid-interface rejection',async()=>{
  for(const change of [{erc165:false},{invalid:true},{projection:false},{settlement:false}]){
    const f=fixture(2);Object.assign(f.flags,change);
    await assert.rejects(observe(f),/CONTROL_HISTORY_(ERC165|PROJECTION|SETTLEMENT)_UNSUPPORTED/);
  }
});
test('missing detached records never become a truncated successful history',async()=>{
  const f=fixture(2);f.flags.logs.pop();await assert.rejects(observe(f),/CONTROL_PREFIX_INCOMPLETE/);
});
test('separately read same-anchor sequence state must match the independently verified prefix',async()=>{
  const f=fixture(2);f.flags.sequenceRevisionShiftAt=2;
  await assert.rejects(observe(f),/CONTROL_HISTORY_SOURCE_MISMATCH/);
});
test('cross-boundary duplicate leg identities are refused despite separately valid prefix and tail',async()=>{
  const f=fixture(2);f.flags.activeLegId=f.records[0]!.legId;
  await assert.rejects(observe(f),/LINKED_LEG_ID_INVALID/);
});

test('late token/chain/anchor changes after protocol reads cannot return historical success',async()=>{
  for(const mode of ['token','chain','anchor']){
    const f=fixture(2);
    f.flags.onRequest=method=>{
      if(method!=='eth_call')return;
      const last=f.calls.at(-1)!.params[0] as {data:string};
      if(last.data===encodeCall('admissionBinding(bytes32,uint64)',['bytes32','uint64'],[sequenceId,1n])){
        if(mode==='token')f.flags.tokenCode='0x6001';
        if(mode==='chain')f.flags.chainSwitchAt=0;
        if(mode==='anchor')f.flags.anchorReorgAt=0;
      }
    };
    await assert.rejects(observe(f),/CONTROL_HISTORY_TOKEN_IDENTITY_CHANGED|CONTROL_CHAIN_MISMATCH|CONTROL_HISTORY_REORGED/);
  }
});
test('invalid or accessor-backed query anchors are refused before an RPC read',async()=>{
  for(const at of [{blockNumber:-1n,blockHash:anchorHash},{blockNumber:16n,blockHash:h('0')},
    {...anchor(),verified:true},Object.defineProperty({blockHash:anchorHash},'blockNumber',{enumerable:true,get:()=>16n})]){
    const f=fixture(2);await assert.rejects(f.reader.observeAt(sequenceId,0n,at as any),/CONTROL_HISTORY_ANCHOR_REFUSED/);
    assert.equal(f.calls.length,0);
  }
});
test('archive/range failure never switches to latest, an indexer or a transaction RPC',async()=>{
  const f=fixture(2);f.flags.failWindow=true;await assert.rejects(observe(f),/CONTROL_RPC_REFUSED/);
  assert.ok(f.calls.every(x=>['eth_chainId','eth_getCode','eth_getBlockByNumber','eth_call','eth_getLogs','eth_getTransactionReceipt'].includes(x.method)));
  assert.equal(f.calls.some(x=>x.method==='eth_getBlockByNumber'&&x.params[0]==='latest'),false);
});

test('retained-tail resource limit is checked before any unbounded legAt loop',async()=>{
  const f=fixture(2,{maximumRetainedLegs:2n});f.flags.appendedOverride=10000n;
  // Existing controlRpc deliberately sanitizes provider-boundary exceptions.
  // Keep that behavior; the absence of legAt reads proves the bounded refusal.
  await assert.rejects(observe(f),/CONTROL_RPC_REFUSED/);
  assert.equal(f.calls.some(x=>x.method==='eth_call'&&
    (x.params[0] as {data:string}).data.slice(0,10)===encodeCall('legAt(bytes32,uint256)',['bytes32','uint256'],[sequenceId,0n]).slice(0,10)),false);
  for(const n of [0n,-1n,1048577n])
    assert.throws(()=>fixture(2,{maximumRetainedLegs:n}),/CONTROL_HISTORY_RESOURCE_LIMIT_REFUSED/);
});
