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
    const verifier = { verifierId, verifierVersion: '1', verifierImplementationDigest: version === '1' ? h('6') : h('7') };
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
    status: () => call('status', { taskDigest: task.digest }) };
}
test('upgraded observer records fresh provenance without mutating the original attempt or budget', async () => {
  const f = await fixture(), submitted = await f.start(), before = await f.store.read(f.key);
  const grantBefore = await f.store.read(before.grantKey), nonceBefore = await f.store.read(before.nonceKey);
  const current = f.configure({ version: '2' });
  const result = await f.call('observe', f.body(submitted)), after = await f.store.read(f.key);
  assert.equal(result.observation.verifierImplementationDigest, current.verifier.verifierImplementationDigest);
  assert.equal(result.observation.attemptExecutorDigest, before.attemptExecutor.digest);
  assert.deepEqual(after.attemptExecutor, before.attemptExecutor);
  assert.deepEqual(after.attemptReceiptVerifier, before.attemptReceiptVerifier);
  assert.deepEqual(after.attemptObservationPolicy, before.attemptObservationPolicy);
  assert.equal(after.attemptGrantPolicyVersion, before.attemptGrantPolicyVersion);
  assert.deepEqual(result.budget, grantBefore.budget);
  assert.deepEqual(await f.store.read(before.nonceKey), nonceBefore);
  assert.equal(result.effectiveStatus, 'suspended');
  assert.equal(f.state.currentReads, 0); assert.equal(f.state.historicalReads, 1);
  assert.equal(f.state.sends, 1); assert.equal(f.state.approvals, 0);
  await assert.rejects(f.call('execute', f.body(result)));
});
test('historical UNKNOWN recovery can continue to observation without resigning or releasing quota', async () => {
  const f = await fixture({ lostResponse: true }), unknown = await f.start();
  assert.equal(unknown.outcome, 'outcome-unknown');
  f.configure({ version: '2' });
  const recovered = await f.call('recover', f.body(unknown));
  assert.equal(recovered.outcome, 'submitted');
  const observed = await f.call('observe', f.body(recovered));
  assert.equal(observed.observation.state, 'confirmed-at-depth');
  assert.deepEqual(observed.budget, recovered.budget);
  assert.equal(f.state.sends, 1); assert.equal(f.state.approvals, 0);
});
test('same logical agent without explicit historical verifier capability is insufficient', async () => {
  const f = await fixture(), submitted = await f.start();
  f.configure({ version: '2', historical: false });
  await assert.rejects(f.call('observe', f.body(submitted)), /HISTORICAL_CAPABILITY_REQUIRED/);
  assert.equal(f.state.currentReads + f.state.historicalReads, 0);
});
test('unrelated agent, adapter or verifier channel cannot borrow an old submitted attempt', async () => {
  for (const change of [{ agentId: 'other:agent' }, { adapterId: 'other:adapter' }, { verifierId: 'other:receipt' }]) {
    const f = await fixture(), submitted = await f.start();
    f.configure({ version: '2', ...change });
    await assert.rejects(f.call('observe', f.body(submitted)), /HISTORICAL_CAPABILITY_REQUIRED/);
    assert.equal(f.state.currentReads + f.state.historicalReads, 0);
  }
});
test('historical service enforces stronger current depth and leaves the original policy unchanged', async () => {
  const f = await fixture(), submitted = await f.start(), before = await f.store.read(f.key);
  f.configure({ version: '2', minimum: '3' }); f.state.confirmations = '2';
  await assert.rejects(f.call('observe', f.body(submitted)), /TASK_OBSERVATION_UNAVAILABLE/);
  assert.deepEqual((await f.store.read(f.key)).attemptObservationPolicy, before.attemptObservationPolicy);
  f.state.confirmations = '3';
  const observed = await f.call('observe', f.body(submitted));
  assert.equal(observed.observation.observationPolicy.minimumConfirmations, '2');
  assert.equal(observed.observation.confirmations, '3');
});
test('forged observer provenance or attempt identity cannot become available evidence', async () => {
  for (const change of [{ originalTransactionHash: h('c') }, { actor: a('3') }, { chainId: '1' },
    { attemptExecutorDigest: h('c') }, { verifierImplementationDigest: h('c') }]) {
    const f = await fixture(), submitted = await f.start(); f.configure({ version: '2' });
    f.state.mutate = observed => ({ ...observed, ...change });
    await assert.rejects(f.call('observe', f.body(submitted)), /TASK_OBSERVATION_UNAVAILABLE/);
    const status = await f.status();
    assert.equal(status.observations[0].available, false);
    assert.equal(f.state.sends, 1);
  }
});
test('revocation and expiry preserve read-only evidence without reviving authority', async () => {
  for (const revoke of [false, true]) {
    const f = await fixture(), submitted = await f.start();
    if (revoke) await f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
    else f.state.now += 4000000;
    f.configure({ version: '2' });
    const result = await f.call('observe', f.body(submitted));
    assert.equal(result.observation.state, 'confirmed-at-depth');
    assert.equal(result.effectiveStatus, revoke ? 'revoked' : 'expired');
    assert.equal(f.state.sends, 1); assert.equal(f.state.approvals, 0);
    await assert.rejects(f.call('execute', f.body(result)));
  }
});
test('historical capability is captured once and cannot be selected through HTTP JSON', async () => {
  const f = await fixture(), submitted = await f.start(), current = f.configure({ version: '2' });
  current.configuredReceipt.observeHistorical = () => assert.fail('replacement capability must not run');
  await assert.rejects(f.call('observe', { ...f.body(submitted), historical: true }));
  assert.equal(f.state.historicalReads, 0);
  assert.equal((await f.call('observe', f.body(submitted))).observation.state, 'confirmed-at-depth');
  assert.equal(f.state.historicalReads, 1);
});
test('concurrent observation revision change prevents stale historical CAS write', async () => {
  const f = await fixture(), submitted = await f.start(); f.configure({ version: '2' });
  f.state.onRead = () => f.store.transaction(f.key, op => ({ ...op, observationRevision: '1' }));
  await assert.rejects(f.call('observe', f.body(submitted)), /OBSERVATION_REVISION_CONFLICT/);
  assert.equal((await f.status()).observations.length, 0);
  assert.equal(f.state.sends, 1);
});

test('failed historical refresh preserves earlier evidence only as unavailable and never releases quota', async () => {
  const f = await fixture(), submitted = await f.start(); f.configure({ version: '2' });
  const first = await f.call('observe', f.body(submitted));
  assert.equal(first.observations[0].available, true);
  assert.equal(first.completion.state, 'completed-at-observation-depth');
  const before = await f.store.read(f.key), nonceBefore = await f.store.read(before.nonceKey);
  f.state.mutate = observed => ({ ...observed, originalTransactionHash: h('c') });
  await assert.rejects(f.call('observe', f.body(first)), /TASK_OBSERVATION_UNAVAILABLE/);
  const after = await f.status();
  assert.equal(after.observations[0].available, false);
  assert.deepEqual(after.observations[0].observation, first.observations[0].observation);
  assert.equal(after.completion.state, 'awaiting-evidence');
  assert.deepEqual(after.budget, first.budget);
  assert.deepEqual(await f.store.read(before.nonceKey), nonceBefore);
  assert.equal(f.state.sends, 1); assert.equal(f.state.approvals, 0);
});
