import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, id, keccak256 } from 'ethers';
import { encodeCall, REGISTER_ENTRY_TYPES } from '../src/codec/abi.ts';
import { RpcHistoryEntitlementReader, type HistoryPrincipal } from '../src/controls/historyEntitlement.ts';
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
const namespace={tenant:'synthetic',origin:'https://wallet.example.invalid'};
function fixture(count=2,limits:{blocksPerRequest?:bigint;maximumWindows?:bigint;maximumRecords?:bigint;maximumRetainedLegs?:bigint}={}) {
  const authenticated:HistoryPrincipal={...namespace,username:'tester',account:a('8'),chainId:'560048'};
  let accountReads=0;
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
  const flags={accountCreated:true,factoryAccount:a('4'),accountOwner:a('8'),accountController:pin.controller,
    accountRegistered:true,accountCode:'0x60006002',secondAccount:null as string|null,appendedOverride:null as bigint|null,activeLegId:h('f'),owner:a('7'),holder:a('4'),holderIndex:1n,entry,bindingAvailable:true,bindingDigest:null as string|null,
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
      return params[0]===flags.factoryAccount||params[0]===flags.secondAccount?flags.accountCode:params[0]===a('6')?flags.tokenCode:typeof at==='object'&&at.blockHash===eventHash?flags.eventCode:code;
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
      if(tx.to===pin.controller&&is('accountOf(address)',['address'],[a('8')]))
        return abi.encode(['address'],[flags.accountCreated?(++accountReads>1&&flags.secondAccount!==null?flags.secondAccount:flags.factoryAccount):a('0')]);
      if(tx.to===pin.controller&&
        [flags.factoryAccount,flags.secondAccount].some(x=>x!==null&&is('registeredAccount(address)',['address'],[x])))
        return abi.encode(['bool'],[flags.accountRegistered]);
      if(tx.to===flags.factoryAccount||tx.to===flags.secondAccount){
        if(is('owner()',[],[]))return abi.encode(['address'],[flags.accountOwner]);
        if(is('controller()',[],[]))return abi.encode(['address'],[flags.accountController]);
      }
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
  return {flags,calls,records,provider,authenticated,reader:new RpcHistoryEntitlementReader(provider,pin,namespace,authenticated,limits)};
}
const query=()=>({asset:{chainId:560048n,contract:a('6'),tokenId:7n},sequenceId,fromBlock:0n,anchor:anchor()});
const resolve=(f:ReturnType<typeof fixture>)=>f.reader.resolveAt(query());

test('authenticated factory account is bound to a unique complete-history occurrence at the exact anchor',async()=>{
  const f=fixture(2),r=await resolve(f);assert.equal(r.kind,'bound');
  if(r.kind!=='bound')assert.fail('synthetic unique entitlement expected');
  assert.equal(r.controlledAccount,a('4'));assert.equal(r.ownPosition,1n);
  assert.equal(r.ownOccurrenceId,r.source.snapshot.legs[0]!.buyerOccurrenceId);
  assert.equal(r.principal.account,a('8'));assert.equal(r.accountRuntimeCodeHash,keccak256(f.flags.accountCode));
  assert.equal(r.canExecute,false);assert.equal(r.displayMilestone,'not-evaluated');
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.principal)&&Object.isFrozen(r.asset));
});
test('origin occurrence and live-tail occurrence retain their absolute positions',async()=>{
  const origin=fixture(1);origin.flags.factoryAccount=a('3');const first=await resolve(origin);
  assert.equal(first.kind,'bound');if(first.kind!=='bound')assert.fail();
  assert.equal(first.ownPosition,0n);assert.equal(first.ownOccurrenceId,first.source.snapshot.initialOccurrenceId);
  const tail=fixture(2);tail.flags.factoryAccount=a('7');const last=await resolve(tail);
  assert.equal(last.kind,'bound');if(last.kind!=='bound')assert.fail();
  assert.equal(last.ownPosition,3n);assert.equal(last.ownOccurrenceId,last.source.snapshot.legs[2]!.buyerOccurrenceId);
});
test('repeated controlled account occurrences are ambiguous rather than first-address or last-address selection',async()=>{
  const f=fixture(3),r=await resolve(f);assert.equal(r.kind,'ambiguous');
  if(r.kind!=='ambiguous')assert.fail();assert.equal(r.ownedOccurrenceCount,2n);
  assert.equal(Object.hasOwn(r,'ownOccurrenceId'),false);assert.equal(Object.hasOwn(r,'source'),false);
  assert.equal(Object.hasOwn(r,'controlledAccount'),false);
});
test('a repeated origin account is not confused with a later equal-address occurrence',async()=>{
  const f=fixture(2);f.flags.factoryAccount=a('3');const r=await resolve(f);
  assert.equal(r.kind,'ambiguous');if(r.kind!=='ambiguous')assert.fail();
  assert.equal(r.ownedOccurrenceCount,2n);
});
test('a missing factory account is a scoped not-covered fact without any sequence or log scan',async()=>{
  const f=fixture(2);f.flags.accountCreated=false;const r=await resolve(f);
  assert.equal(r.kind,'not-covered');if(r.kind!=='not-covered')assert.fail();assert.equal(r.reason,'account-not-created');
  assert.equal(f.calls.some(x=>x.method==='eth_getLogs'||x.method==='eth_getTransactionReceipt'),false);
  assert.equal(f.calls.some(x=>x.method==='eth_call'&&
    (x.params[0] as {data:string}).data.slice(0,10)===encodeCall('sequence(bytes32)',['bytes32'],[sequenceId]).slice(0,10)),false);
});
test('a registered owned account absent from this sequence cannot enumerate its parties',async()=>{
  const f=fixture(2);f.flags.factoryAccount=a('9');const r=await resolve(f);
  assert.equal(r.kind,'not-covered');if(r.kind!=='not-covered')assert.fail();assert.equal(r.reason,'no-owned-occurrence');
  for(const name of ['source','snapshot','ownOccurrenceId','controlledAccount'])assert.equal(Object.hasOwn(r,name),false);
});
test('factory registration, real owner, controller and account code are independent checks',async()=>{
  for(const change of [{accountRegistered:false},{accountOwner:a('9')},{accountController:a('9')},{accountCode:'0x'}]){
    const f=fixture(2);Object.assign(f.flags,change);await assert.rejects(resolve(f),/CONTROL_ENTITLEMENT_ACCOUNT_REFUSED/);
    assert.equal(f.calls.some(x=>x.method==='eth_getLogs'),false);
  }
});
test('configured namespace and canonical account/chain shape are required at principal capture',()=>{
  const base={...namespace,username:'tester',account:a('8'),chainId:'560048'};
  for(const change of [{tenant:'other'},{origin:'https://other.example.invalid'},{username:''},{account:a('0')},
    {chainId:'0560048'},{chainId:'1'},{chainId:'0'},{chainId:560048},{origin:namespace.origin+'/path'}]){
    const f=fixture(2);assert.throws(()=>new RpcHistoryEntitlementReader(f.provider,pin,namespace,{...base,...change} as any),
      /CONTROL_ENTITLEMENT_PRINCIPAL_REFUSED/);assert.equal(f.calls.length,0);
  }
});
test('accessor-backed principal and query fields cannot become server-owned authority',async()=>{
  const f=fixture(2),p={...namespace,username:'tester',chainId:'560048'};let invoked=0;
  Object.defineProperty(p,'account',{enumerable:true,get(){invoked++;return a('8');}});
  assert.throws(()=>new RpcHistoryEntitlementReader(f.provider,pin,namespace,p as any),/CONTROL_ENTITLEMENT_SCHEMA_REFUSED/);
  const q=query();Object.defineProperty(q,'sequenceId',{enumerable:true,get(){invoked++;return sequenceId;}});
  await assert.rejects(f.reader.resolveAt(q),/CONTROL_ENTITLEMENT_SCHEMA_REFUSED/);assert.equal(invoked,0);
  assert.equal(f.calls.length,0);
});
test('query chain, asset and source must match rather than just the same occurrence hash',async()=>{
  const f=fixture(2);await assert.rejects(f.reader.resolveAt({...query(),asset:{...query().asset,chainId:1n}}),
    /CONTROL_ENTITLEMENT_QUERY_REFUSED/);assert.equal(f.calls.length,0);
  for(const asset of [{chainId:560048n,contract:a('9'),tokenId:7n},{chainId:560048n,contract:a('6'),tokenId:8n}]){
    const g=fixture(2);await assert.rejects(g.reader.resolveAt({...query(),asset}),/CONTROL_ENTITLEMENT_SOURCE_REFUSED/);
  }
});
test('captured principal and original provider method cannot be swapped after construction',async()=>{
  const f=fixture(2);(f.authenticated as any).account=a('9');(f.authenticated as any).tenant='other';
  f.provider.request=async()=>{throw Error('REPLACED_UNTRUSTED_PROVIDER');};
  const r=await resolve(f);assert.equal(r.kind,'bound');assert.equal(r.principal.account,a('8'));assert.equal(r.principal.tenant,'synthetic');
});
test('query asset and anchor are copied before the first awaited chain response',async()=>{
  const f=fixture(2),q=query();let once=false;
  f.flags.onRequest=()=>{if(once)return;once=true;q.asset.tokenId=8n;q.anchor.blockHash=h('f');};
  const r=await f.reader.resolveAt(q);assert.equal(r.kind,'bound');assert.equal(r.asset.tokenId,7n);
  assert.equal(r.anchor.blockHash,anchorHash);
});
test('same-anchor factory/account code is re-read after history before entitlement is returned',async()=>{
  for(const change of ['mapping','code','owner']){
    const f=fixture(2);
    f.flags.onRequest=method=>{
      if(method!=='eth_call')return;const tx=f.calls.at(-1)!.params[0] as {data:string};
      if(tx.data!==encodeCall('admissionBinding(bytes32,uint64)',['bytes32','uint64'],[sequenceId,1n]))return;
      if(change==='mapping')f.flags.secondAccount=a('9');
      if(change==='code')f.flags.accountCode='0x6001';
      if(change==='owner')f.flags.accountOwner=a('9');
    };
    await assert.rejects(resolve(f),/CONTROL_ENTITLEMENT_ACCOUNT_(CHANGED|REFUSED)/);
  }
});
test('unavailable admitted evidence is not promoted to a verified progress milestone by entitlement',async()=>{
  const f=fixture(2);f.flags.bindingAvailable=false;const r=await resolve(f);assert.equal(r.kind,'bound');
  if(r.kind!=='bound')assert.fail();assert.deepEqual(r.source.evidence,{kind:'unavailable'});
  assert.equal(r.displayMilestone,'not-evaluated');assert.equal(r.canExecute,false);
});
test('late canonical chain/hash changes reject the entire entitlement without an alternative source',async()=>{
  for(const mode of ['chain','hash']){
    const f=fixture(2);
    f.flags.onRequest=method=>{
      if(method!=='eth_call')return;const tx=f.calls.at(-1)!.params[0] as {data:string};
      if(tx.data!==encodeCall('admissionBinding(bytes32,uint64)',['bytes32','uint64'],[sequenceId,1n]))return;
      if(mode==='chain')f.flags.chainSwitchAt=0;else f.flags.anchorReorgAt=0;
    };
    await assert.rejects(resolve(f),/CONTROL_CHAIN_MISMATCH|CONTROL_HISTORY_REORGED|CONTROL_ENTITLEMENT_REORGED/);
  }
});
test('only actual read RPCs are used and raw neighbor identity data is never a successful unbound result',async()=>{
  const f=fixture(3),r=await resolve(f);assert.equal(r.kind,'ambiguous');
  assert.ok(f.calls.every(x=>['eth_chainId','eth_getCode','eth_getBlockByNumber','eth_call','eth_getLogs','eth_getTransactionReceipt'].includes(x.method)));
  assert.equal(f.calls.some(x=>x.method==='eth_getBlockByNumber'&&x.params[0]==='latest'),false);
  const serialized=JSON.stringify(r,(_k,v)=>typeof v==='bigint'?v.toString():v);
  for(const party of [a('3'),a('4'),a('7')])assert.equal(serialized.includes(party),false);
});
