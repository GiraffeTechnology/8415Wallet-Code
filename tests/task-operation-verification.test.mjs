import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../server/crypto.mjs';
import { taskVerificationPolicyKey } from '../server/task-verification-state.mjs';
import { taskOperationVerificationBinding, consumeTaskOperationVerification,
  assertTaskOperationVerificationAttempt } from '../server/task-operation-verification.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';

// Synthetic source fixtures. These records never authorize a real account.
const time = 1_800_000_000_000;
const h = char => '0x' + char.repeat(64);
const scope = { origin: 'https://wallet.example', tenant: 'example', username: 'alice',
  account: '0x' + '1'.repeat(40), chainId: '560048', agentId: 'example:agent' };
function fixture(mode = 'ON') {
  const credential = { revision: 7 };
  const grant = { principal: JSON.stringify(Object.values(scope).slice(0, 5)), reference: 'grant:' + 'A'.repeat(43),
    grantPolicyVersion: '1', task: { digest: h('2'), policy: { origin: scope.origin, tenant: scope.tenant,
      actor: scope.account, chainId: scope.chainId } },
    executor: { digest: h('3'), identity: { agentId: scope.agentId } }, approvalFactor: 'totp' };
  const operation = { schema: '8415-task-operation/1', status: 'reserved', grantKey: 'task-grant:' + '4'.repeat(64),
    child: { digest: h('5'), child: { taskDigest: h('2'), operationId: 'operation-1' } } };
  const nonce = { operationKey: 'task-operation:' + '6'.repeat(64), taskDigest: h('2'), childDigest: h('5'), permanent: false };
  const f = { credential, grant, operation, nonce };
  if (mode !== null) save(f, mode, '1');
  return f;
}
function save(f, mode, revision, selectedScope = scope) {
  const changes = f.credential.taskVerificationPolicies?.[taskVerificationPolicyKey(selectedScope)]?.changes ?? [];
  f.credential.taskVerificationPolicies = { ...f.credential.taskVerificationPolicies, [taskVerificationPolicyKey(selectedScope)]: {
    schema: '8415-task-human-verification/2', scope: selectedScope, mode, revision, enforcedFromRevision: '1',
    changes: [...changes, { revision, previousRevision: changes.at(-1)?.revision ?? '0', mode,
      changeId: 'B'.repeat(43), changeDigest: 'a'.repeat(64), scopeDigest: digest(JSON.stringify(selectedScope)),
      credentialRevision: 7, verifiedFactors: ['password', 'verified-email'], changedAt: time - 1000 }] } };
}
function approve(f) {
  f.operation.humanVerification = { schema: '8415-task-operation-human-verification/1', purpose: 'execute-exact-child',
    state: 'ready', binding: taskOperationVerificationBinding(f.credential, f.grant, f.operation, f.nonce),
    challengeId: 'operation-challenge:' + 'C'.repeat(43), issuedAt: time - 1000, expiresAt: time + 1000, verifiedAt: time - 500 };
  return f;
}
const consume = (f, now = time, exemption = false) => consumeTaskOperationVerification(f.credential, f.grant, f.operation, f.nonce, now, exemption);
function attempted(f, exemption = false) {
  f.operation = { ...consume(f, time, exemption), status: 'outcome-unknown',
    attemptGrantPolicyVersion: f.grant.grantPolicyVersion, attemptExecutor: f.grant.executor };
  f.nonce.permanent = true; return f;
}
const checkAttempt = (f, now = time, exemption = false) => assertTaskOperationVerificationAttempt(f.credential, f.grant, f.operation, f.nonce, now, exemption);

