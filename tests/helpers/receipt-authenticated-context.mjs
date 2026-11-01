/** Software receipt client for the original public producer and normal auth routes.
 * No session, grant, journal DTO or capability substitute. */
import { keccak256 } from 'ethers';
import { freezeReceiptTask } from '../../src/agent/receiptTask.ts';

const fail = code => { throw Error(code); };
const clone = value => structuredClone(value);
const phases = ['funded', 'registered', 'paid'];
const authorityKeys = ['taskId', 'taskDigest', 'executorDigest', 'grantReference', 'grantPolicyVersion', 'operationId'];

async function authenticatedCall(callAuth, path, body) {
  const response = await callAuth(path, body);
  if (response?.status !== 200 || !response.data || typeof response.data !== 'object') {
    const error = Error('RECEIPT_CLIENT_AUTH_ROUTE_REFUSED');
    error.route = path;
    error.status = response?.status ?? null;
    // Preserve the error code, never a response containing cookies/tokens.
    error.serviceCode = typeof response?.data?.error === 'string' ? response.data.error : null;
    throw error;
  }
  return response.data;
}

/** callAuth is the original logged-in HTTP client's cookie/CSRF-bound call.
 * Each input wire, operation ID, plan ID, expiry and wei budget comes from the
 * original test manifest. There are no generated grant references or defaults.
 * This prepares content and obtains authority ONLY from normal service routes.
 */
