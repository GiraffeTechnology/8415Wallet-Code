import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTaskAuthorizationService, freezeTaskExecutorIdentity } from '../server/task-authorization.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { freezeTaskPolicy, freezeChildOperation } from '../src/agent/taskContract.ts';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';
import { hashControlBytes } from '../src/controls/authorization.ts';

// Pure synthetic service-composition definitions. The receipt port below is a
// trusted test double, not canonical chain proof. Real read-only wire verification
// remains separately covered by task-receipt-observation tests, all NOT_RUN here.
const h = n => '0x' + n.repeat(64), a = n => '0x' + n.repeat(40), epoch = 1800000000000;
async function fixture({ lostResponse = false } = {}) {
  const state = { now: epoch, sends: 0, approvals: 0, currentReads: 0, historicalReads: 0,
    confirmations: '3', mutate: null, onRead: null };
  const actor = a('1'), origin = 'https://wallet.example.invalid', tenant = 'synthetic';
  const store = new MemoryCredentialStore({ 'synthetic:tester': { revision: 1, sentinel: 'preserve-me' } });
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
    verifierId = 'synthetic:receipt' } = {}) {
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
      execution, executorIdentity: executor.identity, observationPolicy: observationPolicy.policy, receipt: configuredReceipt });
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
    source: mode => service.observationDetails.resolve({ taskDigest: task.digest,
      operationId: child.child.operationId, childDigest: child.digest, mode }, session) };
}

test('successful CAS persists accepted observer with old attempt and exact operation revision', async () => {
  const f = await fixture(), submitted = await f.start(), op = await f.store.read(f.key);
  const before = await f.store.read(op.grantKey), current = f.configure({ version: '2' });
  const result = await f.call('observe', f.body(submitted));
  const entry = result.observations[0], stored = (await f.store.read(op.grantKey)).observations[0];
  assert.equal(entry.schema, '8415-task-observation-entry/2');
  assert.equal(entry.provenance, 'accepted-observer-context');
  assert.deepEqual(entry.acceptedObserverContext.verifier, current.verifier);
  assert.deepEqual(entry.acceptedObserverContext.attempt.receiptVerifier, before.receiptVerifier);
  assert.equal(entry.acceptedObserverContext.acceptedObservationRevision, entry.observationRevision);
  assert.deepEqual(stored.acceptedObserverContext, entry.acceptedObserverContext);
  assert.equal(stored.schema, '8415-task-observation-record/3');
  assert.equal(stored.available, true);
  assert.equal(stored.observationRevision, entry.observationRevision);
  assert.deepEqual(stored.observation, entry.observation);
  // The v3 row's references must independently resolve through the durable
  // source registry; changing only the expected schema would miss the binding.
  const source = await f.source('cache'), persisted = await f.store.read(op.grantKey);
  assert.equal(persisted.observationSources.schema, '8415-task-observation-sources/1');
  assert.equal(persisted.observationSources.records.length, 1);
  assert.equal(source.schema, '8415-observation-source/1');
  assert.equal(source.canExecute, false);
  for (const field of ['sourceReference','sourceRevision','capabilityReference','capabilityRevision'])
    assert.equal(stored[field], source[field]);
  assert.match(source.sourceRevision, /^[1-9][0-9]*$/);
  assert.match(source.capabilityRevision, /^[1-9][0-9]*$/);
  assert.deepEqual(source.verifier, current.verifier);
  assert.deepEqual(source.attempt, entry.acceptedObserverContext.attempt);
  assert.equal(source.attempt.taskDigest, f.task.digest);
  assert.equal(source.attempt.operationId, f.child.child.operationId);
  assert.equal(source.attempt.childDigest, f.child.digest);
  assert.equal(source.attempt.chainId, f.task.policy.chainId);
  assert.equal(source.attempt.actor, f.task.policy.actor);
  assert.equal(source.attempt.nonce, f.child.child.nonce);
  assert.equal(source.attempt.transactionHash, before.budget.reservations[0].transactionHash);
  assert.deepEqual(source.attempt.receiptVerifier, before.receiptVerifier);
  assert.equal(result.observationView.freshObservation.fullObservationDigest, entry.acceptedObserverContext.fullObservationDigest);
  assert.deepEqual(result.budget, before.budget);
  assert.equal(f.state.sends, 1);
});