test('ON absent proof refuses without mutating the reservation or nonce', () => {
  const f = fixture(), before = JSON.stringify(f);
  assert.throws(() => consume(f), /VERIFICATION_REQUIRED/); assert.equal(JSON.stringify(f), before);
});
test('display binding is frozen data, not a human approval', () => {
  const f = fixture(), binding = taskOperationVerificationBinding(f.credential, f.grant, f.operation, f.nonce);
  assert.ok(Object.isFrozen(binding)); assert.equal(binding.policyRevision, '1');
  assert.equal(binding.credentialRevision, '7'); assert.equal(binding.childDigest, h('5'));
  assert.equal(Object.hasOwn(binding, 'approved'), false);
  assert.throws(() => consume(f), /VERIFICATION_REQUIRED/);
});
test('one ready proof becomes the same consumed attempt at multiple actual fences', () => {
  const f = approve(fixture()), original = JSON.stringify(f); const consumed = consume(f);
  assert.equal(JSON.stringify(f), original); assert.equal(consumed.humanVerification.state, 'consumed');
  attempted(f); checkAttempt(f); checkAttempt(f, time + 500);
  assert.throws(() => consume(f), /ALREADY_ATTEMPTED/);
});
test('consumed proof cannot be transplanted into a fresh reserved operation', () => {
  const f = attempted(approve(fixture())); f.operation.status = 'reserved'; f.nonce.permanent = false;
  assert.throws(() => consume(f), /STATE_REFUSED/);
});
test('OFF executes with no proof and no mutation of policy or grant', () => {
  const f = fixture('OFF'), before = JSON.stringify([f.credential, f.grant]);
  attempted(f); checkAttempt(f); assert.equal(f.operation.humanVerification, undefined);
  assert.equal(JSON.stringify([f.credential, f.grant]), before);
});
test('ON revision change invalidates a ready proof even when the final mode is ON', () => {
  const f = approve(fixture()); save(f, 'OFF', '2'); save(f, 'ON', '3');
  assert.throws(() => consume(f), /BINDING_CHANGED/);
});
test('OFF to ON between reserve and send requires a new exact proof', () => {
  const f = fixture('OFF'); save(f, 'ON', '2'); assert.throws(() => consume(f), /VERIFICATION_REQUIRED/);
});
test('OFF to ON after attempt but before signing cannot use cached OFF', () => {
  const f = attempted(fixture('OFF')); save(f, 'ON', '2');
  assert.throws(() => checkAttempt(f), /VERIFICATION_REQUIRED/);
});
test('post-consumption revision change invalidates the real signing fence', () => {
  const f = attempted(approve(fixture())); save(f, 'ON', '2');
  assert.throws(() => checkAttempt(f), /BINDING_CHANGED/);
});
for (const [name, change] of [
  ['child', f => { f.operation.child.digest = h('7'); f.nonce.childDigest = h('7'); }],
  ['operation', f => { f.operation.child.child.operationId = 'operation-2'; }],
  ['global nonce reservation', f => { f.nonce.operationKey = 'task-operation:' + '7'.repeat(64); }],
  ['grant reference', f => { f.grant.reference = 'grant:' + 'D'.repeat(43); }],
  ['grant version', f => { f.grant.grantPolicyVersion = '2'; }],
  ['credential revision', f => { f.credential.revision = 8; }],
  ['executor', f => { f.grant.executor.digest = h('8'); }],
  ['Agent', f => { f.grant.executor.identity.agentId = 'other:agent';
    save(f, 'ON', '1', { ...scope, agentId: 'other:agent' }); }],
]) test(`proof cannot authorize a different ${name}`, () => {
  const f = approve(fixture()); change(f); assert.throws(() => consume(f), /BINDING_CHANGED/);
});
test('nonce from another child or task cannot be bound even without proof under OFF', () => {
  for (const field of ['taskDigest', 'childDigest']) { const f = fixture('OFF'); f.nonce[field] = h('9');
    assert.throws(() => consume(f), /BINDING_REFUSED/); }
});
test('login/settings proof purpose and self-declared approval cannot substitute', () => {
  for (const purpose of ['login', 'policy-change', 'authorize-task']) { const f = approve(fixture());
    f.operation.humanVerification.purpose = purpose; assert.throws(() => consume(f), /STATE_REFUSED/); }
  const f = approve(fixture()); f.operation.humanVerification.approved = true;
  assert.throws(() => consume(f), /STATE_REFUSED/);
});
test('clock rollback, expired/future proof, overlong life and unsafe time fail closed', () => {
  for (const now of [time - 501, time + 1000, -1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const f = approve(fixture()); assert.throws(() => consume(f, now)); }
  const f = approve(fixture()); f.operation.humanVerification.expiresAt = time + 120000;
  assert.throws(() => consume(f), /EXPIRED/);
});
test('fresh trusted test scope exemption needs a genuine test-approved grant', () => {
  const f = fixture(); assert.throws(() => consume(f, time, true), /TEST_SCOPE_REFUSED/);
  f.grant.approvalFactor = 'server-test-scope'; attempted(f, true); checkAttempt(f, time, true);
  assert.throws(() => checkAttempt(f, time, false), /TEST_SCOPE_REFUSED/);
  assert.throws(() => checkAttempt(f, time, 'true'), /CONFIG_REFUSED/);
});
test('submitted and UNKNOWN reconciliation never invokes this execution-only fence', () => {
  const f = attempted(approve(fixture())); f.operation.status = 'submitted';
  assert.throws(() => checkAttempt(f), /ATTEMPT_REFUSED/);
  // Reconciliation callers deliberately do not call the gate, consume or send.
  assert.equal(f.nonce.permanent, true); assert.equal(f.operation.humanVerification.state, 'consumed');
});
test('two concurrent consumers serialize proof, budget attempt and nonce atomically', async () => {
  const f = approve(fixture()), store = new MemoryCredentialStore({ credential: f.credential, grant: f.grant, operation: f.operation, nonce: f.nonce });
  const run = () => store.transactionMany(['credential', 'grant', 'operation', 'nonce'], values => {
    const op = consumeTaskOperationVerification(values.credential, values.grant, values.operation, values.nonce, time);
    return { ...values, operation: { ...op, status: 'outcome-unknown', attemptGrantPolicyVersion: values.grant.grantPolicyVersion,
      attemptExecutor: values.grant.executor }, nonce: { ...values.nonce, permanent: true } };
  });
  const results = await Promise.allSettled([run(), run()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const persisted = await store.readMany(['credential', 'grant', 'operation', 'nonce']);
  assertTaskOperationVerificationAttempt(persisted.credential, persisted.grant, persisted.operation, persisted.nonce, time);
});
