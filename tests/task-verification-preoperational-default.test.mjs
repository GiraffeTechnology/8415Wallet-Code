import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../server/crypto.mjs';
import { readCredentialTaskVerificationPolicy, taskVerificationPolicyKey } from '../server/task-verification-state.mjs';
import { taskOperationVerificationRequirement, consumeTaskOperationVerification,
  assertTaskOperationVerificationAttempt } from '../server/task-operation-verification.mjs';
import { createTaskAuthorizationService } from '../server/task-authorization.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { freezeChildOperation } from '../src/agent/taskContract.ts';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';

// Source-only synthetic fixtures. No network, real wallet, credentials or funds.
const time = 1_800_000_000_000, hash = c => '0x' + c.repeat(64);
const scope = { origin: 'https://wallet.example.invalid', tenant: 'example', username: 'alice',
  account: '0x' + '1'.repeat(40), chainId: '11155111', agentId: 'example:agent' };
const recipient = '0x' + '2'.repeat(40), txHash = hash('a');
const executor = { schema: '8415-task-executor/1', agentId: scope.agentId, agentVersion: '1',
  adapterId: 'synthetic:adapter', adapterVersion: '1', implementationDigest: hash('9') };
function saved(mode, selected = scope) {
  return { schema: '8415-task-human-verification/2', scope: selected, mode, revision: '1', enforcedFromRevision: '1',
    changes: [{ revision: '1', previousRevision: '0', mode, changeId: 'A'.repeat(43), changeDigest: 'a'.repeat(64),
      scopeDigest: digest(JSON.stringify(selected)), credentialRevision: 7,
      verifiedFactors: ['password', 'verified-email'], changedAt: time - 1000 }] };
}
function fixture(mode = null) {
  const credential = { revision: 7 };
  if (mode !== null) credential.taskVerificationPolicies = { [taskVerificationPolicyKey(scope)]: saved(mode) };
  const grant = { principal: JSON.stringify(Object.values(scope).slice(0, 5)), reference: 'grant:' + 'A'.repeat(43),
    grantPolicyVersion: '1', status: 'authorized', approvalFactor: 'totp',
    task: { digest: hash('2'), policy: { origin: scope.origin, tenant: scope.tenant, actor: scope.account, chainId: scope.chainId } },
    executor: { digest: hash('3'), identity: { agentId: scope.agentId } } };
  const operation = { schema: '8415-task-operation/1', status: 'reserved', grantKey: 'task-grant:' + '4'.repeat(64),
    child: { digest: hash('5'), child: { taskDigest: hash('2'), operationId: 'operation-1' } } };
  const nonce = { operationKey: 'task-operation:' + '6'.repeat(64), taskDigest: hash('2'), childDigest: hash('5'), permanent: false };
  return { credential, grant, operation, nonce };
}
const consume = f => consumeTaskOperationVerification(f.credential, f.grant, f.operation, f.nonce, time);
function attempted(f) {
  f.operation = { ...consume(f), status: 'outcome-unknown', attemptGrantPolicyVersion: f.grant.grantPolicyVersion,
    attemptExecutor: f.grant.executor }; f.nonce.permanent = true; return f;
}
const assertAttempt = f => assertTaskOperationVerificationAttempt(f.credential, f.grant, f.operation, f.nonce, time);

