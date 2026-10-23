import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, id, keccak256 } from 'ethers';
import { encodeCall, REGISTER_ENTRY_TYPES } from '../src/codec/abi.ts';
import { ControlAdmissionHistoryLocator } from '../src/controls/historyLocator.ts';
import type { Eip1193Provider } from '../src/adapters/signing/eip1193Signer.ts';

// Synthetic definitions only. No deployed contract, remote node or chain acceptance implied.
const a = (n: string) => '0x' + n.repeat(40), h = (n: string) => '0x' + n.repeat(64);
const abi = AbiCoder.defaultAbiCoder(), code = '0x60006000', tokenCode = '0x60006001';
const sequenceId = h('1'), anchorHash = h('a'), eventHash = h('b'), txHash = h('c');
const controller = a('1'), token = a('2'), initial = a('3'), recipient = a('4');
const pin = { chainId: 560048n, controller, runtimeCodeHash: keccak256(code) };
const anchor = () => ({ blockNumber: 16n, blockHash: anchorHash });
const sequenceTypes = ['address','uint256','address','address','address','bytes32','bytes32','bytes32',
  'uint256','uint256','uint256','uint256','uint256','bytes32','bool'];
const legTypes = ['bytes32','address','address','bytes32','bytes32','address','bytes32','uint8'];
const topic = id('AdmissionBound(bytes32,uint64,uint256,bytes32,uint256)');
const entry = [h('5'), h('6'), h('7'), recipient, 2n, 64n, 0n];
const entryHash = keccak256(abi.encode([...REGISTER_ENTRY_TYPES].slice(0,6), entry.slice(0,6)));
function event() {
  return { address: controller, topics: [topic, sequenceId, abi.encode(['uint64'],[2n]), abi.encode(['uint256'],[1n])],
    data: abi.encode(['bytes32','uint256'],[entryHash,7n]), removed:false,
    blockNumber:'0x9', blockHash:eventHash, transactionHash:txHash, transactionIndex:'0x1', logIndex:'0x2' };
}
function fixture(limits: { blocksPerRequest?: bigint; maximumWindows?: bigint } = {}) {
  const calls: {method:string;params:readonly unknown[]}[] = [];
  const flags = { bound:true, bindingOccurrence:1n, bindingHash:entryHash, missing:false, duplicate:false,
    badTokenCode:false, eventCode:code, eventBinding:true, entry:[...entry], register:h('8'), profile:h('9'),
    erc165:true, invalid:false, projection:true, settlement:true, malformedInterface:false,
    chainSwitchAt:Infinity, failWindow:false, eventReorgAt:Infinity, anchorReorgAt:Infinity,
    headerNumberWrong:false, receiptStatus:'0x1', receiptBlockHash:eventHash, receiptTx:txHash,
    receiptMissing:false, receiptDuplicates:false, receiptLog:event(), log:event(),
    returnedLogs:null as unknown, onRequest:null as null | ((method:string)=>void) };
  let chains=0, anchorReads=0, eventReads=0;
  const provider:Eip1193Provider = {async request({method,params=[]}) {
    calls.push({method,params:structuredClone(params)}); flags.onRequest?.(method);
    if(method==='eth_chainId') return ++chains>=flags.chainSwitchAt?'0x1':'0x88bb0';
    if(method==='eth_getCode') {
      if(params[0]===token) return flags.badTokenCode?'0x6001':tokenCode;
      const at=params[1] as {blockHash?:string};
      return typeof at==='object' && at.blockHash===eventHash ? flags.eventCode : code;
    }
    if(method==='eth_getBlockByNumber') {
      assert.notEqual(params[0],'latest');
      if(params[0]==='0x10') return {number:flags.headerNumberWrong?'0x11':'0x10',timestamp:'0x80',
        hash:++anchorReads>=flags.anchorReorgAt?h('e'):anchorHash};
      assert.equal(params[0],'0x9');
      return {number:'0x9',timestamp:'0x60',hash:++eventReads>=flags.eventReorgAt?h('e'):eventHash};
    }
    if(method==='eth_call') {
      const tx=params[0] as {to:string;data:string}, at=params[1] as {blockHash:string;requireCanonical:boolean};
      assert.equal(at.requireCanonical,true);
      assert.ok([anchorHash,eventHash].includes(at.blockHash));
      const is=(sig:string,types:readonly string[],values:readonly any[])=>tx.data===encodeCall(sig,types as any,values);
      if(tx.to===controller) {
        if(is('sequence(bytes32)',['bytes32'],[sequenceId])) return abi.encode(sequenceTypes,
          [token,7n,initial,recipient,a('5'),h('8'),h('9'),keccak256(tokenCode),8n,1n,0n,0n,1n,h('0'),false]);
        if(is('legCount(bytes32)',['bytes32'],[sequenceId])) return abi.encode(['uint256'],[1n]);
        if(is('legAt(bytes32,uint256)',['bytes32','uint256'],[sequenceId,0n])) return abi.encode(legTypes,
          [h('4'),initial,recipient,h('2'),h('3'),a('5'),h('4'),0n]);
        if(is('inheritedHash(bytes32)',['bytes32'],[sequenceId])) return abi.encode(['bytes32'],[h('d')]);
        if(is('admissionBinding(bytes32,uint64)',['bytes32','uint64'],[sequenceId,2n])) {
          const bound=at.blockHash===eventHash?flags.eventBinding:flags.bound;
          return abi.encode(['bool','uint256','bytes32'],[bound,bound?flags.bindingOccurrence:0n,bound?flags.bindingHash:h('0')]);
        }
      }
      if(tx.to===token) {
        for(const [identifier,supported] of [['0x01ffc9a7',flags.erc165],['0xffffffff',flags.invalid],
          ['0x6309e170',flags.projection],['0xf4a7d71b',flags.settlement]] as const) {
          if(is('supportsInterface(bytes4)',['bytes4'],[identifier])) return flags.malformedInterface
            ?abi.encode(['uint256'],[2n]):abi.encode(['bool'],[supported]);
        }
        if(is('registerId()',[],[])) return abi.encode(['bytes32'],[flags.register]);
        if(is('verificationProfile()',[],[])) return abi.encode(['bytes32'],[flags.profile]);
        if(is('entryAt(uint256,uint64)',['uint256','uint64'],[7n,2n])) return abi.encode([...REGISTER_ENTRY_TYPES],flags.entry);
      }
    }
    if(method==='eth_getLogs') {
      if(flags.failWindow) throw Error('synthetic archive window unavailable');
      if(flags.returnedLogs!==null) return flags.returnedLogs;
      const filter=params[0] as {address:string;fromBlock:string;toBlock:string;topics:string[]};
      assert.equal(filter.address,controller);
      assert.deepEqual(filter.topics,[topic,sequenceId,abi.encode(['uint64'],[2n])]);
      if(flags.missing || BigInt(filter.fromBlock)>9n || BigInt(filter.toBlock)<9n) return [];
      return flags.duplicate?[flags.log,structuredClone(flags.log)]:[flags.log];
    }
    if(method==='eth_getTransactionReceipt') {
      assert.equal(params[0],txHash);
      if(flags.receiptMissing) return null;
      return {status:flags.receiptStatus,transactionHash:flags.receiptTx,blockNumber:'0x9',
        blockHash:flags.receiptBlockHash,transactionIndex:'0x1',
        logs:flags.receiptDuplicates?[flags.receiptLog,structuredClone(flags.receiptLog)]:[flags.receiptLog]};
    }
    throw Error('UNEXPECTED_NON_READ_ONLY_RPC');
  }};
  return {calls,flags,locator:new ControlAdmissionHistoryLocator(provider,pin,limits)};
}
const locate=(f:ReturnType<typeof fixture>,from=0n,at=anchor())=>f.locator.locateVersion(sequenceId,2n,from,at);