test('O3 cached status retains accepted O2 rather than relabeling cached evidence', async () => {
  const f = await fixture(), submitted = await f.start(); f.configure({ version: '2' });
  const first = await f.call('observe', f.body(submitted)), o3 = f.configure({ version: '3' });
  const result = await f.status();
  assert.deepEqual(result.observations[0].acceptedObserverContext, first.observations[0].acceptedObserverContext);
  assert.deepEqual(result.observationView.currentReadOnlyObserver.verifier, o3.verifier);
  assert.notDeepEqual(result.observations[0].acceptedObserverContext.verifier, o3.verifier);
  assert.equal(result.observationView.freshObservation, null);
  assert.equal(result.completion.fresh, false);
});

test('failed refresh keeps old accepted pair with older accepted revision and unavailable state', async () => {
  const f = await fixture(), submitted = await f.start(); f.configure({ version: '2' });
  const first = await f.call('observe', f.body(submitted));
  f.state.mutate = observed => ({ ...observed, originalTransactionHash: h('c') });
  await assert.rejects(f.call('observe', f.body(first)), /TASK_OBSERVATION_UNAVAILABLE/);
  const result = await f.status(), entry = result.observations[0];
  assert.equal(entry.available, false);
  assert.deepEqual(entry.observation, first.observations[0].observation);
  assert.deepEqual(entry.acceptedObserverContext, first.observations[0].acceptedObserverContext);
  assert.ok(BigInt(entry.acceptedObserverContext.acceptedObservationRevision) < BigInt(entry.observationRevision));
  assert.equal(result.completion.fresh, false);
  assert.equal(result.observationView.freshObservation, null);
});

test('tampered accepted observation digest is refused on durable read', async () => {
  const f = await fixture(), submitted = await f.start(); f.configure({ version: '2' });
  await f.call('observe', f.body(submitted)); const op = await f.store.read(f.key);
  await f.store.transaction(op.grantKey, grant => ({ ...grant, observations: grant.observations.map(entry => ({
    ...entry, acceptedObserverContext: { ...entry.acceptedObserverContext, fullObservationDigest: h('f') },
  })) }));
  await assert.rejects(f.status(), /TASK_OBSERVER_CONTEXT_REFUSED/);
  assert.equal(f.state.sends, 1);
});

test('legacy cross-verifier row is retained privately but not projected as accepted', async () => {
  const f = await fixture(), submitted = await f.start(); f.configure({ version: '2' });
  const first = await f.call('observe', f.body(submitted)), op = await f.store.read(f.key);
  const raw = first.observations[0].observation;
  await f.store.transaction(op.grantKey, grant => ({ ...grant, observations: [{
    operationId: f.child.child.operationId, observation: raw, available: true,
  }] }));
  const result = await f.status(), entry = result.observations[0];
  assert.equal(entry.provenance, 'unverified');
  assert.equal(entry.available, false); assert.equal(entry.observation, null);
  assert.equal(entry.acceptedObserverContext, null);
  assert.deepEqual((await f.store.read(op.grantKey)).observations[0].observation, raw);
});

test('legacy original-verifier row stays cached without fabricated accepted context', async () => {
  const f = await fixture(), submitted = await f.start();
  const first = await f.call('observe', f.body(submitted)), op = await f.store.read(f.key);
  await f.store.transaction(op.grantKey, grant => ({ ...grant, observations: [{
    operationId: f.child.child.operationId, observation: first.observation, available: true,
  }] }));
  f.configure({ version: '3' });
  const result = await f.status(), entry = result.observations[0];
  assert.equal(entry.provenance, 'legacy-approved-cache');
  assert.deepEqual(entry.observation, first.observation);
  assert.equal(entry.acceptedObserverContext, null);
  assert.equal(entry.observationRevision, '0');
  assert.equal(result.completion.fresh, false);
});

