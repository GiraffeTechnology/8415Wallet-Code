import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTaskAuthorizationService, freezeTaskExecutorIdentity } from '../server/task-authorization.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freezeTaskPolicy, freezeChildOperation } from '../src/agent/taskContract.ts';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';
import { hashControlBytes } from '../src/controls/authorization.ts';

// Pure synthetic service-composition definitions. The receipt port below is a
// trusted test double, not canonical chain proof. Real read-only wire verification
// remains separately covered by task-receipt-observation tests, all NOT_RUN here.
const h = n => '0x' + n.repeat(64), a = n => '0x' + n.repeat(40), epoch = 1800000000000;
async function fixture({ lostResponse = false, existingStore = null } = {}) {
  const state = { now: epoch, sends: 0, approvals: 0, currentReads: 0, historicalReads: 0,
    confirmations: '3', mutate: null, onRead: null };
  const actor = a('1'), origin = 'https://wallet.example.invalid', tenant = 'synthetic';
  const store = existingStore ?? new MemoryCredentialStore({ 'synthetic:tester': { revision: 1, sentinel: 'preserve-me' } });
  const session = { username: 'tester', account: actor, chainId: '11155111', id: 'synthetic-session',
    revision: 1, issuedAt: epoch, expiresAt: epoch + 10000000 };
  const policy = { schema: '8415-agent-task/1', taskId: 'synthetic:historical', origin, tenant,
    actor, chainId: '11155111', expiresAt: String(epoch / 1000 + 3600),
    fees: { perOperationWei: '1000000', totalWei: '1000000' },
    intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId: '11155111',
      actor, recipient: a('2'), valueWei: '10' } } };
  const task = freezeTaskPolicy(policy), child = freezeChildOperation({ schema: '8415-agent-child/1',
    operationId: 'synthetic:operation', taskDigest: task.digest, operation: task.policy.intent.operation,
    nonce: '7', expiresAt: String(epoch / 1000 + 600), wire: { to: a('2'), calldataHash: hashControlBytes('0x'), valueWei: '10' },
    fees: { gasLimit: '21000', maxFeePerGasWei: '3' }, market: null });
  const key = 'task-operation:' + createHash('sha256').update(JSON.stringify(['11155111', actor, child.child.operationId])).digest('hex');
  let service, configuredReceipt;
  function assertSession(s, credential) {
    assert.equal(s, session); assert.ok(state.now < session.expiresAt);
    if (credential !== undefined) assert.equal(credential.revision, 1);
  }
  const bound = input => ({ taskDigest: input.task.digest, childDigest: input.child.digest,
    chainId: input.task.policy.chainId, actor: input.task.policy.actor, nonce: input.child.child.nonce,
    executorDigest: input.executor.digest, grantPolicyVersion: input.grantPolicyVersion });
  function configure({ version = '1', minimum = '2', historical = true,
    agentId = 'synthetic:agent', adapterId = 'synthetic:exact',
    verifierId = 'synthetic:receipt', receiptConnected = true } = {}) {
    const identity = { schema: '8415-task-executor/1', agentId, agentVersion: version,
      adapterId, adapterVersion: '1', implementationDigest: version === '1' ? h('4') : h('5') };
    const executor = freezeTaskExecutorIdentity(identity);
    const verifier = { verifierId, verifierVersion: '1', verifierImplementationDigest: version === '1' ? h('6') : version === '2' ? h('7') : h('8') };
    const observationPolicy = freezeTaskObservationPolicy({ minimumConfirmations: minimum });
    const execution = {
      async verify(input) { return bound(input); },
      async send(input) { state.sends++; if (lostResponse) throw Error('Synthetic lost response');
        return { ...bound(input), transactionHash: h('a') }; },
      async recover(input) { return { ...bound(input), state: 'submitted', transactionHash: h('a') }; },
      async recoverHistorical(input) { return { ...bound(input), state: 'submitted', transactionHash: h('a') }; },
    };
    const makeObservation = async (input, old) => {
      if (old) state.historicalReads++; else state.currentReads++;
      if (state.onRead) await state.onRead(input);
      const oldPolicy = freezeTaskObservationPolicy(input.observationPolicy);
      const observed = { schema: '8415-task-observation/1', taskDigest: input.task.digest, childDigest: input.child.digest,
        chainId: input.task.policy.chainId, actor: input.task.policy.actor, nonce: input.child.child.nonce,
        attemptExecutorDigest: input.attempt.executorDigest, attemptGrantPolicyVersion: input.attempt.grantPolicyVersion,
        originalTransactionHash: input.attempt.transactionHash, observationPolicy: oldPolicy.policy,
        observationPolicyDigest: oldPolicy.digest, state: 'confirmed-at-depth', blockNumber: '100', blockHash: h('b'),
        confirmations: state.confirmations, replacementHash: null, observedAt: String(Math.floor(state.now / 1000)),
        effect: 'exact-operation-observed', protocolFinality: 'not-evaluated', economicFinality: 'not-evaluated', ...verifier };
      return state.mutate ? state.mutate(observed) : observed;
    };
    configuredReceipt = { identity: verifier, observationPolicy,
      async assessChild(input) { return { taskDigest: input.task.digest, childDigest: input.child.digest,
        executorDigest: input.executor.digest, observationPolicyDigest: observationPolicy.digest, ...verifier,
        capability: 'exact-operation-observable' }; },
      observe: input => makeObservation(input, false),
      ...(historical ? { observeHistorical: input => makeObservation(input, true) } : {}) };
    service = createTaskAuthorizationService({ origin, tenant, store, now: () => state.now, assertSession,
      credentialFor: async s => { const c = await store.read('synthetic:tester'); assertSession(s, c); return c; },
      consumeTotp(s, credential, code) { assertSession(s, credential); assert.equal(code, '123456'); state.approvals++; return credential; },
      execution, executorIdentity: executor.identity, observationPolicy: observationPolicy.policy,
      receipt: receiptConnected ? configuredReceipt : null });
    return { executor, verifier, observationPolicy, configuredReceipt };
  }
  configure();
  const call = (path, body) => service.handler('tasks/' + path, body, session);
  const body = status => ({ taskDigest: task.digest, operationId: child.child.operationId,
    childDigest: child.digest, expectedBudgetRevision: status.budget.revision });
  async function start() {
    const p = await call('prepare', { policy });
    const g = await call('authorize', { challengeId: p.challengeId, taskDigest: task.digest,
      executorDigest: p.executor.digest, observationPolicyDigest: p.observationPolicy.digest, code: p.approvalFactor === 'totp' ? '123456' : '' });
    const r = await call('reserve', { taskDigest: task.digest, child: child.child, expectedBudgetRevision: g.budget.revision });
    return call('execute', body(r));
  }
  return { state, store, session, task, child, key, call, body, start, configure,
    status: () => call('status', { taskDigest: task.digest }),
    source: mode => service.observationDetails.resolve({taskDigest:task.digest,operationId:child.child.operationId,childDigest:child.digest,mode},session),
    readSource: (source,mode='cache') => service.observationDetails.read({taskDigest:task.digest,
      operationId:child.child.operationId,childDigest:child.digest,mode,sourceReference:source.sourceReference,
      sourceRevision:source.sourceRevision,capabilityReference:source.capabilityReference,capabilityRevision:source.capabilityRevision},session),
    details: () => service.observationDetails };
}

