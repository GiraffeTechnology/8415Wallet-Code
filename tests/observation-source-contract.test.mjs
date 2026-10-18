import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createObservationSourceContract } from '../web/observation-source-contract.mjs';
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


const contract = createObservationSourceContract({ observerContextCodec: codec,
  normalizeObservationVerifier: clone, normalizeTaskObservation: clone,
  fail: code => { throw new Error(code); } });
function sourceFixture() {
  const f = fixture(), c = { tenant: 'fixture', origin: 'https://wallet.example.invalid',
    account: f.originalAttempt.actor, chainId: f.originalAttempt.chainId, taskDigest: f.originalAttempt.taskDigest,
    operationId: f.originalAttempt.operationId, childDigest: f.originalAttempt.childDigest };
  const source = { schema: '8415-observation-source/1', sourceReference: 'fixture-source:O2', sourceRevision: '2',
    principal: { tenant: c.tenant, origin: c.origin, account: c.account, chainId: c.chainId },
    attempt: clone(f.originalAttempt), verifier: clone(f.capturedVerifier), verificationPolicy: clone(f.capturedVerificationPolicy),
    capabilityReference: 'fixture-capability:historical', capabilityRevision: '4', canExecute: false };
  const entry = { schema: '8415-bound-observation-entry/1', operationId: c.operationId,
    sourceReference: source.sourceReference, sourceRevision: source.sourceRevision,
    capabilityReference: source.capabilityReference, capabilityRevision: source.capabilityRevision,
    observationRevision: '3', acceptedObserverContext: codec.capture(f), observation: clone(f.observation), available: true };
  return { f, c, source, entry, expected: { expectedSource: source, context: c, originalAttempt: f.originalAttempt } };
}
test('separate independently supplied source binds actual observer without replacing approval', () => {
  const v = sourceFixture(), result = contract.decodeBoundEntry(v.entry, v.expected);
  assert.equal(result.canExecute, false); assert.equal(result.fresh, false);
  assert.deepEqual(result.approvedVerifier, verifier('1')); assert.deepEqual(result.observedBy, verifier('2'));
  assert.equal(result.savedRevision, '3');
});
test('response cannot supply its own expected source', () => {
  const v = sourceFixture();
  assert.throws(() => contract.decodeBoundEntry({ ...v.entry, expectedSource: v.source }, {
    context: v.c, originalAttempt: v.f.originalAttempt }), /OBSERVATION_BINDING_REFUSED/);
});
test('source and capability references and revisions must match independent descriptor exactly', () => {
  const v = sourceFixture();
  for (const key of ['sourceReference','sourceRevision','capabilityReference','capabilityRevision']) {
    const bad = { ...v.entry, [key]: key.endsWith('Revision') ? '999' : 'other:source' };
    assert.throws(() => contract.decodeBoundEntry(bad, v.expected), /OBSERVATION_BINDING_REFUSED/);
  }
});
test('cross-account and cross-operation source descriptors are refused', () => {
  const v = sourceFixture();
  const bad = clone(v.source); bad.principal.account = `0x${'d'.repeat(40)}`;
  assert.throws(() => contract.decodeBoundEntry(v.entry, { ...v.expected, expectedSource: bad }), /OBSERVATION_BINDING_REFUSED/);
  assert.throws(() => contract.decodeBoundEntry(v.entry, { ...v.expected, context: { ...v.c, operationId: 'other' } }), /OBSERVATION_BINDING_REFUSED/);
});
test('weakened configured depth and a mismatched actual verifier are refused', () => {
  const v = sourceFixture(), bad = clone(v.source); bad.verificationPolicy = policy('1');
  assert.throws(() => contract.decodeBoundEntry(v.entry, { ...v.expected, expectedSource: bad }), /OBSERVATION_BINDING_REFUSED/);
  const wrong = clone(v.source); wrong.verifier = verifier('3');
  assert.throws(() => contract.decodeBoundEntry(v.entry, { ...v.expected, expectedSource: wrong }), /OBSERVATION_BINDING_REFUSED/);
});
test('older saved revision, extra keys and unsupported envelopes fail closed', () => {
  const v = sourceFixture();
  for (const bad of [{ ...v.entry, extra: true }, { ...v.entry, schema: '8415-bound-observation-entry/2' }])
    assert.throws(() => contract.decodeBoundEntry(bad, v.expected), /OBSERVATION_BINDING_REFUSED/);
  assert.throws(() => contract.decodeBoundEntry(v.entry, { ...v.expected, minimumSavedRevision: '4' }), /OBSERVATION_BINDING_REFUSED/);
});
test('source descriptor accessors are rejected before getter execution', () => {
  const v = sourceFixture(); let calls = 0;
  Object.defineProperty(v.source, 'verifier', { enumerable: true, get() { calls++; return verifier('2'); } });
  assert.throws(() => contract.decodeBoundEntry(v.entry, v.expected), /OBSERVATION_BINDING_REFUSED/);
  assert.equal(calls, 0);
});
test('unavailable evidence keeps the accepted old source and never becomes fresh or executable', () => {
  const v = sourceFixture(), result = contract.decodeBoundEntry({ ...v.entry, available: false }, v.expected);
  assert.equal(result.availability, 'unavailable'); assert.deepEqual(result.observedBy, verifier('2'));
  assert.equal(result.fresh, false); assert.equal(result.canExecute, false);
});