test('absent owner policy remains ON and records approval verification as not evaluated', () => {
  const f = fixture(), before = JSON.stringify(f);
  const policy = readCredentialTaskVerificationPolicy(f.credential, scope);
  assert.equal(policy.mode, 'ON'); assert.equal(policy.revision, '0'); assert.deepEqual(policy.changes, []);
  assert.deepEqual(readCredentialTaskVerificationPolicy(null, scope), policy);
  assert.deepEqual(taskOperationVerificationRequirement(f.credential, f.grant),
    { required: false, policyRevision: '0', reason: 'pre-operational-default-on' });
  const operation = consume(f);
  assert.equal(JSON.stringify(f), before); assert.equal(operation.humanVerification, undefined);
  assert.deepEqual(operation.humanVerificationEvaluation,
    { state: 'NOT_EVALUATED', reason: 'pre-operational-default-on', policyRevision: '0' });
  assertAttempt(attempted(f));
});
test('saved ON and OFF retain their distinct behavior without modifying owner records', () => {
  for (const mode of ['ON', 'OFF']) {
    const f = fixture(mode), before = JSON.stringify([f.credential, f.grant]);
    if (mode === 'ON') assert.throws(() => consume(f), /VERIFICATION_REQUIRED/);
    else { assertAttempt(attempted(f)); assert.equal(f.operation.humanVerification, undefined);
      assert.equal(f.operation.humanVerificationEvaluation.reason, 'policy-off'); }
    assert.equal(JSON.stringify([f.credential, f.grant]), before);
  }
});
test('explicit malformed state is never treated as missing policy', () => {
  const key = taskVerificationPolicyKey(scope);
  for (const credential of [undefined, [], { taskVerificationPolicies: null },
    { taskVerificationPolicies: undefined }, { taskVerificationPolicies: [] },
    { taskVerificationPolicies: { unknown: true } }, { taskVerificationPolicies: { [key]: null } },
    { taskVerificationPolicies: { [key]: undefined } },
    { taskVerificationPolicies: { [key]: { ...saved('ON'), revision: '0', changes: [] } } },
    { taskVerificationPolicies: { [key]: { ...saved('ON'), unknown: true } } }]) {
    assert.throws(() => readCredentialTaskVerificationPolicy(credential, scope));
  }
  let read = false;
  const accessor = Object.defineProperty({}, key, { enumerable: true, get() { read = true; return null; } });
  assert.throws(() => readCredentialTaskVerificationPolicy({ taskVerificationPolicies: accessor }, scope));
  assert.equal(read, false);
  assert.throws(() => readCredentialTaskVerificationPolicy({ taskVerificationPolicies: { [Symbol('hidden')]: saved('ON') } }, scope));
});
test('a saved ON revision arriving before signing replaces the initial unlocked default', () => {
  const f = attempted(fixture());
  f.credential.taskVerificationPolicies = { [taskVerificationPolicyKey(scope)]: saved('ON') };
  assert.throws(() => assertAttempt(f), /VERIFICATION_REQUIRED/);
  assert.equal(f.nonce.permanent, true); assert.equal(f.operation.status, 'outcome-unknown');
});
test('test-scope exemption stays separate and requires its current trusted scope', () => {
  const f = fixture('ON'); f.grant.approvalFactor = 'server-test-scope';
  assert.deepEqual(taskOperationVerificationRequirement(f.credential, f.grant, true),
    { required: false, policyRevision: '1', reason: 'server-test-scope' });
  assert.throws(() => taskOperationVerificationRequirement(f.credential, f.grant, false), /TEST_SCOPE_REFUSED/);
  f.grant.approvalFactor = 'totp';
  assert.throws(() => taskOperationVerificationRequirement(f.credential, f.grant, true), /TEST_SCOPE_REFUSED/);
});
test('unlocked approval gate does not relax child, nonce or durable attempt bindings', () => {
  for (const field of ['taskDigest', 'childDigest']) {
    const f = fixture(); f.nonce[field] = hash('8'); assert.throws(() => consume(f), /BINDING_REFUSED/);
  }
  const f = attempted(fixture()); f.grant.grantPolicyVersion = '2';
  assert.throws(() => assertAttempt(f), /ATTEMPT_REFUSED/);
  assert.throws(() => consume(f), /ALREADY_ATTEMPTED/);
});

