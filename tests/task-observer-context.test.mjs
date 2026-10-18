import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTaskObserverContextCodec } from '../web/task-observer-context.mjs';

// Codec-only synthetic fixtures. These do not stand in for the real observation
// normalizer, service CAS, browser integration, RPC proof or chain acceptance.
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => `0x${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const h = digit => `0x${digit.repeat(64)}`;
const verifier = version => ({ verifierId: 'fixture-observer', verifierVersion: version,
  verifierImplementationDigest: h(version) });
const policy = minimum => {
  const p = { minimumConfirmations: minimum };
  return { policy: p, digest: hash(p) };
};
const codec = createTaskObserverContextCodec({
  normalizeTaskObservation: clone,
  normalizeObservationVerifier: clone,
  freezeTaskObservationPolicy: p => policy(p.minimumConfirmations),
  hashCanonical: hash,
  fail: code => { throw new Error(code); },
});
function fixture() {
  const originalAttempt = { taskDigest: h('a'), operationId: 'operation-1', childDigest: h('b'),
    chainId: '560048', actor: `0x${'c'.repeat(40)}`, nonce: '7', transactionHash: h('d'),
    executorDigest: h('e'), grantPolicyVersion: '2', observationPolicy: policy('2'),
    receiptVerifier: verifier('1') };
  const observation = { taskDigest: originalAttempt.taskDigest, childDigest: originalAttempt.childDigest,
    chainId: originalAttempt.chainId, actor: originalAttempt.actor, nonce: originalAttempt.nonce,
    originalTransactionHash: originalAttempt.transactionHash,
    attemptExecutorDigest: originalAttempt.executorDigest, attemptGrantPolicyVersion: originalAttempt.grantPolicyVersion,
    observationPolicy: originalAttempt.observationPolicy.policy,
    observationPolicyDigest: originalAttempt.observationPolicy.digest,
    ...verifier('2'), state: 'confirmed-at-depth', confirmations: '4' };
  return { observation, originalAttempt, acceptedObservationRevision: '3',
    capturedVerifier: verifier('2'), capturedVerificationPolicy: policy('3') };
}
const expected = (f, revision = '3') => ({ observation: f.observation, attempt: f.originalAttempt,
  currentObservationRevision: revision });
const refused = action => assert.throws(action, /TASK_OBSERVER_CONTEXT_REFUSED/);

test('accepted observer differs from immutable original approval without rewriting either', () => {
  const f = fixture(), before = clone(f), context = codec.capture(f);
  assert.deepEqual(f, before);
  assert.deepEqual(context.attempt.receiptVerifier, verifier('1'));
  assert.deepEqual(context.verifier, verifier('2'));
  assert.equal(context.canExecute, false);
  assert.ok(Object.isFrozen(context.attempt.observationPolicy.policy));
});
test('persisted O2 context remains O2 after O3 restart or later failed-refresh revision', () => {
  const f = fixture(), accepted = codec.capture(f);
  const cached = codec.normalize(accepted, expected(f, '4'));
  assert.deepEqual(cached.verifier, verifier('2'));
  assert.equal(cached.acceptedObservationRevision, '3');
  // Current O3 is separate service metadata, never an argument that rewrites O2.
  assert.notDeepEqual(cached.verifier, verifier('3'));
});
test('accepted revision cannot be zero or exceed the operation revision', () => {
  const f = fixture(), context = codec.capture(f);
  refused(() => codec.normalize({ ...context, acceptedObservationRevision: '0' }, expected(f)));
  refused(() => codec.normalize(context, expected(f, '2')));
});
test('noncanonical and uint256-overflow revisions are refused', () => {
  const f = fixture(), context = codec.capture(f);
  for (const value of ['03', '-1', 3, (1n << 256n).toString()])
    refused(() => codec.normalize({ ...context, acceptedObservationRevision: value }, expected(f)));
});
test('full normalized observation digest rejects payload tampering', () => {
  const f = fixture(), context = codec.capture(f);
  refused(() => codec.normalize(context, { ...expected(f), observation: { ...f.observation, confirmations: '5' } }));
  refused(() => codec.normalize({ ...context, fullObservationDigest: h('f') }, expected(f)));
});
test('actual observer must match explicitly captured server verifier', () => {
  const f = fixture();
  refused(() => codec.capture({ ...f, capturedVerifier: verifier('3') }));
  const context = codec.capture(f);
  refused(() => codec.normalize({ ...context, verifier: verifier('3') }, expected(f)));
});
test('terminal observation meets original and captured verification depth floors', () => {
  const f = fixture();
  refused(() => codec.capture({ ...f, capturedVerificationPolicy: policy('5') }));
  const originalAttempt = { ...f.originalAttempt, observationPolicy: policy('5') };
  refused(() => codec.capture({ ...f, originalAttempt, observation: { ...f.observation,
    observationPolicy: originalAttempt.observationPolicy.policy,
    observationPolicyDigest: originalAttempt.observationPolicy.digest } }));
});
test('every terminal state enforces both depth floors', () => {
  const f = fixture();
  for (const state of ['confirmed-at-depth', 'reverted-at-depth', 'superseded-at-depth'])
    refused(() => codec.capture({ ...f, observation: { ...f.observation, state, confirmations: '2' } }));
});
test('original exact attempt tuple cannot be replaced by a new approval', () => {
  const f = fixture(), context = codec.capture(f);
  for (const [key, value] of Object.entries({ operationId: 'operation-2', nonce: '8',
    transactionHash: h('f'), executorDigest: h('f'), grantPolicyVersion: '3' }))
    refused(() => codec.normalize(context, { ...expected(f), attempt: { ...f.originalAttempt, [key]: value } }));
});
test('policy body and digest are bound independently for original and accepted policy', () => {
  const f = fixture(), context = codec.capture(f);
  const changed = clone(context); changed.verificationPolicy.policy.minimumConfirmations = '1';
  refused(() => codec.normalize(changed, expected(f)));
  const changedOriginal = clone(context); changedOriginal.attempt.observationPolicy.digest = h('f');
  refused(() => codec.normalize(changedOriginal, expected(f)));
});
test('unknown keys and accessor context fields are refused before getter execution', () => {
  const f = fixture(), context = codec.capture(f);
  refused(() => codec.normalize({ ...context, bypass: true }, expected(f)));
  const accessor = { ...context }; let calls = 0;
  Object.defineProperty(accessor, 'verifier', { enumerable: true, get() { calls++; return verifier('2'); } });
  refused(() => codec.normalize(accessor, expected(f)));
  assert.equal(calls, 0);
});
test('unsupported schema and executable flag never confer acceptance', () => {
  const f = fixture(), context = codec.capture(f);
  refused(() => codec.normalize({ ...context, schema: '8415-accepted-observer-context/2' }, expected(f)));
  refused(() => codec.normalize({ ...context, canExecute: true }, expected(f)));
});
test('nested verifier accessor is rejected without executing it', () => {
  const f = fixture(), context = clone(codec.capture(f)); let calls = 0;
  Object.defineProperty(context.verifier, 'verifierVersion', {
    enumerable: true, get() { calls++; return '2'; },
  });
  refused(() => codec.normalize(context, expected(f)));
  assert.equal(calls, 0);
});
