import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Isolated composition tests, not controller provenance or real chain evidence.
// Product source imports actual H8/H7. Only this test's unique data module uses
// transport doubles; it offers no dependency-injection switch in production.
async function harness() {
  const salt = Math.random().toString(36);
  const stateModule = 'data:text/javascript,' + encodeURIComponent(`
    export const state = { result: null, checked: null, validate: true, captured: null, fault: null };
    export class RpcBlockEndHistoryDiscovery {
      constructor(provider) { state.provider = provider; }
      async discoverAt(q) { state.captured = q; if(state.fault) throw state.fault; return state.result; }
    }
    export class RpcHistoryMilestoneValidator {
      async validateMilestone(q) { state.checked=q; if(state.fault) throw state.fault; return state.validate; }
    }
    export class ResponsibilityControlClient {
      constructor(_provider, pin) { this.deployment=Object.freeze({...pin}); }
    }
    export const controlRpc = (provider,method,params) => provider.request({method,params});
    export class ForwardProgressError extends Error { constructor(code) { super(code); this.status=503; } }
    // ` + salt);
  const state = await import(stateModule);
  let source = await readFile(new URL('../server/forward-progress-reader.mjs', import.meta.url), 'utf8');
  for (const path of ['../src/controls/historyDiscovery.ts', '../src/controls/historyMilestone.ts',
    '../src/controls/client.ts', '../src/controls/authorization.ts', './forward-progress-service.mjs']) source = source.replace("'" + path + "'", JSON.stringify(stateModule));
  const {createRpcForwardProgressReader} = await import('data:text/javascript,' + encodeURIComponent(source) + '#' + salt);
  const hash = n => '0x'+n.repeat(64), account='0x'+'1'.repeat(40), contract='0x'+'2'.repeat(40);
  const q={principal:{tenant:'example',origin:'https://wallet.example',username:'alice',account,chainId:'560048'},
    asset:{chainId:'560048',contract,tokenId:'7'},sequenceId:hash('3')};
  const anchor={blockNumber:5n,blockHash:hash('5')}, prior={blockNumber:3n,blockHash:hash('4')};
  const bound = at => ({kind:'bound',principal:{...q.principal},asset:{chainId:560048n,contract,tokenId:7n},
    sequenceId:q.sequenceId,anchor:at,readOnly:true,canExecute:false,displayMilestone:'not-evaluated',
    ownOccurrenceId:hash('6'),ownPosition:1n,source:{snapshot:{example:at.blockNumber},evidence:{example:true}}});
  state.state.result={kind:'found',current:bound(anchor),candidate:bound(prior),
    progress:{state:'DONE',canExecute:false,blockNumber:'3',blockHash:prior.blockHash},
    coverage:{kind:'canonical-block-end-only',from:{blockNumber:1n,blockHash:hash('7')},
      through:prior,checkedBlocks:3n,intraBlockStates:'not-established',canExecute:false}};
  const calls=[];
  const provider={request:async args=>{calls.push(args);return {number:'0x5',hash:anchor.blockHash};}};
  const config={provider,pin:{chainId:560048n,controller:contract,runtimeCodeHash:hash('9')},tenant:'example',origin:'https://wallet.example',fromBlock:0n};
  return {factory:createRpcForwardProgressReader,state:state.state,q,config,calls,hash};
}

