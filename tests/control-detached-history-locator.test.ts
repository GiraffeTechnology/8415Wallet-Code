import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, id, keccak256 } from 'ethers';
import { encodeCall } from '../src/codec/abi.ts';
import { RpcDetachedHistoryLocator } from '../src/controls/detachedHistoryLocator.ts';
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
function fixture(count=3,limits:{blocksPerRequest?:bigint;maximumWindows?:bigint;maximumRecords?:bigint}={}) {
  let commitment=keccak256(abi.encode(['bytes32','bytes32'],[id('8415Wallet/DetachedResponsibilities/v1'),sequenceId]));
  const records=Array.from({length:count},(_,i)=>{
    const r={occurrence:BigInt(i),legId:keccak256(abi.encode(['uint256'],[i+1])),fromAccount:a(i%2===0?'3':'4'),
      toAccount:a(i%2===0?'4':'3'),termsHash:h('2'),acceptanceHash:h('3'),returnAuthority:a('5'),returnConditionHash:h('4'),
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
  const flags={logs:structuredClone(logs),receiptLogs:structuredClone(logs),commitment:finalCommitment,boundary,
    receiptStatus:'0x1',receiptHash:eventHash,receiptTransaction:txHash,missingReceipt:false,eventCode:code,terminal:1n,
    failWindow:false,eventReorgAt:Infinity,anchorReorgAt:Infinity,chainSwitchAt:Infinity,
    malformedLogs:null as unknown,onRequest:null as null|((method:string)=>void)};
  const calls:{method:string;params:readonly unknown[]}[]=[];let chains=0,eventReads=0,anchorReads=0;
  const provider:Eip1193Provider={async request({method,params=[]}){
    calls.push({method,params:structuredClone(params)});flags.onRequest?.(method);
    if(method==='eth_chainId')return ++chains>=flags.chainSwitchAt?'0x1':'0x88bb0';
    if(method==='eth_getCode'){
      const at=params[1] as {blockHash?:string};
      return typeof at==='object'&&at.blockHash===eventHash?flags.eventCode:code;
    }
    if(method==='eth_getBlockByNumber'){
      assert.notEqual(params[0],'latest');
      if(params[0]==='0x10')return {number:'0x10',timestamp:'0x80',hash:++anchorReads>=flags.anchorReorgAt?h('e'):anchorHash};
      assert.equal(params[0],'0x9');return {number:'0x9',timestamp:'0x60',hash:++eventReads>=flags.eventReorgAt?h('e'):eventHash};
    }
    if(method==='eth_call'){
      assert.deepEqual(params[1],{blockHash:anchorHash,requireCanonical:true});
      const tx=params[0] as {to:string;data:string};assert.equal(tx.to,pin.controller);
      const is=(sig:string,types:readonly string[],values:readonly any[])=>tx.data===encodeCall(sig,types as any,values);
      if(is('sequence(bytes32)',['bytes32'],[sequenceId]))return abi.encode(sequenceTypes,
        [a('6'),7n,a('3'),a('7'),a('5'),h('5'),h('6'),h('7'),BigInt(count+5),BigInt(count+1),BigInt(count),0n,
          BigInt(count+1),flags.commitment,false]);
      if(is('legCount(bytes32)',['bytes32'],[sequenceId]))return abi.encode(['uint256'],[count+1]);
      if(is('legAt(bytes32,uint256)',['bytes32','uint256'],[sequenceId,BigInt(count)]))return abi.encode(legTypes,
        [h('f'),boundary,a('7'),h('2'),h('3'),a('5'),h('4'),0n]);
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
  return {flags,calls,records,locator:new RpcDetachedHistoryLocator(provider,pin,limits)};
}
const locate=(f:ReturnType<typeof fixture>,from=0n,at=anchor())=>f.locator.locate(sequenceId,from,at);
test('joins complete detached prefix, live boundary, canonical receipts and permanent terminal facts',async()=>{
  const f=fixture(3,{blocksPerRequest:8n}),r=await locate(f);
  assert.equal(r.kind,'located-detached-prefix');assert.equal(r.detachedCount,3n);
  assert.equal(r.detachedCommitment,f.flags.commitment);assert.equal(r.boundaryAccount,a('4'));
  assert.deepEqual(r.records.map(v=>v.occurrence),[0n,1n,2n]);
  assert.equal(r.principalEntitlement,'not-evaluated');assert.equal(r.displayMilestone,'not-evaluated');
  assert.equal(r.protocolFinality,'not-evaluated');assert.equal(r.readOnly,true);
  assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.records)&&r.records.every(v=>Object.isFrozen(v)&&Object.isFrozen(v.location)));
  assert.equal(f.calls.filter(c=>c.method==='eth_getTransactionReceipt').length,1);
  assert.equal(f.calls.filter(c=>c.method==='eth_getLogs').length,3);
  assert.ok(f.calls.every(c=>['eth_chainId','eth_getCode','eth_getBlockByNumber','eth_call',
    'eth_getLogs','eth_getTransactionReceipt'].includes(c.method)));
});
test('zero detached prefix is anchor state, not a fabricated lifetime history or extra RPC scan',async()=>{
  const f=fixture(0),r=await locate(f);assert.equal(r.detachedCount,0n);assert.equal(r.detachedCommitment,h('0'));
  assert.equal(r.records.length,0);assert.equal(r.boundaryAccount,a('3'));
  assert.equal(f.calls.some(c=>c.method==='eth_getLogs'||c.method==='eth_getTransactionReceipt'),false);
});
test('130 detached legs and repeated accounts are valid, not a 128-leg lifetime cap',async()=>{
  const f=fixture(130),r=await locate(f);assert.equal(r.records.length,130);assert.equal(r.detachedCount,130n);
  assert.equal(r.records[128]!.occurrence,128n);assert.equal(f.calls.filter(c=>c.method==='eth_getTransactionReceipt').length,1);
});
test('provider row order may vary but canonical occurrence/execution order must agree',async()=>{
  const f=fixture();f.flags.logs.reverse();const r=await locate(f);
  assert.deepEqual(r.records.map(x=>x.occurrence),[0n,1n,2n]);
});
test('malformed query, anchor and bounds are refused before RPC',async()=>{
  for(const [seq,from,at]of [[h('0'),0n,anchor()],[sequenceId,-1n,anchor()],[sequenceId,17n,anchor()],
    [sequenceId,0n,{blockNumber:16,blockHash:anchorHash}],[sequenceId,0n,{blockNumber:16n,blockHash:h('0')}],
    [sequenceId,0n,{...anchor(),verified:true}]] as const){
    const f=fixture();await assert.rejects(f.locator.locate(seq,from,at as any),/CONTROL_PREFIX_QUERY_REFUSED/);
    assert.equal(f.calls.length,0);
  }
});
test('read resource limits are explicit unavailable results, not protocol caps or partial success',async()=>{
  for(const limits of [{blocksPerRequest:0n},{blocksPerRequest:10001n},{maximumWindows:0n},{maximumWindows:4097n},
    {maximumRecords:0n},{maximumRecords:1000001n}])assert.throws(()=>fixture(3,limits),/CONTROL_PREFIX_LIMIT_REFUSED/);
  const f=fixture(3,{blocksPerRequest:1n,maximumWindows:2n});
  await assert.rejects(locate(f),/CONTROL_PREFIX_RANGE_UNAVAILABLE/);assert.equal(f.calls.length,0);
  const g=fixture(3,{maximumRecords:2n});await assert.rejects(locate(g),/CONTROL_PREFIX_RECORDS_UNAVAILABLE/);
  assert.equal(g.calls.some(c=>c.method==='eth_getLogs'),false);
});
test('a missing event, truncated range or suffix cannot establish the complete prefix',async()=>{
  const f=fixture();f.flags.logs.pop();await assert.rejects(locate(f),/CONTROL_PREFIX_INCOMPLETE/);
  const g=fixture();await assert.rejects(locate(g,10n),/CONTROL_PREFIX_INCOMPLETE/);
  const k=fixture();k.flags.logs.shift();await assert.rejects(locate(k),/CONTROL_PREFIX_INCOMPLETE/);
});
test('a failed archive window remains unavailable without latest or alternate-route fallback',async()=>{
  const f=fixture();f.flags.failWindow=true;await assert.rejects(locate(f),/CONTROL_RPC_REFUSED/);
  assert.equal(f.calls.filter(c=>c.method==='eth_getLogs').length,1);
});
test('duplicate rows or excess rows are refused before a verified prefix is returned',async()=>{
  const f=fixture();f.flags.logs.push(structuredClone(f.flags.logs[0]!));
  await assert.rejects(locate(f),/CONTROL_PREFIX_LOGS_REFUSED/);
  const g=fixture();g.flags.logs[1]=structuredClone(g.flags.logs[0]!);
  await assert.rejects(locate(g),/CONTROL_PREFIX_ORDER_REFUSED/);
});
test('sparse or non-array provider logs cannot look like empty history',async()=>{
  for(const rows of [{events:[]},new Array(3)]){
    const f=fixture();f.flags.malformedLogs=rows;
    await assert.rejects(locate(f),/CONTROL_PREFIX_LOGS_REFUSED/);
  }
});
test('cross-controller, cross-sequence, wrong topic and removed events are refused',async()=>{
  for(const what of ['address','sequence','topic','removed']){
    const f=fixture();
    if(what==='address')f.flags.logs[0]!.address=a('9');
    if(what==='sequence')f.flags.logs[0]!.topics[1]=h('f');
    if(what==='topic')f.flags.logs[0]!.topics[0]=h('f');
    if(what==='removed')f.flags.logs[0]!.removed=true;
    await assert.rejects(locate(f),/CONTROL_PREFIX_EVENT_REFUSED/);
  }
});
test('wrong event data shape, zero leg, noncanonical quantity or zero transaction hash are refused',async()=>{
  for(const what of ['shortData','zeroLeg','quantity','zeroTransaction']){
    const f=fixture();
    if(what==='shortData')f.flags.logs[0]!.data='0x';
    if(what==='zeroLeg')f.flags.logs[0]!.topics[2]=h('0');
    if(what==='quantity')f.flags.logs[0]!.logIndex='0x01';
    if(what==='zeroTransaction')f.flags.logs[0]!.transactionHash=h('0');
    await assert.rejects(locate(f),/CONTROL_PREFIX_(EVENT|QUANTITY)_REFUSED/);
  }
});
test('event outside its actual window is refused even if a provider ignores the filter',async()=>{
  const f=fixture();f.flags.malformedLogs=f.flags.logs;
  await assert.rejects(locate(f,10n),/CONTROL_PREFIX_EVENT_RANGE_REFUSED/);
});
test('repeated leg IDs are rejected independently of address repetition',async()=>{
  const f=fixture();f.flags.logs[1]!.topics[2]=f.flags.logs[0]!.topics[2]!;
  await assert.rejects(locate(f),/CONTROL_PREFIX_ORDER_REFUSED/);
});
test('changed terms, acceptance, parties or commitment cannot match the original prefix',async()=>{
  for(const index of [0,1,2,3,4,5,6]){
    const f=fixture(),r=f.records[1]!;
    const fields=[r.fromAccount,r.toAccount,r.termsHash,r.acceptanceHash,r.returnAuthority,r.returnConditionHash,r.detachedCommitment];
    fields[index]=[0,1,4].includes(index)?a('f'):h('f');
    f.flags.logs[1]!.data=abi.encode(['address','address','bytes32','bytes32','address','bytes32','bytes32'],fields);
    await assert.rejects(locate(f),/CONTROL_PREFIX_(ORDER|COMMITMENT)_REFUSED/);
  }
});
test('final folded commitment and live boundary must both agree with chain state',async()=>{
  const f=fixture();f.flags.commitment=h('f');await assert.rejects(locate(f),/CONTROL_PREFIX_COMMITMENT_REFUSED/);
  const g=fixture();g.flags.boundary=a('f');await assert.rejects(locate(g),/CONTROL_PREFIX_BOUNDARY_REFUSED/);
});
test('canonical execution order cannot run backwards or repeat log positions',async()=>{
  for(const what of ['block','log','transaction']){
    const f=fixture();
    if(what==='block')f.flags.logs[1]!.blockNumber='0x8';
    if(what==='log')f.flags.logs[1]!.logIndex='0x1';
    if(what==='transaction')f.flags.logs[1]!.transactionIndex='0x1';
    await assert.rejects(locate(f),/CONTROL_PREFIX_ORDER_REFUSED/);
  }
});
test('one block height cannot carry two claimed canonical hashes',async()=>{
  const f=fixture();f.flags.logs[1]!.blockHash=h('e');
  await assert.rejects(locate(f),/CONTROL_PREFIX_BLOCK_CONFLICT/);
});
test('event-era code must match the bound controller runtime',async()=>{
  const f=fixture();f.flags.eventCode='0x6001';await assert.rejects(locate(f),/CONTROL_PREFIX_EVENT_RUNTIME_REFUSED/);
});
test('missing, reverted, wrong-block or wrong-transaction receipts do not prove detachment',async()=>{
  for(const change of [{missingReceipt:true},{receiptStatus:'0x0'},{receiptHash:h('e')},{receiptTransaction:h('e')}]){
    const f=fixture();Object.assign(f.flags,change);
    await assert.rejects(locate(f),/CONTROL_PREFIX_(SCHEMA|RECEIPT)_REFUSED/);
  }
});
test('each detached record must have exactly one unchanged event in the receipt',async()=>{
  for(const what of ['missing','duplicate','changed']){
    const f=fixture();
    if(what==='missing')f.flags.receiptLogs.pop();
    if(what==='duplicate')f.flags.receiptLogs.push(structuredClone(f.flags.receiptLogs[1]!));
    if(what==='changed')f.flags.receiptLogs[1]!.data=f.flags.receiptLogs[0]!.data;
    await assert.rejects(locate(f),/CONTROL_PREFIX_RECEIPT_REFUSED/);
  }
});
test('the permanent terminal fact must still identify a completed leg',async()=>{
  for(const terminal of [0n,2n,3n]){
    const f=fixture();f.flags.terminal=terminal;await assert.rejects(locate(f),/CONTROL_PREFIX_TERMINAL_REFUSED/);
  }
});
test('early and late event-block reorgs are refused',async()=>{
  for(const at of [1,2]){
    const f=fixture();f.flags.eventReorgAt=at;await assert.rejects(locate(f),/CONTROL_PREFIX_REORGED/);
  }
});
test('final anchor reorg and chain switch remain unavailable, never a frozen progress success',async()=>{
  const f=fixture();f.flags.anchorReorgAt=3;await assert.rejects(locate(f),/CONTROL_PREFIX_REORGED/);
  const g=fixture();g.flags.chainSwitchAt=3;await assert.rejects(locate(g),/CONTROL_CHAIN_MISMATCH/);
});
test('caller anchor accessors and later mutation cannot move the validated read anchor',async()=>{
  const f=fixture();let numbers=0,hashes=0;
  const at={get blockNumber(){return ++numbers===1?16n:99n;},get blockHash(){return ++hashes===1?anchorHash:h('f');}};
  const r=await locate(f,0n,at);assert.deepEqual(r.anchor,anchor());assert.equal(numbers,1);assert.equal(hashes,1);
});
test('receipt evidence is normalized once before later awaited terminal checks',async()=>{
  const f=fixture();let receiptReturned=false;
  f.flags.onRequest=method=>{
    if(method==='eth_getTransactionReceipt')receiptReturned=true;
    else if(method==='eth_call'&&receiptReturned){
      // A provider-owned object must not change evidence already captured.
      f.flags.receiptLogs[1]!.data='0x';
    }
  };
  const r=await locate(f);assert.equal(r.records.length,3);
  assert.equal(r.records[1]!.termsHash,h('2'));
  assert.equal(f.calls.filter(c=>c.method==='eth_getTransactionReceipt').length,1);
});