test('refresh independently registers a trusted attempt-scoped source before bound evidence is read',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  const source=await f.source('refresh');
  assert.equal(source.schema,'8415-observation-source/1');assert.equal(source.canExecute,false);
  assert.equal(source.attempt.nonce,'7');assert.equal(source.attempt.operationId,f.child.child.operationId);
  assert.equal(source.sourceRevision,'1');assert.equal(source.capabilityRevision,'1');
  assert.equal(f.state.historicalReads,0);assert.equal(f.state.sends,1);
  const entry=await f.readSource(source,'refresh');
  assert.equal(entry.schema,'8415-bound-observation-entry/1');assert.equal(entry.sourceReference,source.sourceReference);
  assert.equal(entry.capabilityReference,source.capabilityReference);assert.equal(entry.available,true);
  assert.equal(entry.acceptedObserverContext.verifier.verifierImplementationDigest,source.verifier.verifierImplementationDigest);
  assert.equal(f.state.historicalReads,1);assert.equal(f.state.approvals,0);
  const op=await f.store.read(f.key),grant=await f.store.read(op.grantKey);
  assert.equal(grant.observations[0].schema,'8415-task-observation-record/3');
  assert.equal(grant.observationSources.records.length,1);assert.deepEqual(grant.budget,submitted.budget);
});
test('direct existing observe also persists the same independent registry contract',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  const observed=await f.call('observe',f.body(submitted)),source=await f.source('cache');
  assert.equal(observed.observations[0].provenance,'accepted-observer-context');
  assert.equal(source.verifier.verifierImplementationDigest,observed.observations[0].observation.verifierImplementationDigest);
  assert.equal(f.state.sends,1);
});
test('cached O2 resolves from durable saved references after O3 service construction',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));const old=await f.source('cache'),first=await f.readSource(old);
  f.configure({version:'3'});
  const cached=await f.source('cache'),entry=await f.readSource(cached);
  assert.deepEqual(cached,old);assert.deepEqual(entry,first);assert.equal(f.state.historicalReads,1);
  const current=await f.source('refresh');assert.notEqual(current.sourceReference,old.sourceReference);
  assert.notDeepEqual(current.verifier,old.verifier);
  assert.deepEqual(await f.source('cache'),old);
});
test('fresh O3 cannot be read through the independently resolved O2 source',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));const old=await f.source('cache');
  f.configure({version:'3'});const current=await f.source('refresh');await f.readSource(current,'refresh');
  await assert.rejects(f.readSource(old),/TASK_OBSERVATION_SOURCE_REVISION_CONFLICT/);
  assert.deepEqual((await f.readSource(current)).acceptedObserverContext.verifier,current.verifier);
});
test('failed O3 refresh preserves prior O2 evidence, accepted revision and observed timestamp',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));const old=await f.source('cache'),before=await f.readSource(old);
  f.configure({version:'3'});const current=await f.source('refresh');
  f.state.mutate=o=>({...o,originalTransactionHash:h('c')});
  await assert.rejects(f.readSource(current,'refresh'),/TASK_OBSERVATION_UNAVAILABLE/);
  const cached=await f.source('cache'),after=await f.readSource(cached);
  assert.deepEqual(cached,old);assert.equal(after.available,false);
  assert.deepEqual(after.observation,before.observation);assert.deepEqual(after.acceptedObserverContext,before.acceptedObserverContext);
  assert.ok(BigInt(after.observationRevision)>BigInt(after.acceptedObserverContext.acceptedObservationRevision));
  assert.equal(f.state.sends,1);
});
test('first failed observation does not create a verified cached source or fake timestamp',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2'});const source=await f.source('refresh');
  f.state.mutate=o=>({...o,nonce:'8'});
  await assert.rejects(f.readSource(source,'refresh'),/TASK_OBSERVATION_UNAVAILABLE/);
  await assert.rejects(f.source('cache'),/TASK_OBSERVATION_SOURCE_UNSUPPORTED/);
  const status=await f.status();assert.equal(status.observations[0].observation,null);
  assert.equal(status.observations[0].acceptedObserverContext,null);
});
test('resolved source capability revision is compared at the authoritative observation CAS',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2'});const source=await f.source('refresh');
  const op=await f.store.read(f.key),before=await f.store.read(op.grantKey);
  f.state.onRead=async()=>{await f.store.transaction(op.grantKey,g=>({...g,observationSources:{...g.observationSources,
    records:g.observationSources.records.map(r=>({...r,capabilityRevision:'2'}))}}));};
  await assert.rejects(f.readSource(source,'refresh'),/TASK_OBSERVATION_SOURCE_REVISION_CONFLICT/);
  const after=await f.store.read(op.grantKey),operation=await f.store.read(f.key);
  assert.deepEqual(after.budget,before.budget);assert.equal(operation.observationRevision,op.observationRevision);
  assert.equal(after.observations.length,0);assert.equal(f.state.sends,1);
});
test('revoked captured source cannot be re-admitted from a matching digest or another refresh',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2'});await f.source('refresh');
  const op=await f.store.read(f.key);
  await f.store.transaction(op.grantKey,g=>({...g,observationSources:{...g.observationSources,
    records:g.observationSources.records.map(r=>({...r,status:'revoked',capabilityRevision:'2'}))}}));
  await assert.rejects(f.source('refresh'),/TASK_OBSERVATION_SOURCE_REVOKED/);
  assert.equal(f.state.historicalReads,0);assert.equal(f.state.sends,1);
});
test('concurrent refreshes from one operation revision cannot both commit',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  let release;const gate=new Promise(resolve=>{release=resolve;});let arrived=0,ready;
  const both=new Promise(resolve=>{ready=resolve;});
  f.state.onRead=async()=>{if(++arrived===2)ready();await gate;};
  const one=f.call('observe',f.body(submitted)),two=f.call('observe',f.body(submitted));
  await both;release();const results=await Promise.allSettled([one,two]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const rejected=results.find(r=>r.status==='rejected');assert.match(String(rejected.reason),/TASK_OBSERVATION_REVISION_CONFLICT/);
  assert.equal(f.state.sends,1);
});
test('durable nonce changes after source capture cannot be hidden by matching observation JSON',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2'});const source=await f.source('refresh');
  f.state.onRead=async()=>{await f.store.transaction(f.key,op=>({...op,child:{...op.child,child:{...op.child.child,nonce:'8'}}}));};
  await assert.rejects(f.readSource(source,'refresh'),/TASK_OBSERVATION_SOURCE_ATTEMPT_REFUSED/);
  assert.equal(f.state.sends,1);
});
test('cached nonce cannot prove itself by changing observation, context and digest together',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));const op=await f.store.read(f.key);
  await f.store.transaction(op.grantKey,g=>({...g,observations:g.observations.map(row=>{
    const observation={...row.observation,nonce:'8'};
    return {...row,observation,acceptedObserverContext:{...row.acceptedObserverContext,
      attempt:{...row.acceptedObserverContext.attempt,nonce:'8'},
      fullObservationDigest:'0x'+createHash('sha256').update(JSON.stringify(observation)).digest('hex')}};
  })}));
  const status=await f.status();assert.equal(status.observations[0].available,false);
  assert.equal(status.observations[0].observation,null);assert.equal(status.observations[0].provenance,'unverified');
  await assert.rejects(f.source('cache'),/TASK_OBSERVER_CONTEXT_REFUSED/);
});
test('grant revocation does not block permitted historical inspection or re-enable execution',async()=>{
  const f=await fixture(),submitted=await f.start();
  const revoked=await f.call('revoke',{taskDigest:f.task.digest,expectedGrantPolicyVersion:submitted.authorization.grantPolicyVersion});
  f.configure({version:'2'});const source=await f.source('refresh'),entry=await f.readSource(source,'refresh');
  assert.equal(entry.available,true);const status=await f.status();assert.equal(status.effectiveStatus,'revoked');
  assert.equal(source.attempt.grantPolicyVersion,submitted.authorization.grantPolicyVersion);
  assert.notEqual(source.attempt.grantPolicyVersion,revoked.authorization.grantPolicyVersion);
  assert.equal(f.state.sends,1);assert.equal(f.state.approvals,0);
});
test('unknown transactions with no durable hash remain reconcile-only, not a fabricated observation',async()=>{
  const f=await fixture({lostResponse:true});const unknown=await f.start();
  assert.equal(unknown.outcome,'outcome-unknown');f.configure({version:'2'});
  await assert.rejects(f.source('refresh'),/TASK_OBSERVATION_SOURCE_ATTEMPT_REFUSED/);
  assert.equal(f.state.sends,1);assert.equal(f.state.historicalReads,0);
});
test('source and evidence method bodies reject caller-supplied verifier, identity and imported registry',async()=>{
  const f=await fixture();await f.start();
  const body={taskDigest:f.task.digest,operationId:f.child.child.operationId,childDigest:f.child.digest,mode:'refresh'};
  for(const extra of [{verifier:{verifierId:'forged'}},{account:a('9')},{observationSources:{records:[]}},{compatible:true}])
    await assert.rejects(f.details().resolve({...body,...extra},f.session),/TASK_REQUEST_REFUSED/);
  assert.equal(f.state.historicalReads,0);
});
test('cross-child and cross-account source lookups are refused without tenant enumeration',async()=>{
  const f=await fixture();await f.start();
  const body={taskDigest:f.task.digest,operationId:f.child.child.operationId,childDigest:h('f'),mode:'cache'};
  await assert.rejects(f.details().resolve(body,f.session),/TASK_OPERATION_NOT_FOUND/);
  await assert.rejects(f.details().resolve({...body,childDigest:f.child.digest},
    {...f.session,account:a('9')}),/ERR_ASSERTION|TASK_GRANT_NOT_FOUND/);
});
test('a configured port object cannot be swapped after the source was captured',async()=>{
  const f=await fixture(),submitted=await f.start(),configured=f.configure({version:'2'});
  configured.configuredReceipt.observeHistorical=()=>{throw Error('UNTRUSTED_REPLACEMENT');};
  const source=await f.source('refresh'),entry=await f.readSource(source,'refresh');
  assert.equal(entry.available,true);assert.equal(f.state.historicalReads,1);assert.equal(f.state.sends,1);
});
test('original grant, attempt and budget stay unchanged while only observation registry/evidence advance',async()=>{
  const f=await fixture(),submitted=await f.start(),operation=await f.store.read(f.key),before=await f.store.read(operation.grantKey);
  f.configure({version:'2'});const source=await f.source('refresh');await f.readSource(source,'refresh');
  const after=await f.store.read(operation.grantKey),op=await f.store.read(f.key);
  for(const key of ['executor','receiptVerifier','observationPolicy','reference','task','grantPolicyVersion','budget'])
    assert.deepEqual(after[key],before[key]);
  for(const key of ['attemptExecutor','attemptReceiptVerifier','attemptObservationPolicy','attemptGrantPolicyVersion','status','child','nonceKey'])
    assert.deepEqual(op[key],operation[key]);
  assert.equal((await f.store.read(operation.nonceKey)).permanent,true);
});
test('a higher old policy floor is retained when current observer configuration has a lower floor',async()=>{
  const f=await fixture();const first=f.configure({version:'1',minimum:'4'}),submitted=await f.start();
  f.state.confirmations='5';f.configure({version:'2',minimum:'2'});
  const source=await f.source('refresh');assert.equal(source.verificationPolicy.policy.minimumConfirmations,'4');
  const entry=await f.readSource(source,'refresh');
  assert.equal(entry.observation.observationPolicy.minimumConfirmations,'4');
  assert.equal(entry.acceptedObserverContext.verificationPolicy.policy.minimumConfirmations,'4');
  assert.equal(entry.acceptedObserverContext.attempt.observationPolicy.digest,first.observationPolicy.digest);
});
test('an absent historical method is a concrete capability refusal, never another human approval',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2',historical:false});
  await assert.rejects(f.source('refresh'),/TASK_RECEIPT_HISTORICAL_CAPABILITY_REQUIRED/);
  assert.equal(f.state.approvals,0);assert.equal(f.state.sends,1);assert.equal(f.state.historicalReads,0);
});
test('missing registry leaves evidence private and unavailable rather than reconstructing trust from a digest',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));const op=await f.store.read(f.key);
  await f.store.transaction(op.grantKey,g=>{const next={...g};delete next.observationSources;return next;});
  const status=await f.status();assert.equal(status.observations[0].available,false);
  assert.equal(status.observations[0].observation,null);assert.equal(status.observations[0].acceptedObserverContext,null);
  await assert.rejects(f.source('cache'),/TASK_OBSERVATION_SOURCE_REVISION_CONFLICT/);
  assert.equal((await f.store.read(op.grantKey)).observations[0].observation.nonce,'7');
});
test('per-operation saved revision cannot be replaced by a newer standalone counter',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));await f.store.transaction(f.key,op=>({...op,observationRevision:'9'}));
  await assert.rejects(f.source('cache'),/TASK_OBSERVATION_REVISION_CONFLICT/);
});
test('legacy same-original-verifier evidence retains its original strict cached path without an invented registry',async()=>{
  const f=await fixture(),submitted=await f.start();await f.call('observe',f.body(submitted));const op=await f.store.read(f.key);
  await f.store.transaction(op.grantKey,g=>({...g,observations:g.observations.map(row=>({operationId:row.operationId,
    observation:row.observation,available:true}))}));
  f.configure({version:'3'});const status=await f.status();
  assert.equal(status.observations[0].provenance,'legacy-approved-cache');
  assert.equal(status.observations[0].acceptedObserverContext,null);assert.equal(status.completion.fresh,false);
  await assert.rejects(f.source('cache'),/TASK_OBSERVATION_SOURCE_UNSUPPORTED/);
});
test('a missing current receipt port does not erase an independently registered cached O2 source',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));const old=await f.source('cache');
  f.configure({version:'3',receiptConnected:false});
  assert.deepEqual(await f.source('cache'),old);assert.equal((await f.readSource(old)).available,true);
  await assert.rejects(f.source('refresh'),/TASK_RECEIPT_HISTORICAL_CAPABILITY_REQUIRED/);
  assert.equal(f.state.sends,1);
});
test('encrypted-store close/reopen retains source references, original attempt and old O2 without resend',async()=>{
  // This definition may execute only in the authorized remote Linux test run.
  // Fresh synthetic store only; no production state or real credential/key.
  const dir=await mkdtemp(join(tmpdir(),'wallet2-observer-registry-')),path=join(dir,'synthetic-store.json');
  const syntheticEncryptionKey=Buffer.alloc(32,7);let firstStore=null,secondStore=null;
  try {
    firstStore=await openEncryptedStore(path,syntheticEncryptionKey);
    await firstStore.transaction('synthetic:tester',()=>({revision:1,sentinel:'preserve-me'}));
    const before=await fixture({existingStore:firstStore}),submitted=await before.start();
    before.configure({version:'2'});await before.call('observe',before.body(submitted));
    const source=await before.source('cache'),entry=await before.readSource(source);
    await firstStore.close();firstStore=null;
    secondStore=await openEncryptedStore(path,syntheticEncryptionKey);
    const after=await fixture({existingStore:secondStore});after.configure({version:'3',receiptConnected:false});
    assert.deepEqual(await after.source('cache'),source);assert.deepEqual(await after.readSource(source),entry);
    assert.equal(after.state.sends,0);assert.equal(after.state.approvals,0);assert.equal(after.state.historicalReads,0);
    const operation=await secondStore.read(after.key);assert.equal(operation.status,'submitted');
    assert.equal((await secondStore.read(operation.nonceKey)).permanent,true);
  } finally {
    if(firstStore)await firstStore.close();if(secondStore)await secondStore.close();
    await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
    // Nonrecursive: any unexpected file is preserved and rmdir fails safely.
    await rmdir(dir);
  }
});
test('opaque reference and noncanonical source/capability revision cannot manufacture a trusted source',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2'});const source=await f.source('refresh');
  for(const change of [{sourceReference:'observation-source:'+h('f').slice(2)},{capabilityReference:'forged'},
    {sourceRevision:'01'},{capabilityRevision:'0'},{sourceRevision:String(1n<<256n)}])
    await assert.rejects(f.readSource({...source,...change}),/TASK_OBSERVATION_SOURCE_(REFUSED|REVISION_CONFLICT)/);
  assert.equal(f.state.historicalReads,0);assert.equal(f.state.sends,1);
});
test('source revision changes during verification are compared independently of capability revision',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2'});const source=await f.source('refresh');
  const op=await f.store.read(f.key);
  f.state.onRead=async()=>{await f.store.transaction(op.grantKey,g=>({...g,observationSources:{...g.observationSources,
    records:g.observationSources.records.map(r=>({...r,sourceRevision:'2'}))}}));};
  await assert.rejects(f.readSource(source,'refresh'),/TASK_OBSERVATION_SOURCE_REVISION_CONFLICT/);
  assert.equal((await f.store.read(f.key)).observationRevision,op.observationRevision);
});
test('strict observation schema is not widened by the compatibility registry',async()=>{
  const f=await fixture();await f.start();f.configure({version:'2'});const source=await f.source('refresh');
  f.state.mutate=o=>({...o,compatible:true});
  await assert.rejects(f.readSource(source,'refresh'),/TASK_OBSERVATION_UNAVAILABLE/);
  const status=await f.status();assert.equal(status.observations[0].observation,null);
  assert.equal(f.state.sends,1);
});
test('unsupported durable envelope version cannot be interpreted as legacy',async()=>{
  const f=await fixture(),submitted=await f.start();f.configure({version:'2'});
  await f.call('observe',f.body(submitted));const op=await f.store.read(f.key);
  await f.store.transaction(op.grantKey,g=>({...g,observations:g.observations.map(row=>({...row,schema:'8415-task-observation-record/99'}))}));
  await assert.rejects(f.status(),/TASK_OBSERVER_CONTEXT_REFUSED/);assert.equal(f.state.sends,1);
});

