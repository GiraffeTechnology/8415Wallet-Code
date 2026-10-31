import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCall, encodeWords } from '../src/codec/abi.ts';
import { keccak256Utf8 } from '../src/codec/keccak.ts';
import { hashControlBytes } from '../src/standalone/authorization.ts';
import { AccountFactoryClient, parseControlSubmission, serializeControlSubmission, type ControlSubmission } from '../src/standalone/client.ts';
import { StandaloneAccountSession } from '../src/standalone/session.ts';
import { parseOperation, serializeOperation, type OperationState, type PublicOperationStore } from '../src/standalone/operationJournal.ts';
import type { Eip1193Provider } from '../src/adapters/signing/eip1193Signer.ts';
const a = (s: string) => '0x' + s.repeat(40), h = (s: string) => '0x' + s.repeat(64);
const pin = { chainId: 560048n, controller: a('1'), runtimeCodeHash: hashControlBytes('0x6000') };
const actor = a('2'), account = a('3'), token = { ...pin, controller: a('4') };
class Store implements PublicOperationStore {
  state: OperationState | null = null;
  async read() { return this.state === null ? null : parseOperation(serializeOperation(this.state)); }
  async compareAndSwap(expected: bigint | null, next: OperationState) {
    if ((this.state?.revision ?? null) !== expected) return false;
    this.state = parseOperation(serializeOperation(next)); return true;
  }
}
function fixture(options: { sendFails?: boolean; reject?: boolean; preflightFails?: boolean; withdrawal?: boolean; withdrawalAllowed?: boolean } = {}) {
  const sent: any[] = [], calls: string[] = [];
  const provider: Eip1193Provider = { async request({ method, params }) {
    calls.push(method);
    if (method === 'eth_chainId') return '0x88bb0';
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_accounts') return [actor];
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_getTransactionReceipt') return null;
    if (method === 'eth_sendTransaction') { sent.push(params?.[0]); if (options.reject) throw { code: 4001 }; if(options.sendFails) throw Error('synthetic transport loss'); return h('a'); }
    if (method === 'eth_call') {
      const tx = params?.[0] as any;
      const selector = tx.data.slice(0,10);
      const is = (signature: string, types: any[] = [], values: any[] = []) => selector === encodeCall(signature, types, values).slice(0,10);
      if (is('accountOf(address)', ['address'], [actor])) return encodeWords(['address'], [account]);
      if (is('registeredAccount(address)', ['address'], [account])) return encodeWords(['bool'], [true]);
      if (is('owner()', [], [])) return encodeWords(['address'], [actor]);
      if (is('controller()', [], [])) return encodeWords(['address'], [pin.controller]);
      if (is('ownerOf(uint256)', ['uint256'], [1n])) return encodeWords(['address'], [options.withdrawal ? account : actor]);
      if (is('standaloneWithdrawalAllowed(address,uint256)', ['address','uint256'], [token.controller,1n])) return encodeWords(['bool'], [options.withdrawalAllowed !== false]);
      if (is('supportsInterface(bytes4)', ['bytes4'], ['0x01ffc9a7'])) return encodeWords(['bool'], [!tx.data.includes('ffffffff')]);
      if (options.preflightFails) throw Error('synthetic revert');
      return '0x';
    }
    throw Error('unexpected ' + method);
  }};
  return { provider, sent, calls };
}
const create = { kind: 'control', action: { kind: 'create-account' } } as const;
test('V2 account creation keeps same calldata, journal and pending result', async () => {
  const {provider,sent}=fixture(), store=new Store(), session=new StandaloneAccountSession(provider,pin,actor,store);
  const result=await session.execute(create);
  assert.equal(sent.length,1); assert.equal(sent[0].data, encodeCall('createAccount()',[],[]));
  assert.equal(result.schema,'8415-control-submission/1'); assert.equal(store.state?.status,'submitted');
  assert.equal((await session.reconcile()).state,'pending');
  await assert.rejects(session.execute(create),/RECONCILIATION_REQUIRED/);
  assert.equal('reader' in session,false); assert.equal('payments' in session,false); assert.equal('consent' in session,false);
});
test('V2 account lookup, deposit and standalone withdrawal preserve exact transfers', async () => {
  for (const withdrawal of [false,true]) {
    const {provider,sent}=fixture({withdrawal}), store=new Store(), session=new StandaloneAccountSession(provider,pin,actor,store);
    assert.equal((await session.accounts.account(actor))?.account,account);
    await session.execute(withdrawal ? {kind:'standalone-withdraw',token,tokenId:1n,destination:a('5')} : {kind:'deposit',token,tokenId:1n});
    assert.equal(sent.length,1); assert.equal(sent[0].to,withdrawal?account:token.controller);
    assert.equal(sent[0].data,withdrawal?encodeCall('withdrawStandalone(address,uint256,address)',['address','uint256','address'],[token.controller,1n,a('5')]):encodeCall('safeTransferFrom(address,address,uint256)',['address','address','uint256'],[actor,account,1n]));
  }
});
test('V2 withdrawal retains active obligation refusal, with no send', async () => {
  const {provider,sent}=fixture({withdrawal:true,withdrawalAllowed:false}), store=new Store(), session=new StandaloneAccountSession(provider,pin,actor,store);
  await assert.rejects(session.execute({kind:'standalone-withdraw',token,tokenId:1n,destination:a('5')}),/ACTIVE_RESPONSIBILITY_REFUSED/);
  assert.equal(sent.length,0); assert.equal(store.state?.status,'idle');
});
test('V2 unknown send survives restart and cannot resend or discard prepared intent', async () => {
  const {provider,sent}=fixture({sendFails:true}), store=new Store();
  await assert.rejects(new StandaloneAccountSession(provider,pin,actor,store).execute(create));
  assert.equal(store.state?.status,'outcome-unknown');
  const restarted=new StandaloneAccountSession(provider,pin,actor,store);
  await assert.rejects(restarted.execute(create),/RECONCILIATION_REQUIRED/);
  await assert.rejects(restarted.discardUnpreparedIntent(),/PREPARED_INTENT_CANNOT_DISCARD/);
  await assert.rejects(restarted.recoverTransactionHash(h('b')),/RECOVERY_BINDING_NOT_OBSERVED/);
  assert.equal(sent.length,1);
});
test('V2 exact EIP1193 rejection and preflight failure return only own reservation to idle', async () => {
  for (const options of [{reject:true},{preflightFails:true}]) {
    const {provider,sent}=fixture(options), store=new Store();
    await assert.rejects(new StandaloneAccountSession(provider,pin,actor,store).execute(create));
    assert.equal(store.state?.status,'idle'); assert.equal(sent.length,options.reject?1:0);
  }
});
test('V2 linked actions and injected extra fields refuse before state or provider calls', async () => {
  for (const input of [{kind:'control',action:{kind:'forward'}},{kind:'allocate'}, {kind:'control',action:{kind:'create-account',consent:'injected'}}, {...create, payment:'injected'}]) {
    const {provider,calls}=fixture(),store=new Store();
    await assert.rejects(new StandaloneAccountSession(provider,pin,actor,store).execute(input as any),/ACTION_REFUSED/);
    assert.equal(store.state,null); assert.equal(calls.length,0);
  }
});
const record: ControlSubmission={schema:'8415-control-submission/1',deployment:pin,kind:'create-account',transactionHash:h('a'),actor,nonce:7n,calldataHash:hashControlBytes(encodeCall('createAccount()',[],[])),sequenceId:null,legId:null,expectedRevision:null,acceptanceHash:null};
test('V2 old account journal remains compatible while linked/hash-swapped journals refuse', () => {
  assert.deepEqual(parseControlSubmission(serializeControlSubmission(record)),record);
  for (const change of [{kind:'forward'}, {sequenceId:h('b')}, {calldataHash:h('c')}, {privateKey:'never'}])
    assert.throws(()=>parseControlSubmission(JSON.stringify({...JSON.parse(serializeControlSubmission(record)),...change})));
});
function receiptProvider(change: (method:string,value:any)=>any=(_m,v)=>v):Eip1193Provider {
  const blockHash=h('b'),data=encodeCall('createAccount()',[],[]);
  return {async request({method}) {const table:Record<string,unknown>={eth_chainId:'0x88bb0',eth_getCode:'0x6000',eth_blockNumber:'0xa',eth_getBlockByNumber:{hash:blockHash},
    eth_getTransactionByHash:{hash:record.transactionHash,from:actor,to:pin.controller,blockHash,blockNumber:'0xa',chainId:'0x88bb0',value:'0x0',nonce:'0x7',input:data},
    eth_getTransactionReceipt:{transactionHash:record.transactionHash,from:actor,to:pin.controller,blockHash,blockNumber:'0xa',status:'0x1',logs:[{address:pin.controller,topics:[keccak256Utf8('AccountCreated(address,address)'),encodeWords(['address'],[actor]),encodeWords(['address'],[account])],data:'0x',blockHash,transactionHash:record.transactionHash,removed:false}]}};
    assert.ok(Object.hasOwn(table,method));return change(method,structuredClone(table[method]));}};
}
test('V2 account receipt checks canonical nonce/hash/event and never reports protocol finality',async()=>{
  const result=await new AccountFactoryClient(receiptProvider(),pin).receipt(record);
  assert.equal(result.state,'confirmed');assert.equal(result.protocolFinality,'not-evaluated');
  for(const change of [(m:string,v:any)=>m==='eth_getTransactionByHash'?{...v,nonce:'0x6'}:v,(m:string,v:any)=>m==='eth_getTransactionReceipt'?{...v,logs:[]}:v])
    await assert.rejects(new AccountFactoryClient(receiptProvider(change),pin).receipt(record));
  const reorg=await new AccountFactoryClient(receiptProvider((m,v)=>m==='eth_getBlockByNumber'?{hash:h('c')}:v),pin).receipt(record);assert.equal(reorg.state,'reorged');
});
test('V2 old pending transfer journal survives restart; payment and linked journals refuse without clearing', async()=>{
  const fixed={schema:'8415-fixed-submission/1' as const,pin:token,guards:[pin,{...pin,controller:account}],actor,value:0n,nonce:7n,transactionHash:h('a'),calldataHash:h('c'),event:{address:token.controller,signature:'Transfer(address,address,uint256)',indexed:[encodeWords(['address'],[actor]),encodeWords(['address'],[account]),encodeWords(['uint256'],[1n])],dataHash:hashControlBytes('0x')}};
  const state:OperationState={schema:'8415-operation/1',revision:3n,status:'submitted',deployment:pin,actor,requestDigest:h('d'),submission:fixed};
  const serialized=serializeOperation(state), store=new Store();store.state=parseOperation(serialized);
  const {provider,sent}=fixture();
  const restarted=new StandaloneAccountSession(provider,pin,actor,store);
  assert.deepEqual(await restarted.status(),state);await assert.rejects(restarted.execute(create),/RECONCILIATION_REQUIRED/);assert.equal(sent.length,0);
  for(const mutate of [(r:any)=>{r.submission=JSON.stringify({...JSON.parse(r.submission),event:{...JSON.parse(r.submission).event,signature:'Funded(bytes32,bytes32,address,address,uint256)'}});},(r:any)=>{r.submission=JSON.stringify({...JSON.parse(serializeControlSubmission(record)),kind:'forward'});}]){
    const raw=JSON.parse(serialized);mutate(raw);assert.throws(()=>parseOperation(JSON.stringify(raw)));
  }
  assert.deepEqual(store.state,state);
});
test('V2 terminal acknowledgement rereads exact receipt before clearing',async()=>{
  const store=new Store();store.state={schema:'8415-operation/1',revision:2n,status:'submitted',deployment:pin,actor,requestDigest:h('d'),submission:record};
  const session=new StandaloneAccountSession(receiptProvider(),pin,actor,store);
  await assert.rejects(session.acknowledgeTerminal(h('e')),/TRANSACTION_BINDING_REFUSED/);
  assert.equal(store.state.status,'submitted');await session.acknowledgeTerminal(h('a'));
  assert.equal(store.state.status,'idle');assert.equal(store.state.submission,null);assert.equal(store.state.revision,3n);
});
test('V2 wrong-chain provider refuses before account submission',async()=>{
  const {provider,sent}=fixture(), store=new Store();
  const wrong:Eip1193Provider={request:args=>args.method==='eth_chainId'?Promise.resolve('0x1'):provider.request(args)};
  await assert.rejects(new StandaloneAccountSession(wrong,pin,actor,store).execute(create),/CHAIN_MISMATCH/);
  assert.equal(sent.length,0);assert.equal(store.state?.status,'idle');
});
