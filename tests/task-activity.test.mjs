import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskActivityReader, taskActivity } from '../web/task-activity.mjs';
const digest = '0x' + '1'.repeat(64);
const fixture = () => ({
  task: { digest, policy: { taskId: 'example', expiresAt: '2000000000',
    fees: { totalWei: '100', perOperationWei: '25' } } },
  effectiveStatus: 'authorized', authorization: { reference: 'DO_NOT_COPY' },
  budget: { revision: '2', reservations: [
    { operationId: 'a', childDigest: digest, feeWei: '25', status: 'outcome-unknown', transactionHash: null },
    { operationId: 'b', childDigest: digest, feeWei: '20', status: 'submitted', transactionHash: digest },
    { operationId: 'c', childDigest: digest, feeWei: '10', status: 'cancelled', transactionHash: null }
  ] }, completion: { state: 'awaiting-evidence', fresh: true }
});
test('unknown allocation remains held and cancellation is not spent gas', () => {
  const result = taskActivity(fixture());
  assert.equal(result.allocatedFeeCeilingWei, '45');
  assert.equal(result.unallocatedFeeCeilingWei, '55');
  assert.equal(result.unknownCount, 1); assert.equal(result.submittedCount, 1);
  assert.equal(result.canExecute, false);
  assert.equal(result.evidence, 'SAVED_STATUS_NOT_A_FRESH_CHAIN_OBSERVATION');
});
test('projection excludes grant and arbitrary private extras', () => {
  const value = fixture(); value.secret = 'SECRET'; value.budget.reservations[0].secret = 'SECRET';
  const json = JSON.stringify(taskActivity(value));
  assert.equal(json.includes('SECRET'), false); assert.equal(json.includes('DO_NOT_COPY'), false);
  assert.ok(Object.isFrozen(taskActivity(value).operations));
});
test('overallocated budget fails closed', () => {
  const value = fixture(); value.task.policy.fees.totalWei = '1';
  assert.throws(() => taskActivity(value));
});
test('one page uses only the list endpoint and preserves revision cursor', async () => {
  const calls = [];
  const reader = new TaskActivityReader({ decode: x => x, request: async (path, body) => {
    calls.push({ path, body }); return { tasks: [fixture()], revision: '3', nextCursor: null };
  } });
  assert.equal((await reader.page()).nextCursor, null);
  assert.deepEqual(calls, [{ path: 'tasks/list', body: {} }]);
});
test('revision drift and nonprogressing cursor are refused', async () => {
  const reader = new TaskActivityReader({ decode: x => x, request: async () =>
    ({ tasks: [], revision: '4', nextCursor: null }) });
  await assert.rejects(reader.page('50', '3'));
  const repeated = new TaskActivityReader({ decode: x => x, request: async () =>
    ({ tasks: [], revision: '3', nextCursor: '50' }) });
  await assert.rejects(repeated.page('50', '3'));
});
test('duplicate rows, oversized pages and noncanonical cursor are refused', async () => {
  for (const tasks of [[fixture(), fixture()], Array.from({ length: 51 }, fixture)]) {
    const reader = new TaskActivityReader({ decode: x => x, request: async () =>
      ({ tasks, revision: '3', nextCursor: null }) });
    await assert.rejects(reader.page());
  }
  const reader = new TaskActivityReader({ decode: x => x, request: async () => { throw new Error('must not request'); } });
  await assert.rejects(reader.page('01', '3'));
});
test('detail uses status only and rejects a different task', async () => {
  const calls = [];
  const reader = new TaskActivityReader({ decode: x => x, request: async (path, body) => {
    calls.push({ path, body }); return fixture();
  } });
  await reader.status(digest);
  assert.deepEqual(calls, [{ path: 'tasks/status', body: { taskDigest: digest } }]);
  await assert.rejects(reader.status('0x' + '2'.repeat(64)));
});
test('decoder failure cannot publish an undecoded row', async () => {
  const reader = new TaskActivityReader({ decode: () => { throw new Error('context mismatch'); },
    request: async () => ({ tasks: [fixture()], revision: '3', nextCursor: null }) });
  await assert.rejects(reader.page());
});
