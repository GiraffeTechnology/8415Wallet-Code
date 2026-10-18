import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskActivityReader, taskActivity } from '../web/task-activity.mjs';

// Synthetic decoded views only. These definitions are not runtime or chain evidence.
const digest = '0x' + '1'.repeat(64);
const otherDigest = '0x' + '2'.repeat(64);
const receiptView = () => ({
  task: { digest, policy: { taskId: 'synthetic-observer-receipt', expiresAt: '2000000000',
    fees: { totalWei: '100', perOperationWei: '60' }, intent: { kind: 'artfi-receipt' } } },
  effectiveStatus: 'authorized', budget: { revision: '2', reservations: [] },
  receiptAttempts: [{ operationId: 'synthetic-phase', phase: 'funded', nonce: '0',
    maximumFeeWei: '60', status: 'outcome-unknown', transactionHash: null }],
  completion: { state: 'completed' },
  observations: [{ privateSourceReference: 'synthetic-source-reference' }],
});

test('detail preserves decoded evidence while public status retains unknown receipt reservation', async () => {
  const view = receiptView(), calls = [];
  const reader = new TaskActivityReader({ request: async (path, body) => {
    calls.push({ path, body }); return { synthetic: true };
  }, decode: raw => { assert.deepEqual(raw, { synthetic: true }); return view; } });
  assert.equal(await reader.detail(digest), view);
  const status = await reader.status(digest);
  assert.equal(status.allocatedFeeCeilingWei, '60');
  assert.equal(status.unallocatedFeeCeilingWei, '40');
  assert.equal(status.unknownCount, 1);
  assert.equal(status.receiptExecutionState, 'unknown');
  assert.equal(status.savedCompletionState, null);
  assert.equal(status.canExecute, false);
  assert.equal(JSON.stringify(status).includes('synthetic-source-reference'), false);
  assert.deepEqual(calls, [1, 2].map(() => ({ path: 'tasks/status', body: { taskDigest: digest } })));
});

test('detail and public status both reject a decoded task substitution', async () => {
  const view = receiptView(); view.task.digest = otherDigest;
  const reader = new TaskActivityReader({ request: async () => ({}), decode: () => view });
  await assert.rejects(reader.detail(digest), /TASK_ACTIVITY_REFUSED/);
  await assert.rejects(reader.status(digest), /TASK_ACTIVITY_REFUSED/);
});

test('invalid detail digest cannot dispatch a request', async () => {
  let reads = 0;
  const reader = new TaskActivityReader({ request: async () => { reads++; }, decode: x => x });
  await assert.rejects(reader.detail('not-a-digest'), /TASK_ACTIVITY_REFUSED/);
  assert.equal(reads, 0);
});

test('receipt projection retains the main branch budget refusal', () => {
  const view = receiptView(); view.task.policy.fees.totalWei = '59';
  assert.throws(() => taskActivity(view), /TASK_ACTIVITY_REFUSED/);
});