test('canonical admission joins immutable state, exact event, receipt and both anchors without claiming DONE',async()=>{
  const f=fixture({blocksPerRequest:8n}), r=await locate(f);
  assert.equal(r.kind,'located-control-admission');
  if(r.kind!=='located-control-admission') assert.fail('expected located admission');
  assert.equal(r.occurrence,1n);assert.equal(r.version,2n);assert.equal(r.immutableEntryHash,entryHash);
  assert.deepEqual(r.location,{blockNumber:9n,blockHash:eventHash,blockTimestamp:96n,transactionHash:txHash,
    transactionIndex:1n,logIndex:2n,controllerRevision:7n});
  assert.equal(r.displayMilestone,'not-evaluated');assert.equal(r.protocolFinality,'not-evaluated');
  assert.equal(r.principalEntitlement,'not-evaluated');assert.ok(Object.isFrozen(r.location));
  assert.ok(Object.isFrozen(r.anchor));assert.ok(Object.isFrozen(r));
  assert.deepEqual(f.calls.filter(c=>c.method==='eth_getLogs').map(c=>(c.params[0] as any).fromBlock),['0x0','0x8','0x10']);
  assert.ok(f.calls.every(c=>['eth_chainId','eth_getCode','eth_call','eth_getBlockByNumber',
    'eth_getLogs','eth_getTransactionReceipt'].includes(c.method)));
});
test('absent binding is explicitly not-bound at the named anchor, not empty history or completed milestone',async()=>{
  const f=fixture();f.flags.bound=false;const r=await locate(f);
  assert.equal(r.kind,'not-bound-at-anchor');assert.equal('location' in r,false);assert.equal('displayMilestone' in r,false);
  assert.equal(f.calls.some(c=>c.method==='eth_getLogs'||c.method==='eth_getTransactionReceipt'),false);
});
test('malformed versions, sequence ids and numeric ranges fail before RPC',async()=>{
  for(const [seq,version,from] of [[h('0'),2n,0n],[sequenceId,0n,0n],[sequenceId,1n<<64n,0n],
    [sequenceId,2,0n],[sequenceId,2n,-1n],[sequenceId,2n,'0']] as const) {
    const f=fixture();await assert.rejects(f.locator.locateVersion(seq,version as bigint,from as bigint,anchor()),
      /CONTROL_HISTORY_QUERY_REFUSED/);assert.equal(f.calls.length,0);
  }
});
test('malformed or oversized anchors fail before RPC and never select latest',async()=>{
  for(const at of [{blockNumber:16,blockHash:anchorHash},{blockNumber:16n,blockHash:h('0')},
    {blockNumber:-1n,blockHash:anchorHash},{blockNumber:16n,blockHash:anchorHash,compatible:true}]) {
    const f=fixture();await assert.rejects(locate(f,0n,at as any),/CONTROL_HISTORY_ANCHOR_REFUSED/);
    assert.equal(f.calls.length,0);
  }
  const f=fixture();await assert.rejects(locate(f,17n),/CONTROL_HISTORY_ANCHOR_REFUSED/);assert.equal(f.calls.length,0);
});
test('bounded resource limits fail explicitly, not truncated-history success',async()=>{
  for(const limits of [{blocksPerRequest:0n},{blocksPerRequest:10001n},{maximumWindows:0n},{maximumWindows:4097n}])
    assert.throws(()=>fixture(limits),/CONTROL_HISTORY_LIMIT_REFUSED/);
  const f=fixture({blocksPerRequest:1n,maximumWindows:2n});
  await assert.rejects(locate(f),/CONTROL_HISTORY_RANGE_UNAVAILABLE/);assert.equal(f.calls.length,0);
});
test('a bound event outside the supplied range or omitted by RPC is unavailable, never inferred',async()=>{
  const f=fixture();await assert.rejects(locate(f,10n),/CONTROL_HISTORY_BOUND_EVENT_UNAVAILABLE/);
  const g=fixture();g.flags.missing=true;await assert.rejects(locate(g),/CONTROL_HISTORY_BOUND_EVENT_UNAVAILABLE/);
});
test('failed archive window does not fall back to latest or another caller route',async()=>{
  const f=fixture();f.flags.failWindow=true;await assert.rejects(locate(f),/CONTROL_RPC_REFUSED/);
  assert.equal(f.calls.filter(c=>c.method==='eth_getLogs').length,1);
});
test('duplicate binding events are refused',async()=>{
  const f=fixture();f.flags.duplicate=true;await assert.rejects(locate(f),/CONTROL_HISTORY_EVENT_DUPLICATE/);
});
test('a provider repeating an event in a later window is refused, not silently deduplicated',async()=>{
  const f=fixture({blocksPerRequest:8n});
  f.flags.onRequest=method=>{if(method==='eth_getTransactionReceipt')assert.fail('duplicate must fail before receipt');};
  // The first 8..15 window contains the event; RPC repeats it in 16..16.
  // A repeated row is refused rather than silently deduplicated.
  f.flags.returnedLogs=[f.flags.log];
  await assert.rejects(locate(f,8n),/CONTROL_HISTORY_EVENT_DUPLICATE/);
});
test('malformed RPC lists and sparse rows cannot become no-history',async()=>{
  for(const rows of [{events:[]},[undefined],new Array(1)]) {
    const f=fixture();f.flags.returnedLogs=rows;
    await assert.rejects(locate(f),/CONTROL_HISTORY_(LOGS|EVENT_DUPLICATE|SCHEMA)_REFUSED|CONTROL_HISTORY_EVENT_DUPLICATE/);
  }
});
test('cross-controller, cross-sequence and cross-version logs are refused even if supplied by filtered RPC',async()=>{
  for(const change of ['controller','sequence','version','topic']) {
    const f=fixture();
    if(change==='controller')f.flags.log.address=a('9');
    else f.flags.log.topics[change==='topic'?0:change==='sequence'?1:2]=h('f');
    await assert.rejects(locate(f),/CONTROL_HISTORY_EVENT_BINDING_REFUSED/);
  }
});
test('wrong occurrence, entry digest or impossible revision is refused',async()=>{
  for(const change of ['occurrence','hash','zeroRevision','futureRevision']) {
    const f=fixture();
    if(change==='occurrence')f.flags.log.topics[3]=abi.encode(['uint256'],[2n]);
    else f.flags.log.data=abi.encode(['bytes32','uint256'],[change==='hash'?h('f'):entryHash,
      change==='zeroRevision'?0n:change==='futureRevision'?9n:7n]);
    await assert.rejects(locate(f),/CONTROL_HISTORY_EVENT_BINDING_REFUSED/);
  }
});
test('removed events, malformed data/topics and noncanonical quantities are refused',async()=>{
  for(const change of ['removed','missingRemoved','shortData','extraTopic','badQuantity','badHash']) {
    const f=fixture();
    if(change==='removed')f.flags.log.removed=true;
    if(change==='missingRemoved')delete (f.flags.log as any).removed;
    if(change==='shortData')f.flags.log.data='0x';
    if(change==='extraTopic')f.flags.log.topics.push(h('f'));
    if(change==='badQuantity')f.flags.log.logIndex='0x02';
    if(change==='badHash')f.flags.log.transactionHash=h('0');
    await assert.rejects(locate(f),/CONTROL_HISTORY_(LOG|QUANTITY)_REFUSED/);
  }
});
test('events reported outside their queried window are refused',async()=>{
  const f=fixture();f.flags.returnedLogs=[f.flags.log];
  await assert.rejects(locate(f,10n),/CONTROL_HISTORY_EVENT_BINDING_REFUSED/);
});
test('token runtime and advertised interfaces precede admitted projection facts',async()=>{
  for(const change of [{badTokenCode:true},{erc165:false},{invalid:true},{projection:false},{settlement:false}]) {
    const f=fixture();Object.assign(f.flags,change);
    await assert.rejects(locate(f),/CONTROL_(TOKEN_RUNTIME_PIN_MISMATCH|HISTORY_PROJECTION_UNSUPPORTED|HISTORY_SETTLEMENT_UNSUPPORTED)/);
    assert.equal(f.calls.some(c=>c.method==='eth_call'&&(c.params[0] as any).data===encodeCall(
      'entryAt(uint256,uint64)',['uint256','uint64'],[7n,2n])),false);
  }
});
test('malformed advertised booleans are unavailable, not unsupported or false',async()=>{
  const f=fixture();f.flags.malformedInterface=true;await assert.rejects(locate(f),/ABI bool must be 0 or 1/);
});
test('register, profile, version and immutable entry mismatch fail closed',async()=>{
  for(const change of ['register','profile','version','entryHash']) {
    const f=fixture();
    if(change==='register')f.flags.register=h('f');
    if(change==='profile')f.flags.profile=h('f');
    if(change==='version')f.flags.entry[4]=3n;
    if(change==='entryHash')f.flags.entry[0]=h('f');
    await assert.rejects(locate(f),/CONTROL_(REGISTER_PIN_MISMATCH|PROFILE_PIN_MISMATCH|HISTORY_ENTRY_BINDING_REFUSED)/);
  }
});
test('mutable supersededAt does not invalidate an immutable historical entry binding',async()=>{
  const f=fixture();f.flags.entry[6]=100n;
  assert.equal((await locate(f)).kind,'located-control-admission');
});
test('event-era runtime and event-era binding must independently match',async()=>{
  const f=fixture();f.flags.eventCode='0x6001';await assert.rejects(locate(f),/CONTROL_HISTORY_EVENT_RUNTIME_REFUSED/);
  const g=fixture();g.flags.eventBinding=false;await assert.rejects(locate(g),/CONTROL_HISTORY_EVENT_BINDING_REFUSED/);
});
test('missing, reverted, cross-block or cross-transaction receipts are refused',async()=>{
  for(const change of [{receiptMissing:true},{receiptStatus:'0x0'},{receiptBlockHash:h('e')},{receiptTx:h('e')}]) {
    const f=fixture();Object.assign(f.flags,change);
    await assert.rejects(locate(f),/CONTROL_HISTORY_(SCHEMA|RECEIPT)_REFUSED/);
  }
});
test('receipt must contain one exact event, not a changed or duplicated log',async()=>{
  for(const change of ['data','index','duplicate','removed']) {
    const f=fixture();
    if(change==='data')f.flags.receiptLog.data=abi.encode(['bytes32','uint256'],[h('f'),7n]);
    if(change==='index')f.flags.receiptLog.logIndex='0x3';
    if(change==='duplicate')f.flags.receiptDuplicates=true;
    if(change==='removed')f.flags.receiptLog.removed=true;
    await assert.rejects(locate(f),/CONTROL_HISTORY_(RECEIPT|LOG)_REFUSED/);
  }
});
test('initial or late event reorg cannot be reported as a located admission',async()=>{
  for(const after of [1,2]) {
    const f=fixture();f.flags.eventReorgAt=after;await assert.rejects(locate(f),/CONTROL_HISTORY_REORGED/);
  }
});
test('final anchor reorg or chain switch is refused after evidence reads',async()=>{
  const f=fixture();f.flags.anchorReorgAt=3;await assert.rejects(locate(f),/CONTROL_HISTORY_REORGED/);
  const g=fixture();g.flags.chainSwitchAt=3;await assert.rejects(locate(g),/CONTROL_CHAIN_MISMATCH/);
});
test('caller mutation after start cannot move the accepted anchor',async()=>{
  const f=fixture(), at=anchor();
  f.flags.onRequest=()=>{at.blockNumber=99n;at.blockHash=h('f');};
  const r=await locate(f,0n,at);assert.deepEqual(r.anchor,anchor());
});
test('anchor accessors are captured once before validation, never reread after approval',async()=>{
  const f=fixture();let numbers=0,hashes=0;
  const at={get blockNumber(){return ++numbers===1?16n:99n;},
    get blockHash(){return ++hashes===1?anchorHash:h('f');}};
  const r=await locate(f,0n,at);
  assert.deepEqual(r.anchor,anchor());assert.equal(numbers,1);assert.equal(hashes,1);
});

