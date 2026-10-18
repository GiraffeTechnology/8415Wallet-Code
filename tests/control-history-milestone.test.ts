import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, id, keccak256 } from 'ethers';
import { encodeCall, REGISTER_ENTRY_TYPES } from '../src/codec/abi.ts';
import { RpcHistoryEntitlementReader, type HistoryPrincipal } from '../src/controls/historyEntitlement.ts';
import { RpcHistoryMilestoneValidator } from '../src/controls/historyMilestone.ts';
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



async function setup(count=2){
  const f=fixture(count),admitted=await f.reader.resolveAt(query());
  assert.equal(admitted.kind,'bound');if(admitted.kind!=='bound')assert.fail();
  const milestone=structuredClone(buildForwardProgress(admitted.source.snapshot,admitted.source.evidence,admitted.ownOccurrenceId));
  const input={principal:{...f.authenticated},asset:{chainId:'560048',contract:a('6'),tokenId:'7'},sequenceId,
    ownOccurrenceId:admitted.ownOccurrenceId,milestone};
  const validator=new RpcHistoryMilestoneValidator(f.provider,pin,namespace,0n);
  f.calls.length=0;return {f,input,validator};
}
test('frozen DONE is rebuilt from actual same-anchor entitlement and full admitted state',async()=>{
  const {f,input,validator}=await setup();assert.equal(input.milestone.state,'DONE');
  assert.equal(await validator.validateMilestone(input),true);
  assert.ok(f.calls.some(x=>x.method==='eth_getLogs'));
  assert.ok(f.calls.some(x=>x.method==='eth_call'));
  assert.ok(f.calls.every(x=>!['eth_sendTransaction','eth_sendRawTransaction','personal_sign','eth_sign'].includes(x.method)));
});
test('every public milestone field is independently compared, including unchanged full-chain scale',async()=>{
  for(const change of [{knownEnd:'2'},{scaleEnd:'9'},{userPosition:'2'},{sourceRevision:'0'},
    {protocolFinality:true},{funds:{state:'complete'}},{rollback:{state:'complete'}},
    {owner:{state:'observed',position:'8'}},{holder:{state:'observed',position:'2'}},
    {commercialExecution:'complete'},{freshness:'verified'},{recordRevision:'1'},{frozen:true}]){
    const {input,validator}=await setup();Object.assign(input.milestone as any,change);
    assert.equal(await validator.validateMilestone(input),false);
  }
});
test('harmless object key order is not authority or a false mismatch',async()=>{
  const {input,validator}=await setup();
  input.milestone=Object.fromEntries(Object.entries(input.milestone).reverse()) as typeof input.milestone;
  assert.equal(await validator.validateMilestone(input),true);
});
test('unbound, malformed and non-DONE submitted records cannot establish a milestone',async()=>{
  for(const change of [{state:'PENDING'},{state:'UNAVAILABLE'},{canExecute:true},{schema:'forged'},
    {blockNumber:'016'},{blockNumber:16},{blockHash:h('0')}]){
    const {f,input,validator}=await setup();Object.assign(input.milestone as any,change);
    await assert.rejects(validator.validateMilestone(input),/CONTROL_MILESTONE_BINDING_REFUSED/);
    assert.equal(f.calls.length,0);
  }
});
test('wrong NFT, sequence or own occurrence is not interchangeable with matching display positions',async()=>{
  const wrongAsset=await setup();wrongAsset.input.asset.tokenId='8';
  await assert.rejects(wrongAsset.validator.validateMilestone(wrongAsset.input),/CONTROL_ENTITLEMENT_SOURCE_REFUSED/);
  const wrongOwn=await setup();wrongOwn.input.ownOccurrenceId=h('e');
  assert.equal(await wrongOwn.validator.validateMilestone(wrongOwn.input),false);
  const wrongSequence=await setup();wrongSequence.input.milestone={...wrongSequence.input.milestone,sequenceId:h('e')};
  assert.equal(await wrongSequence.validator.validateMilestone(wrongSequence.input),false);
});
test('namespace and actual principal remain bound, not authenticated by submitted JSON',async()=>{
  for(const change of [{tenant:'other'},{origin:'https://other.example.invalid'},{account:a('9')},{chainId:'1'}]){
    const {f,input,validator}=await setup();Object.assign(input.principal,change);
    await assert.rejects(validator.validateMilestone(input),/CONTROL_(ENTITLEMENT_PRINCIPAL|MILESTONE_BINDING)_REFUSED/);
    assert.equal(f.calls.length,0);
  }
});
test('lost factory ownership or a different admission holder cannot preserve cached DONE',async()=>{
  const owner=await setup();owner.f.flags.accountOwner=a('9');
  await assert.rejects(owner.validator.validateMilestone(owner.input),/CONTROL_ENTITLEMENT_ACCOUNT_REFUSED/);
  const holder=await setup();holder.f.flags.bindingAvailable=false;
  assert.equal(await holder.validator.validateMilestone(holder.input),false);
  const currentOwner=await setup();currentOwner.f.flags.owner=a('9');
  assert.equal(await currentOwner.validator.validateMilestone(currentOwner.input),false);
});
test('an unowned or multiple-owned occurrence source is not a valid milestone',async()=>{
  const unowned=await setup();unowned.f.flags.factoryAccount=a('9');
  assert.equal(await unowned.validator.validateMilestone(unowned.input),false);
  const repeated=fixture(3),baseline=await setup();
  const validator=new RpcHistoryMilestoneValidator(repeated.provider,pin,namespace,0n);
  assert.equal(await validator.validateMilestone(baseline.input),false);
});
test('reorg, missing archive receipt and controller identity failure never return cached success',async()=>{
  for(const change of [{anchorReorgAt:0},{eventReorgAt:0},{missingReceipt:true},{chainSwitchAt:0},{eventCode:'0x'}]){
    const {f,input,validator}=await setup();Object.assign(f.flags,change);
    await assert.rejects(validator.validateMilestone(input));
  }
});
test('all caller data is copied before first RPC and the configured provider method is captured',async()=>{
  const {f,input,validator}=await setup();let once=false;
  f.flags.onRequest=()=>{if(once)return;once=true;input.asset.tokenId='8';
    (input.milestone as any).knownEnd='900';input.principal.tenant='other';input.ownOccurrenceId=h('f');};
  f.provider.request=async()=>{throw Error('UNTRUSTED_PROVIDER_SWAP');};
  assert.equal(await validator.validateMilestone(input),true);
});
test('getters, hidden extra fields, cycles and oversized nested input are refused without invoking getters',async()=>{
  for(const mode of ['getter','hidden','cycle','array','deep','large'] as const){
    const {f,input,validator}=await setup();let invoked=0;
    if(mode==='getter')Object.defineProperty(input.milestone,'knownEnd',{enumerable:true,get(){invoked++;return '3';}});
    if(mode==='hidden')Object.defineProperty(input.milestone,'verified',{value:true,enumerable:false});
    if(mode==='cycle')(input.milestone as any).loop=input.milestone;
    if(mode==='array')(input.milestone as any).owner=[];
    if(mode==='deep')(input.milestone as any).owner={a:{b:{c:{d:{e:{f:{g:'x'}}}}}}};
    if(mode==='large')(input.milestone as any).owner='x'.repeat(257);
    if(mode==='hidden')assert.equal(await validator.validateMilestone(input),false);
    else await assert.rejects(validator.validateMilestone(input),/CONTROL_MILESTONE_SCHEMA_REFUSED/);
    assert.equal(invoked,0);if(mode!=='hidden')assert.equal(f.calls.length,0);
  }
});
test('the server-selected scan origin is required and never guessed from a record',async()=>{
  const {f,input}=await setup();
  assert.throws(()=>new RpcHistoryMilestoneValidator(f.provider,pin,namespace,-1n),/CONTROL_MILESTONE_NAMESPACE_REFUSED/);
  const validator=new RpcHistoryMilestoneValidator(f.provider,pin,namespace,17n);
  await assert.rejects(validator.validateMilestone(input),/CONTROL_MILESTONE_BINDING_REFUSED/);
  assert.equal(f.calls.length,0);
});