function serviceFixture({ connected = true, store = new MemoryCredentialStore({ 'example:alice': { revision: 7 } }),
  onVerify = async () => {}, failSend = false } = {}) {
  const state = { now: time, factors: 0, sends: 0, recoveries: 0 };
  const session = { id: 'synthetic:session', username: scope.username, account: scope.account,
    chainId: scope.chainId, revision: 7, issuedAt: time, expiresAt: time + 10_000_000 };
  const assertSession = (s, c) => { assert.equal(s, session); if (c !== undefined) assert.equal(c?.revision, 7); };
  const binding = input => ({ taskDigest: input.task.digest, childDigest: input.child.digest,
    chainId: scope.chainId, actor: scope.account, nonce: input.child.child.nonce,
    executorDigest: input.executor.digest, grantPolicyVersion: input.grantPolicyVersion });
  const observationPolicy = freezeTaskObservationPolicy({ minimumConfirmations: '2' });
  const identity = { verifierId: 'synthetic:receipt', verifierVersion: '1', verifierImplementationDigest: hash('7') };
  const receipt = { identity, observationPolicy,
    async assessChild(input) { return { ...identity, taskDigest: input.task.digest, childDigest: input.child.digest,
      executorDigest: input.executor.digest, observationPolicyDigest: observationPolicy.digest, capability: 'exact-operation-observable' }; },
    async observe() { throw Error('Synthetic fixture has no observation evidence'); } };
  const service = createTaskAuthorizationService({ origin: scope.origin, tenant: scope.tenant, store,
    now: () => state.now, operationVerificationEnabled: connected, assertSession, executorIdentity: executor,
    observationPolicy: observationPolicy.policy, receipt,
    async credentialFor(s) { const c = await store.read('example:alice'); assertSession(s, c); return c; },
    consumeTotp(s, c, code) { assertSession(s, c); assert.equal(code, 'synthetic-owner-task-approval');
      state.factors++; return { ...c }; },
    execution: {
      async verify(input) { await onVerify(); return binding(input); },
      async send(input) { state.sends++; if (failSend) throw Error('Synthetic connection loss');
        return { ...binding(input), transactionHash: txHash }; },
      async recover(input) { state.recoveries++; return { ...binding(input), state: 'submitted', transactionHash: txHash }; },
    } });
  const policy = { schema: '8415-agent-task/1', taskId: 'synthetic:default-on', tenant: scope.tenant,
    origin: scope.origin, chainId: scope.chainId, actor: scope.account, expiresAt: String(time / 1000 + 7200),
    fees: { perOperationWei: '100000', totalWei: '200000' }, intent: { kind: 'exact-operation',
      operation: { kind: 'native-transfer', chainId: scope.chainId, actor: scope.account, recipient, valueWei: '10' } } };
  const call = (path, body) => service.handler(`tasks/${path}`, body, session);
  const child = task => ({ schema: '8415-agent-child/1', operationId: 'synthetic:operation', taskDigest: task.digest,
    operation: task.policy.intent.operation, nonce: '7', expiresAt: String(time / 1000 + 600),
    wire: { to: recipient, calldataHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', valueWei: '10' },
    fees: { gasLimit: '21000', maxFeePerGasWei: '2' }, market: null });
  async function authorize() {
    const p = await call('prepare', { policy });
    return call('authorize', { challengeId: p.challengeId, taskDigest: p.task.digest, executorDigest: p.executor.digest,
      observationPolicyDigest: p.observationPolicy.digest, code: 'synthetic-owner-task-approval' });
  }
  const reserve = g => call('reserve', { taskDigest: g.task.digest, child: child(g.task), expectedBudgetRevision: g.budget.revision });
  const body = g => ({ taskDigest: g.task.digest, operationId: child(g.task).operationId,
    childDigest: freezeChildOperation(child(g.task)).digest, expectedBudgetRevision: g.budget.revision });
  return { state, store, service, call, policy, child, authorize, reserve, body };
}
for (const connected of [false, true]) test(`initial ON is prompt-free for a valid non-test grant with management connected=${connected}`, async () => {
  const f = serviceFixture({ connected }), reserved = await f.reserve(await f.authorize());
  assert.equal(reserved.humanVerification.mode, 'ON'); assert.equal(reserved.humanVerification.revision, '0');
  const result = await f.call('execute', f.body(reserved));
  assert.equal(result.budget.reservations[0].status, 'submitted'); assert.equal(f.state.sends, 1);
  assert.equal(f.state.factors, 1, 'only the original task approval consumes a human factor');
  assert.equal((await f.store.read('example:alice')).taskVerificationPolicies, undefined);
});
test('missing policy does not authorize a pending task or an out-of-scope child', async () => {
  const f = serviceFixture(), pending = await f.call('prepare', { policy: f.policy });
  await assert.rejects(f.call('reserve', { taskDigest: pending.task.digest, child: f.child(pending.task), expectedBudgetRevision: '0' }));
  const g = await f.authorize(), changed = f.child(g.task);
  changed.operation = { ...changed.operation, recipient: '0x' + '3'.repeat(40) };
  await assert.rejects(f.call('reserve', { taskDigest: g.task.digest, child: changed, expectedBudgetRevision: g.budget.revision }));
  assert.equal(f.state.sends, 0);
});
test('revoked or expired authority cannot use the unlocked default', async () => {
  for (const change of ['revoke', 'expire']) {
    const f = serviceFixture(), reserved = await f.reserve(await f.authorize());
    if (change === 'revoke') await f.call('revoke', { taskDigest: reserved.task.digest, expectedGrantPolicyVersion: '1' });
    else f.state.now += 7_200_000;
    await assert.rejects(f.call('execute', f.body(reserved)));
    assert.equal(f.state.sends, 0); assert.equal(f.state.factors, 1);
  }
});
test('an authoritative read failure propagates instead of selecting the default', async () => {
  // operationContext/credentialFor use read(), not readMany(). Fail that actual
  // authoritative path; replacing an unused method cannot model a store fault.
  class FaultingStore extends MemoryCredentialStore {
    failRead=false;
    async read(key) { if(this.failRead)throw Error('SYNTHETIC_AUTHORITATIVE_READ_FAILURE'); return super.read(key); }
    async readMany(keys) { if(this.failRead)throw Error('SYNTHETIC_AUTHORITATIVE_READ_FAILURE'); return super.readMany(keys); }
  }
  const store=new FaultingStore({'example:alice':{revision:7}});
  const f = serviceFixture({store}), reserved = await f.reserve(await f.authorize());
  store.failRead=true;
  await assert.rejects(f.call('execute', f.body(reserved)), /SYNTHETIC_AUTHORITATIVE_READ_FAILURE/);
  assert.equal(f.state.sends, 0);
});
test('concurrent default-ON execution retains one nonce attempt and one send', async () => {
  const f = serviceFixture(), reserved = await f.reserve(await f.authorize());
  const results = await Promise.allSettled([f.call('execute', f.body(reserved)), f.call('execute', f.body(reserved))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.state.sends, 1); assert.equal(f.state.factors, 1);
});
test('UNKNOWN default-ON attempt reconciles without approval, duplicate send or released reservation', async () => {
  const f = serviceFixture({ failSend: true }), reserved = await f.reserve(await f.authorize());
  const unknown = await f.call('execute', f.body(reserved));
  assert.equal(unknown.outcome, 'outcome-unknown');
  assert.equal(unknown.budget.reservations[0].status, 'outcome-unknown');
  await assert.rejects(f.call('cancel-reservation', f.body(unknown)), /UNCERTAIN_RESERVATION/);
  await assert.rejects(f.call('execute', f.body(unknown)));
  const resumed = await f.call('resume', { taskDigest: reserved.task.digest });
  assert.equal(resumed.budget.reservations[0].status, 'submitted');
  assert.equal(f.state.sends, 1); assert.equal(f.state.recoveries, 1); assert.equal(f.state.factors, 1);
});