export async function prepareAuthenticatedReceiptContexts({
  runtime, callAuth, business, installationBinding, phaseInputs, expiresAt,
  fees, approvalInput, softwareReceiptBoundary,
}) {
  if (!runtime || ['createWholeReceiptApprovalCommitments', 'assertWholeReceiptApprovalPlan',
    'kernelRequestDigest'].some(name => typeof runtime[name] !== 'function')) {
    fail('RECEIPT_CLIENT_REVIEWED_PRODUCER_EXPORTS_REQUIRED');
  }
  if (typeof callAuth !== 'function' || !Array.isArray(phaseInputs) || !phaseInputs.length ||
      phaseInputs.length > phases.length) fail('RECEIPT_CLIENT_INPUT_REQUIRED');
  const binding = clone(installationBinding), originalBusiness = clone(business);
  const selected = phaseInputs.map(input => {
    if (!input || !phases.includes(input.phase) || typeof input.operationId !== 'string' ||
        typeof input.planId !== 'string' || !input.wire) fail('RECEIPT_CLIENT_PHASE_INPUT_REQUIRED');
    const rawBusiness = clone(originalBusiness);
    rawBusiness.wholeReceipt.phase = input.phase;
    // Always use the original algorithm via its verified public export.
    const commitment = runtime.createWholeReceiptApprovalCommitments(rawBusiness, binding, softwareReceiptBoundary);
    if (commitment.authorization !== 'NOT_ESTABLISHED') fail('RECEIPT_CLIENT_CONTENT_AUTHORITY_REFUSED');
    const wire = clone(input.wire);
    if (wire.account !== binding.actor || wire.chainId !== String(commitment.business.chainId) ||
        wire.to !== binding.escrow) fail('RECEIPT_CLIENT_WIRE_REALM_REFUSED');
    return { input: clone(input), commitment, wire };
  });
  const canonical = selected[0].commitment.business, receipt = canonical.wholeReceipt;
  const policy = {
    schema: '8415-agent-task/1', taskId: binding.taskId, tenant: binding.tenant,
    origin: binding.origin, chainId: String(canonical.chainId), actor: binding.actor,
    expiresAt, fees: clone(fees), intent: {
      kind: 'artfi-receipt', handlerId: 'artfi:whole-receipt:v1', escrow: binding.escrow,
      runtimeCodeHash: binding.runtimeCodeHash, segmentId: receipt.segmentId,
      sale: { ...clone(receipt.sale), startsAt: String(receipt.sale.startsAt), endsAt: String(receipt.sale.endsAt) },
      correspondence: clone(receipt.correspondence),
      phases: selected.map(({ input, commitment, wire }) => ({ phase: input.phase,
        nonce: wire.nonce, calldataHash: keccak256(wire.data),
        planDigest: commitment.receiptPlanDigest, journalBindingHash: commitment.receiptJournalBindingHash,
        gasLimit: wire.gasLimit, maxFeePerGasWei: wire.maxFeePerGasWei,
        maxPriorityFeePerGasWei: wire.maxPriorityFeePerGasWei })),
      recovery: { funding: 'once', payout: 'once', unknownOutcome: 'reconcile-only' },
    },
  };
  const frozen = freezeReceiptTask(policy);
  const prepared = await authenticatedCall(callAuth, 'tasks/prepare', { policy: frozen.policy });
  if (prepared.task?.digest !== frozen.digest || typeof prepared.challengeId !== 'string' ||
      typeof prepared.executor?.digest !== 'string') fail('RECEIPT_CLIENT_PREPARATION_BINDING_REFUSED');
  let code;
  if (prepared.approvalFactor === 'preoperational-default-on') code = '';
  else if (prepared.approvalFactor === 'server-test-scope') code = null;
  else if (prepared.approvalFactor === 'totp') {
    if (typeof approvalInput !== 'function') fail('RECEIPT_CLIENT_ORIGINAL_FACTOR_INPUT_REQUIRED');
    code = await approvalInput(prepared);
  }
  else fail('RECEIPT_CLIENT_APPROVAL_FACTOR_REFUSED');
  const grant = await authenticatedCall(callAuth, 'tasks/authorize', {
    challengeId: prepared.challengeId, taskDigest: prepared.task.digest,
    executorDigest: prepared.executor.digest,
    observationPolicyDigest: prepared.observationPolicy?.digest ?? null, code,
  });
  if (grant.task?.digest !== frozen.digest || grant.executor?.digest !== prepared.executor.digest ||
      typeof grant.authorization?.reference !== 'string' ||
      typeof grant.authorization?.grantPolicyVersion !== 'string') fail('RECEIPT_CLIENT_SERVICE_GRANT_BINDING_REFUSED');
  const contexts = selected.map(({ input, commitment, wire }) => {
    const claimed = {
      taskId: grant.task.policy.taskId, taskDigest: grant.task.digest,
      executorDigest: grant.executor.digest, grantReference: grant.authorization.reference,
      grantPolicyVersion: grant.authorization.grantPolicyVersion, operationId: input.operationId,
      phase: input.phase, planDigest: commitment.receiptPlanDigest,
      journalBindingHash: commitment.receiptJournalBindingHash,
    };
    const principal = { kind: 'task', ...Object.fromEntries(authorityKeys.map(key => [key, claimed[key]])) };
    const { kind, ...operationBinding } = principal;
    const rawPlan = { ...clone(commitment.business), id: input.planId,
      operationId: 'native_' + runtime.kernelRequestDigest(operationBinding), taskPrincipal: principal };
    const checked = runtime.assertWholeReceiptApprovalPlan(rawPlan, binding, {
      receiptPlanDigest: commitment.receiptPlanDigest,
      receiptJournalBindingHash: commitment.receiptJournalBindingHash,
    }, softwareReceiptBoundary);
    if (checked.authorization !== 'NOT_ESTABLISHED') fail('RECEIPT_CLIENT_PLAN_AUTHORITY_REFUSED');
    return Object.freeze({ task: grant.task, claimed: Object.freeze(claimed),
      principal: Object.freeze(principal), rawPlan: checked.nativePlan, rawWire: Object.freeze(wire) });
  });
  // These values originate from the normal service, never a synthetic grant.
  // Caller supplies principal over the original parent pipe, then calls the
  // existing installation.operation({task,claimed}).create(rawPlan,rawWire).
  // A real journal row is deliberately absent until that call succeeds.
  return Object.freeze({ task: grant.task, executor: grant.executor,
    humanVerification: grant.humanVerification, contexts: Object.freeze(contexts) });
}