test('forward reader captures server capabilities without a construction RPC', async () => {
  const h=await harness(), reader=h.factory(h.config);
  assert.deepEqual(h.calls,[]);assert.deepEqual(Object.keys(reader),['readForPrincipal','validateMilestone']);
  assert.ok(Object.isFrozen(reader));
  h.config.provider.request=()=>{throw new Error('replacement must not run');};
  await reader.readForPrincipal(h.q);assert.equal(h.calls.length,1);
});
test('forward reader admits positive bound discovery as private immutable source only', async () => {
  const h=await harness(), out=await h.factory(h.config).readForPrincipal(h.q);
  assert.deepEqual(Object.keys(out),['snapshot','evidence','ownOccurrenceId','historical']);
  assert.equal(out.historical.length,1);assert.equal(out.snapshot.example,5n);assert.equal(out.historical[0].snapshot.example,3n);
  assert.ok(Object.isFrozen(out.historical[0].snapshot));
  assert.equal('coverage' in out,false);assert.equal('canExecute' in out,false);
});
test('forward reader never turns block-end not-found into empty complete history', async () => {
  const h=await harness();h.state.result.kind='not-found-at-block-end';
  await assert.rejects(h.factory(h.config).readForPrincipal(h.q),/FORWARD_PROGRESS_HISTORY_UNAVAILABLE/);
});
test('forward reader rejects namespace, chain, extra principal and getter before RPC', async () => {
  for (const change of [
    q=>{q.principal.tenant='other';},q=>{q.asset.chainId='1';},
    q=>{q.principal.extra=true;},q=>{Object.defineProperty(q.principal,'account',{get(){throw new Error('getter ran');}});}
  ]) {
    const h=await harness();change(h.q);
    await assert.rejects(h.factory(h.config).readForPrincipal(h.q),/FORWARD_PROGRESS_READER_REFUSED/);
    assert.deepEqual(h.calls,[]);
  }
});
test('forward reader read-only fence rejects transaction and identity RPC', async () => {
  const h=await harness();h.factory(h.config);
  for(const method of ['eth_sendTransaction','eth_sendRawTransaction','personal_sign','eth_signTypedData_v4','eth_accounts'])
    await assert.rejects(h.state.provider.request({method,params:[]}),/FORWARD_PROGRESS_RPC_METHOD_REFUSED/);
  assert.deepEqual(h.calls,[]);
});
test('forward reader refuses cross-occurrence or incomplete positive coverage', async () => {
  for(const change of [
    r=>{r.candidate.ownOccurrenceId='0x'+'8'.repeat(64);},
    r=>{r.coverage.checkedBlocks=2n;},r=>{r.coverage.intraBlockStates='complete';},
    r=>{r.current.principal.username='someone-else';},r=>{r.progress.state='PENDING';}
  ]) {
    const h=await harness();change(h.state.result);
    await assert.rejects(h.factory(h.config).readForPrincipal(h.q),/FORWARD_PROGRESS_HISTORY_UNAVAILABLE/);
  }
});
test('forward reader captures principal and asset before asynchronous discovery', async () => {
  const h=await harness();let release;
  h.config.provider.request=()=>new Promise(resolve=>{release=()=>resolve({number:'0x5',hash:h.hash('5')});});
  const promise=h.factory(h.config).readForPrincipal(h.q);
  h.q.principal.username='mutated';h.q.asset.tokenId='8';release();
  await promise;assert.equal(h.state.captured.principal.username,'alice');assert.equal(h.state.captured.asset.tokenId,7n);
});
test('forward reader canonical validator preserves boolean result and masks backend details', async () => {
  const h=await harness(),reader=h.factory(h.config);
  const q={...h.q,ownOccurrenceId:h.hash('6'),milestone:{state:'DONE'}};
  assert.equal(await reader.validateMilestone(q),true);
  h.state.validate=false;assert.equal(await reader.validateMilestone(q),false);
  h.state.fault=new Error('PRIVATE_BACKEND_LOCATION');
  await assert.rejects(reader.validateMilestone(q),e=>e.message==='FORWARD_PROGRESS_MILESTONE_UNAVAILABLE');
  await assert.rejects(reader.readForPrincipal(h.q),e=>e.message==='FORWARD_PROGRESS_HISTORY_UNAVAILABLE');
});
test('forward reader rejects request configuration overrides and accessor capabilities', async () => {
  const h=await harness();
  assert.throws(()=>h.factory({...h.config,signer:()=>{}}),/FORWARD_PROGRESS_READER_REFUSED/);
  let called=false;
  Object.defineProperty(h.config,'fromBlock',{get(){called=true;return 0n;}});
  assert.throws(()=>h.factory(h.config),/FORWARD_PROGRESS_READER_REFUSED/);assert.equal(called,false);
});
