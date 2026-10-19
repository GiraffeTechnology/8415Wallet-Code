import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, id, keccak256 } from 'ethers';
import { encodeCall, REGISTER_ENTRY_TYPES } from '../src/codec/abi.ts';
import { RpcHistoryEntitlementReader, type HistoryPrincipal } from '../src/controls/historyEntitlement.ts';
import { RpcBlockEndHistoryDiscovery } from '../src/controls/historyDiscovery.ts';
import type { Eip1193Provider } from '../src/adapters/signing/eip1193Signer.ts';

// Synthetic definitions, not a deployed/account/chain acceptance record.
const a=(n:string)=>'0x'+n.repeat(40),h=(n:string)=>'0x'+n.repeat(64);
const abi=AbiCoder.defaultAbiCoder(),code='0x60006000',sequenceId=h('1'),anchorHash=h('a'),eventHash=h('b'),txHash=h('c');
const pin={chainId:560048n,controller:a('1'),runtimeCodeHash:keccak256(code)};
const topic=id('LegDetached(bytes32,bytes32,uint256,address,address,bytes32,bytes32,address,bytes32,bytes32)');
const sequenceTypes=['address','uint256','address','address','address','bytes32','bytes32','bytes32',
  'uint256','uint256','uint256','uint256','uint256','bytes32','bool'];
const legTypes=['bytes32','address','address','bytes32','bytes32','address','bytes32','uint8'];
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
      assert.equal((params[1] as {requireCanonical:boolean}).requireCanonical,true);
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
        if(is('entryAsOf(uint256,uint64)',['uint256','uint64'],[7n,BigInt((params[1] as {blockHash:string}).blockHash===h('d')?112:(params[1] as {blockHash:string}).blockHash===h('e')?128:144)]))return abi.encode([...REGISTER_ENTRY_TYPES],flags.entry);
        if(is('holderAsOf(uint256,uint64)',['uint256','uint64'],[7n,BigInt((params[1] as {blockHash:string}).blockHash===h('d')?112:(params[1] as {blockHash:string}).blockHash===h('e')?128:144)]))return abi.encode(['address'],[flags.holder]);
        if(is('isFinalAsOf(uint256,uint64)',['uint256','uint64'],[7n,BigInt((params[1] as {blockHash:string}).blockHash===h('d')?112:(params[1] as {blockHash:string}).blockHash===h('e')?128:144)]))return abi.encode(['bool'],[false]);
        if(is('openGapOf(uint256)',['uint256'],[7n]))return abi.encode(['bytes32'],[h('0')]);
        throw Error('UNEXPECTED_TOKEN_READ');
      }
      assert.equal(tx.to,pin.controller);
      if(is('admissionBinding(bytes32,uint64)',['bytes32','uint64'],[sequenceId,flags.entry[4]]))
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


