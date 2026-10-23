/** Durable ON proof gates, not an authorization issuer or HTTP approval flag.
 * Call only inside the existing credential/grant/operation/nonce store boundary,
 * AFTER the caller's current principal, scope, grant, balance and nonce checks.
 * The human verifier writes a ready record in that SAME transaction as consuming
 * its purpose-bound factor. Never accept such a record from an execution body.
 */
import { digest } from './crypto.mjs';
import { readTaskGrantVerificationPolicy } from './task-verification-execution.mjs';
import { fields, revision, TaskVerificationPolicyError } from './task-verification-state.mjs';

const SCHEMA = '8415-task-operation-human-verification/1';
export const TASK_OPERATION_PROOF_LIFE_MS = 120_000;
const refuse = (code = 'TASK_OPERATION_VERIFICATION_REQUIRED', status = 409) => {
  throw new TaskVerificationPolicyError(code, status);
};
const check = (ok, code, status) => { if (!ok) refuse(code, status); };
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
const clock = time => { check(Number.isSafeInteger(time) && time >= 0, 'TASK_OPERATION_VERIFICATION_CLOCK_REFUSED', 503); return time; };
const freeze = value => { for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item); return Object.freeze(value); };
const exact = (value, keys) => {
  try { fields(value, keys); } catch { refuse('TASK_OPERATION_VERIFICATION_STATE_REFUSED', 503); }
  check(Object.keys(value).length === keys.length, 'TASK_OPERATION_VERIFICATION_STATE_REFUSED', 503);
};

/** Derive from a frozen, caller-validated durable child and nonce reservation.
 * Both regular and listing children are identified by their complete digest;
 * nonceClaimDigest includes the actual global operation key, never a body key.
 * This returns display/binding data, not proof that a human has approved it.
 */
export function taskOperationVerificationBinding(credential, grant, operation, nonce) {
  const policy = readTaskGrantVerificationPolicy(credential, grant);
  check(['8415-task-operation/1', '8415-task-operation/2'].includes(operation?.schema) &&
    hash(operation.child?.digest) && operation.child?.child?.taskDigest === grant.task.digest &&
    typeof operation.child.child.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operation.child.child.operationId) &&
    typeof grant.reference === 'string' && /^grant:[A-Za-z0-9_-]{43}$/.test(grant.reference) &&
    typeof operation.grantKey === 'string' && /^task-grant:[0-9a-f]{64}$/.test(operation.grantKey) &&
    typeof nonce?.operationKey === 'string' && /^task-operation:[0-9a-f]{64}$/.test(nonce.operationKey) &&
    nonce.taskDigest === grant.task.digest && nonce.childDigest === operation.child.digest &&
    typeof nonce.permanent === 'boolean', 'TASK_OPERATION_VERIFICATION_BINDING_REFUSED', 503);
  revision(grant.grantPolicyVersion);
  const value = { scopeDigest: policy.scopeDigest, policyRevision: policy.revision,
    credentialRevision: policy.credentialRevision, taskDigest: policy.taskDigest,
    executorDigest: policy.executorDigest, grantReference: grant.reference,
    grantPolicyVersion: grant.grantPolicyVersion, grantKey: operation.grantKey,
    childDigest: operation.child.digest, operationId: operation.child.child.operationId,
    nonceClaimDigest: digest(JSON.stringify({ operationKey: nonce.operationKey,
      taskDigest: nonce.taskDigest, childDigest: nonce.childDigest })) };
  return freeze({ ...value, digest: digest(JSON.stringify(value)) });
}

