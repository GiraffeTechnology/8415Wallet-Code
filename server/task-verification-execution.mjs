/**
 * Read the current owner policy from the SAME credential/grant snapshot.
 * This projection is not a grant, approval proof or claim that ON execution is
 * implemented. Callers retain their scope/expiry/revocation/nonce checks.
 * Do not call this from submitted/UNKNOWN read-only reconciliation gates.
 */
import { digest } from './crypto.mjs';
import { readCredentialTaskVerificationPolicy, TaskVerificationPolicyError } from './task-verification-state.mjs';

const refuse = () => { throw new TaskVerificationPolicyError('TASK_VERIFICATION_GRANT_BINDING_REFUSED', 503); };
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);

/** The caller supplies a validated durable grant, never HTTP scope fields.
 * Agent identity comes from its frozen executor, not a body/session agent flag.
 * Credential and policy revisions remain independent: settings saves need not
 * rotate credentials or recreate an otherwise valid bounded task.
 */
export function readTaskGrantVerificationPolicy(credential, grant) {
  let principal;
  try { principal = JSON.parse(grant?.principal); } catch { refuse(); }
  const task = grant?.task, executor = grant?.executor;
  if (!Array.isArray(principal) || principal.length !== 5 ||
      JSON.stringify(principal) !== grant.principal ||
      principal[0] !== task?.policy?.origin || principal[1] !== task?.policy?.tenant ||
      principal[3] !== task?.policy?.actor || principal[4] !== task?.policy?.chainId ||
      !hash(task?.digest) || !hash(executor?.digest) ||
      typeof executor?.identity?.agentId !== 'string') refuse();
  const credentialRevision = credential?.revision ?? 0;
  if (!Number.isSafeInteger(credentialRevision) || credentialRevision < 0) refuse();
  const input = { origin: principal[0], tenant: principal[1], username: principal[2],
    account: principal[3], chainId: principal[4], agentId: executor.identity.agentId };
  const policy = readCredentialTaskVerificationPolicy(credential, input);
  // Never project historical factor proofs/change slots, credential material or
  // the complete credential policy map into public task/activity responses.
  return Object.freeze({ schema: '8415-task-verification-execution-view/1',
    mode: policy.mode, revision: policy.revision,
    scopeDigest: digest(JSON.stringify(policy.scope)), taskDigest: task.digest,
    executorDigest: executor.digest, credentialRevision: String(credentialRevision) });
}
