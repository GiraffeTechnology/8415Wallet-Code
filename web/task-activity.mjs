/** Read-only task activity. Decoding remains owned by the existing task client. */
const refuse = () => { throw new Error('TASK_ACTIVITY_REFUSED'); };
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 256;
const digest = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
export function taskActivity(view) {
  if (!view || !digest(view.task?.digest) || !['pending','authorized','suspended','revoked','expired'].includes(view.effectiveStatus)) refuse();
  const policy = view.task.policy;
  if (!decimal(policy.fees?.totalWei) || !decimal(policy.fees?.perOperationWei)) refuse();
  const reservations = view.budget?.reservations ?? [];
  if (!Array.isArray(reservations)) refuse();
  let allocated = 0n;
  const operations = reservations.map(item => {
    if (!decimal(item.feeWei) || !['reserved','outcome-unknown','submitted','cancelled'].includes(item.status)) refuse();
    if (item.status !== 'cancelled') allocated += BigInt(item.feeWei);
    // Explicit public fields only: never copy authorization references or raw response objects.
    return Object.freeze({ operationId: item.operationId, childDigest: item.childDigest,
      status: item.status, feeCeilingWei: item.feeWei,
      transactionHash: item.transactionHash ?? null,
      hasOrderReference: item.submission != null });
  });
  // Receipt phases use a separate journal, not budget.reservations. Unknown
  // attempts hold their full authorized fee ceiling until reconciliation.
  if (view.receiptAttempts !== undefined) {
    if (policy.intent?.kind !== 'artfi-receipt' || !Array.isArray(view.receiptAttempts)) refuse();
    for (const item of view.receiptAttempts) {
      if (!decimal(item.maximumFeeWei) || !['outcome-unknown','submitted'].includes(item.status)) refuse();
      allocated += BigInt(item.maximumFeeWei);
      operations.push(Object.freeze({ operationId: item.operationId, childDigest: null,
        phase: item.phase, nonce: item.nonce, status: item.status,
        feeCeilingWei: item.maximumFeeWei, transactionHash: item.transactionHash ?? null,
        hasOrderReference: false }));
    }
  }
  const total = BigInt(policy.fees.totalWei);
  if (allocated > total) refuse();
  return Object.freeze({ taskDigest: view.task.digest, taskId: policy.taskId,
    status: view.effectiveStatus, expiresAt: policy.expiresAt,
    totalFeeLimitWei: policy.fees.totalWei, perOperationFeeLimitWei: policy.fees.perOperationWei,
    allocatedFeeCeilingWei: allocated.toString(), unallocatedFeeCeilingWei: (total - allocated).toString(),
    budgetRevision: view.budget?.revision ?? null,
    unknownCount: operations.filter(item => item.status === 'outcome-unknown').length,
    submittedCount: operations.filter(item => item.status === 'submitted').length,
    operations: Object.freeze(operations),
    // Existing generic completion derives from child reservations, not receipt phases.
    savedCompletionState: view.receiptAttempts === undefined ? view.completion?.state ?? null : null,
    receiptExecutionState: view.receiptAttempts === undefined ? null :
      view.receiptAttempts.some(item => item.status === 'outcome-unknown') ? 'unknown' :
      view.receiptAttempts.length ? 'submitted' : 'not-started',
    evidence: 'SAVED_STATUS_NOT_A_FRESH_CHAIN_OBSERVATION', canExecute: false });
}
export class TaskActivityReader {
  #request; #decode;
  constructor({ request, decode }) { this.#request = request; this.#decode = decode; }
  async page(cursor = null, revision = null) {
    if ((cursor === null) !== (revision === null) ||
      cursor !== null && (!decimal(cursor) || !decimal(revision))) refuse();
    const raw = await this.#request('tasks/list', cursor === null ? {} : { cursor, revision });
    if (!raw || !Array.isArray(raw.tasks) || raw.tasks.length > 50 || !decimal(raw.revision) ||
      revision !== null && raw.revision !== revision ||
      raw.nextCursor !== null && (!decimal(raw.nextCursor) ||
        raw.tasks.length !== 50 || BigInt(raw.nextCursor) !== BigInt(cursor ?? '0') + BigInt(raw.tasks.length))) refuse();
    const tasks = raw.tasks.map(item => taskActivity(this.#decode(item)));
    if (new Set(tasks.map(item => item.taskDigest)).size !== tasks.length) refuse();
    return Object.freeze({ tasks: Object.freeze(tasks), revision: raw.revision, nextCursor: raw.nextCursor });
  }
  async status(taskDigest) {
    if (!digest(taskDigest)) refuse();
    const raw = await this.#request('tasks/status', { taskDigest });
    const result = taskActivity(this.#decode(raw));
    if (result.taskDigest !== taskDigest) refuse();
    return result;
  }
}