const openTopic=id('SequenceOpened(bytes32,address,uint256,address,address)');
const blockHashes=new Map<bigint,string>([[13n,h('c')],[14n,h('d')],[15n,h('e')],[16n,anchorHash]]);
function discoveryFixture(limits:{maximumBlocks?:bigint;maximumWindows?:bigint;blocksPerRequest?:bigint}={}){
  const f=fixture(0);f.flags.factoryAccount=a('7');
  const flags={missingOpen:false,duplicateOpen:false,badOpenReceipt:false,openReorg:false,wrongParent:false,
    neverDone:false,archiveMissing:false,firstEntryChangesAt:Infinity,firstEntryReads:0,lateReorgAt:Infinity,headerReads:0,
    receiptLogChange:null as null|'blockNumber'|'blockHash'|'transactionHash'|'transactionIndex'|'data'};
  const open={address:pin.controller,topics:[openTopic,sequenceId,abi.encode(['address'],[a('6')]),abi.encode(['uint256'],[7n])],
    data:abi.encode(['address','address'],[a('3'),a('5')]),removed:false,blockNumber:'0xe',blockHash:h('d'),
    transactionHash:txHash,transactionIndex:'0x2',logIndex:'0x1'};
  const original=f.provider.request.bind(f.provider);
  const provider:Eip1193Provider={async request(args){
    const {method,params=[]}=args;
    if(method==='eth_getBlockByNumber'){
      f.calls.push({method,params:structuredClone(params)});f.flags.onRequest?.(method);
      const n=BigInt(params[0] as string);assert.ok(blockHashes.has(n));
      const bh=blockHashes.get(n)!;++flags.headerReads;
      return {number:'0x'+n.toString(16),hash:flags.headerReads>=flags.lateReorgAt?h('f'):
        flags.openReorg&&n===14n?h('f'):bh,parentHash:flags.wrongParent&&n===15n?h('f'):blockHashes.get(n-1n)??h('b'),
        timestamp:'0x'+(112n+(n-14n)*16n).toString(16)};
    }
    if(method==='eth_getLogs'&&(params[0] as {topics:string[]}).topics[0]===openTopic){
      f.calls.push({method,params:structuredClone(params)});
      const range=params[0] as {fromBlock:string;toBlock:string};
      if(flags.missingOpen||BigInt(range.fromBlock)>14n||BigInt(range.toBlock)<14n)return [];
      return flags.duplicateOpen?[structuredClone(open),structuredClone(open)]:[structuredClone(open)];
    }
    if(method==='eth_getTransactionReceipt'&&params[0]===txHash){
      f.calls.push({method,params:structuredClone(params)});
      const receiptLog=structuredClone(open);
      if(flags.receiptLogChange==='blockNumber')receiptLog.blockNumber='0xf';
      if(flags.receiptLogChange==='blockHash')receiptLog.blockHash=h('e');
      if(flags.receiptLogChange==='transactionHash')receiptLog.transactionHash=h('9');
      if(flags.receiptLogChange==='transactionIndex')receiptLog.transactionIndex='0x3';
      if(flags.receiptLogChange==='data')receiptLog.data=abi.encode(['address','address'],[a('3'),a('9')]);
      return {status:flags.badOpenReceipt?'0x0':'0x1',transactionHash:txHash,blockNumber:'0xe',blockHash:h('d'),
        transactionIndex:'0x2',logs:[receiptLog]};
    }
    if(method==='eth_call'){
      const blockHash=(params[1] as {blockHash:string}).blockHash,at=blockHash===h('d')?14n:blockHash===h('e')?15n:16n;
      if(flags.archiveMissing&&at===15n)throw Error('SYNTHETIC_ARCHIVE_MISSING');
      const holder=flags.neverDone?a('3'):at===15n?a('7'):a('3');
      f.flags.holder=holder;f.flags.holderIndex=holder===a('7')?1n:0n;
      f.flags.entry=[h('5'),h('6'),h('7'),holder,at===16n?2n:1n,at===16n?140n:flags.neverDone?100n:128n,0n];
      const tx=params[0] as {to:string;data:string};
      if(tx.to===a('6')&&tx.data===encodeCall('entryAt(uint256,uint64)',['uint256','uint64'],[7n,1n])){
        f.calls.push({method,params:structuredClone(params)});++flags.firstEntryReads;
        return abi.encode([...REGISTER_ENTRY_TYPES],[flags.firstEntryReads>=flags.firstEntryChangesAt?h('9'):h('5'),
          h('6'),h('7'),flags.neverDone?a('3'):a('7'),1n,flags.neverDone?100n:128n,0n]);
      }
    }
    return await original(args);
  }};
  const discovery=new RpcBlockEndHistoryDiscovery(provider,pin,namespace,0n,limits);
  const input={principal:{...f.authenticated},asset:{chainId:560048n,contract:a('6'),tokenId:7n},
    sequenceId,anchor:{blockNumber:16n,blockHash:anchorHash}};
  return {f,flags,provider,discovery,input,open};
}
test('discovers missed block-end DONE while current owner/holder projection is PENDING',async()=>{
  const f=discoveryFixture(),r=await f.discovery.discoverAt(f.input);
  assert.equal(r.kind,'found');if(r.kind!=='found')assert.fail();
  assert.equal(r.progress.state,'DONE');assert.equal(r.progress.blockNumber,'15');
  assert.equal(r.current.source.evidence.kind,'bound');assert.equal(r.current.source.snapshot.blockNumber,16n);
  assert.equal(r.coverage.from.blockNumber,14n);assert.equal(r.coverage.through.blockNumber,15n);
  assert.equal(r.coverage.checkedBlocks,2n);assert.equal(r.coverage.intraBlockStates,'not-established');
  assert.equal(r.coverage.canExecute,false);assert.equal(Object.hasOwn(r,'historical'),false);
});
test('future initial effectiveAt is checked without treating an unavailable projection call as empty history',async()=>{
  const f=discoveryFixture(),r=await f.discovery.discoverAt(f.input);
  assert.equal(r.kind,'found');
  const entryAsOf=encodeCall('entryAsOf(uint256,uint64)',['uint256','uint64'],[7n,112n]);
  assert.equal(f.f.calls.some(c=>c.method==='eth_call'&&(c.params[0] as {data:string}).data===entryAsOf),false);
  assert.ok(f.f.calls.some(c=>c.method==='eth_call'&&
    (c.params[0] as {data:string}).data===encodeCall('entryAt(uint256,uint64)',['uint256','uint64'],[7n,1n])&&
    (c.params[1] as {blockHash:string}).blockHash===h('d')));
});
test('blocks with no event are still read when time alone activates admitted holder',async()=>{
  const f=discoveryFixture(),r=await f.discovery.discoverAt(f.input);
  assert.equal(r.kind,'found');
  assert.ok(f.f.calls.some(c=>c.method==='eth_call'&&(c.params[1] as {blockHash:string}).blockHash===h('e')));
  assert.ok(f.f.calls.filter(c=>c.method==='eth_getLogs').every(c=>(c.params[0] as {topics:string[]}).topics[0]===openTopic||
    (c.params[0] as {topics:string[]}).topics[0]===topic));
});
test('no observed block-end DONE is not an empty complete history or service-port success',async()=>{
  const f=discoveryFixture();f.flags.neverDone=true;const r=await f.discovery.discoverAt(f.input);
  assert.equal(r.kind,'not-found-at-block-end');assert.equal(r.coverage.checkedBlocks,3n);
  assert.equal(r.coverage.intraBlockStates,'not-established');
  assert.equal(Object.hasOwn(r,'historical'),false);assert.equal(Object.hasOwn(r,'candidate'),false);
  assert.equal(Object.hasOwn(r,'complete'),false);
});
test('resource overflow refuses the whole required range, not a partial or empty result',async()=>{
  const blocks=discoveryFixture({maximumBlocks:2n});
  await assert.rejects(blocks.discovery.discoverAt(blocks.input),/CONTROL_DISCOVERY_BLOCK_RANGE_UNAVAILABLE/);
  const windows=discoveryFixture({blocksPerRequest:1n,maximumWindows:2n});
  await assert.rejects(windows.discovery.discoverAt(windows.input),/CONTROL_DISCOVERY_RANGE_UNAVAILABLE/);
  assert.equal(windows.f.calls.length,0);
});
test('sequence opening is a unique runtime-and-receipt-bound event rather than caller anchor authority',async()=>{
  for(const change of [{missingOpen:true},{duplicateOpen:true},{badOpenReceipt:true},{openReorg:true}]){
    const f=discoveryFixture();Object.assign(f.flags,change);await assert.rejects(f.discovery.discoverAt(f.input));
  }
  const wrong=discoveryFixture();wrong.open.data=abi.encode(['address','address'],[a('9'),a('5')]);
  await assert.rejects(wrong.discovery.discoverAt(wrong.input),/CONTROL_DISCOVERY_OPEN_EVENT_REFUSED/);
  for(const field of ['blockNumber','blockHash','transactionHash','transactionIndex','data'] as const){
    const changed=discoveryFixture();changed.flags.receiptLogChange=field;
    await assert.rejects(changed.discovery.discoverAt(changed.input),/CONTROL_DISCOVERY_OPEN_RECEIPT_REFUSED/);
  }
});
test('the complete canonical chain link is required between adjacent scanned block ends',async()=>{
  const f=discoveryFixture();f.flags.wrongParent=true;
  await assert.rejects(f.discovery.discoverAt(f.input),/CONTROL_DISCOVERY_CHAIN_DISCONTINUITY/);
});
test('archive failure at a non-event block does not get swallowed into skipped coverage',async()=>{
  const f=discoveryFixture();f.flags.archiveMissing=true;
  await assert.rejects(f.discovery.discoverAt(f.input),/CONTROL_RPC_REFUSED/);
});
test('changed immutable first entry or late canonical reorg cannot produce accepted discovery',async()=>{
  const entry=discoveryFixture();entry.flags.firstEntryChangesAt=3;
  await assert.rejects(entry.discovery.discoverAt(entry.input),/CONTROL_DISCOVERY_FIRST_ENTRY_CHANGED/);
  const reorg=discoveryFixture();reorg.flags.lateReorgAt=8;
  await assert.rejects(reorg.discovery.discoverAt(reorg.input));
});
test('captured configuration and caller inputs cannot be replaced during asynchronous history reads',async()=>{
  const f=discoveryFixture();let once=false;
  f.f.flags.onRequest=()=>{if(once)return;once=true;f.input.asset.tokenId=8n;
    f.input.anchor.blockHash=h('f');f.input.principal.tenant='other';};
  f.provider.request=async()=>{throw Error('SWAPPED_UNTRUSTED_PROVIDER');};
  const r=await f.discovery.discoverAt(f.input);assert.equal(r.kind,'found');
});
test('wrong authenticated scope, malformed anchor and getter-backed request fail without forged authority',async()=>{
  const wrong=discoveryFixture();wrong.input.principal.tenant='other';
  await assert.rejects(wrong.discovery.discoverAt(wrong.input),/CONTROL_ENTITLEMENT_PRINCIPAL_REFUSED/);
  assert.equal(wrong.f.calls.length,0);
  const bad=discoveryFixture();bad.input.anchor.blockHash=h('0');
  await assert.rejects(bad.discovery.discoverAt(bad.input),/CONTROL_DISCOVERY_QUERY_REFUSED/);
  let invoked=0;const getter=discoveryFixture();
  Object.defineProperty(getter.input,'sequenceId',{get(){invoked++;return sequenceId;}});
  await assert.rejects(getter.discovery.discoverAt(getter.input),/CONTROL_DISCOVERY_SCHEMA_REFUSED/);
  assert.equal(invoked,0);assert.equal(getter.f.calls.length,0);
});
test('discovery has no sign, send, account creation or transaction execution port',async()=>{
  const f=discoveryFixture();await f.discovery.discoverAt(f.input);
  assert.ok(f.f.calls.every(c=>!['eth_sendTransaction','eth_sendRawTransaction','eth_sign','personal_sign','eth_requestAccounts'].includes(c.method)));
});