function proofFor(credential, grant, operation, nonce, time, state) {
  clock(time);
  const proof = operation.humanVerification;
  exact(proof, ['schema', 'purpose', 'state', 'binding', 'challengeId', 'issuedAt', 'expiresAt', 'verifiedAt',
    ...(state === 'consumed' ? ['consumedAt'] : [])]);
  check(proof.schema === SCHEMA && proof.purpose === 'execute-exact-child' && proof.state === state &&
    typeof proof.challengeId === 'string' && /^operation-challenge:[A-Za-z0-9_-]{43}$/.test(proof.challengeId),
  'TASK_OPERATION_VERIFICATION_STATE_REFUSED', 503);
  const expected = taskOperationVerificationBinding(credential, grant, operation, nonce);
  exact(proof.binding, Object.keys(expected));
  check(Object.keys(expected).every(key => proof.binding[key] === expected[key]), 'TASK_OPERATION_VERIFICATION_BINDING_CHANGED');
  check([proof.issuedAt, proof.expiresAt, proof.verifiedAt].every(value => Number.isSafeInteger(value) && value >= 0) &&
    proof.issuedAt <= proof.verifiedAt && proof.verifiedAt < proof.expiresAt && proof.verifiedAt <= time &&
    proof.expiresAt - proof.issuedAt > 0 && proof.expiresAt - proof.issuedAt <= TASK_OPERATION_PROOF_LIFE_MS &&
    time >= proof.issuedAt && time < proof.expiresAt, 'TASK_OPERATION_VERIFICATION_EXPIRED');
  if (state === 'consumed') check(Number.isSafeInteger(proof.consumedAt) &&
    proof.verifiedAt <= proof.consumedAt && proof.consumedAt <= time && proof.consumedAt < proof.expiresAt,
  'TASK_OPERATION_VERIFICATION_STATE_REFUSED', 503);
  return proof;
}

function exempt(credential, grant, serverTestScope) {
  // Callback is captured by the owning service, never supplied by an HTTP body.
  // Only an actually test-approved grant AND a fresh scoped machine check exempt.
  const policy = readTaskGrantVerificationPolicy(credential, grant);
  check(typeof serverTestScope === 'boolean', 'TASK_OPERATION_VERIFICATION_CONFIG_REFUSED', 500);
  if (serverTestScope) check(grant.approvalFactor === 'server-test-scope', 'TASK_OPERATION_VERIFICATION_TEST_SCOPE_REFUSED', 403);
  return policy.mode === 'OFF' || serverTestScope;
}

/** Must be persisted atomically WITH reserved -> UNKNOWN and permanent nonce.
 * It is deliberately non-mutating. Reading or invoking this helper alone does
 * not spend anything, so callers cannot commit a proof separately from attempt.
 */
export function consumeTaskOperationVerification(credential, grant, operation, nonce, time, serverTestScope = false) {
  clock(time);
  check(operation?.status === 'reserved' && nonce?.permanent === false,
    'TASK_OPERATION_VERIFICATION_ALREADY_ATTEMPTED');
  taskOperationVerificationBinding(credential, grant, operation, nonce);
  if (exempt(credential, grant, serverTestScope)) return { ...operation, humanVerificationEnforced: true };
  check(operation.humanVerification !== undefined, 'TASK_OPERATION_VERIFICATION_REQUIRED');
  const proof = proofFor(credential, grant, operation, nonce, time, 'ready');
  return { ...operation, humanVerificationEnforced: true,
    humanVerification: { ...proof, state: 'consumed', consumedAt: time } };
}

/** Recheck the SAME one-use durable attempt at each real signing/broadcast gate.
 * This does not consume again. Revisions are live, not cached on the grant.
 * Never call on submitted/UNKNOWN recovery: those paths are read-only and must
 * keep reconciling the original attempt even after policy change or expiry.
 */
export function assertTaskOperationVerificationAttempt(credential, grant, operation, nonce, time, serverTestScope = false) {
  clock(time);
  check(operation?.humanVerificationEnforced === true && operation.status === 'outcome-unknown' && nonce?.permanent === true &&
    operation.attemptGrantPolicyVersion === grant.grantPolicyVersion && operation.attemptExecutor?.digest === grant.executor.digest,
  'TASK_OPERATION_VERIFICATION_ATTEMPT_REFUSED');
  taskOperationVerificationBinding(credential, grant, operation, nonce);
  if (exempt(credential, grant, serverTestScope)) return;
  check(operation.humanVerification !== undefined, 'TASK_OPERATION_VERIFICATION_REQUIRED');
  proofFor(credential, grant, operation, nonce, time, 'consumed');
}
