import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTaskAuthOptions } from '../server/task-runtime-composition.mjs';
const identity = { schema: '8415-task-executor/1', agentId: 'synthetic:agent', agentVersion: '1',
  adapterId: 'synthetic:adapter', adapterVersion: '1', implementationDigest: '0x' + '1'.repeat(64) };
const policy = { minimumConfirmations: '2' };
const exact = () => ({ taskExecution: {}, taskReceipt: {}, taskExecutorIdentity: { ...identity }, taskObservationPolicy: { ...policy } });
const listing = () => ({ taskListingExecution: {}, taskListingResults: {},
  taskExecutorIdentity: { ...identity, adapterId: 'artfi:seaport' }, taskObservationPolicy: { minimumConfirmations: '3' } });
test('no runtime means no injected task authority', () => assert.deepEqual(composeTaskAuthOptions(), {}));
test('exact ports and detached approval facts are channel-bound, not global', () => {
  const source = exact(), options = composeTaskAuthOptions({ exact: source });
  assert.strictEqual(options.taskExecution, source.taskExecution);
  assert.strictEqual(options.taskReceipt, source.taskReceipt);
  assert.equal(Object.hasOwn(options, 'taskExecutorIdentity'), false);
  assert.equal(Object.hasOwn(options, 'taskObservationPolicy'), false);
  const binding = options.taskChannelBindings['exact-operation'];
  assert.deepEqual(binding.executorIdentity, identity);
  source.taskExecutorIdentity.agentVersion = '2';
  assert.equal(binding.executorIdentity.agentVersion, '1');
  assert.ok(Object.isFrozen(options) && Object.isFrozen(binding));
});
test('distinct exact/listing/ArtFi identities and policies remain isolated', () => {
  const options = composeTaskAuthOptions({ exact: exact(), listing: listing(), artfi: {
    taskReceiptHandlerId: 'artfi:whole-receipt:v1', taskExecutorIdentity: { ...identity, adapterId: 'synthetic:whole-receipt' } } });
  const bindings = options.taskChannelBindings;
  assert.deepEqual(Object.keys(bindings), ['exact-operation', 'nft-sale', 'artfi-receipt']);
  assert.equal(bindings['exact-operation'].executorIdentity.adapterId, 'synthetic:adapter');
  assert.equal(bindings['nft-sale'].executorIdentity.adapterId, 'artfi:seaport');
  assert.equal(bindings['exact-operation'].observationPolicy.minimumConfirmations, '2');
  assert.equal(bindings['nft-sale'].observationPolicy.minimumConfirmations, '3');
  assert.equal(bindings['artfi-receipt'].observationPolicy, null);
});
test('same approval identity cannot be reused by different channels', () => {
  assert.throws(() => composeTaskAuthOptions({ exact: exact(), listing: { ...listing(), taskExecutorIdentity: { ...identity } } }), /TASK_RUNTIME_EXECUTOR_REUSE_REFUSED/);
});
test('runtime cannot override auth store or inject a different channel port', () => {
  for (const value of [{ store: {} }, { origin: 'https://example.invalid' }, { taskReceiptHandlerId: 'artfi:whole-receipt:v1' }])
    assert.throws(() => composeTaskAuthOptions({ exact: value }), /TASK_RUNTIME_OPTIONS_REFUSED/);
  const value = {};
  Object.defineProperty(value, 'taskExecutorIdentity', { get() { throw Error('not invoked'); } });
  assert.throws(() => composeTaskAuthOptions({ listing: value }), /TASK_RUNTIME_OPTIONS_REFUSED/);
});
test('ports require their own approvals and the receipt handler ID is fixed', () => {
  assert.throws(() => composeTaskAuthOptions({ exact: { taskExecution: {} } }), /TASK_RUNTIME_EXECUTOR_REQUIRED/);
  assert.throws(() => composeTaskAuthOptions({ exact: { taskExecution: {}, taskExecutorIdentity: identity } }), /TASK_RUNTIME_OBSERVATION_REQUIRED/);
  assert.throws(() => composeTaskAuthOptions({ exact: { taskReceipt: {} } }), /TASK_RUNTIME_UNUSED_BINDING_REFUSED/);
  assert.throws(() => composeTaskAuthOptions({ artfi: { taskReceiptHandlerId: 'exact', taskExecutorIdentity: identity } }), /TASK_RUNTIME_RECEIPT_HANDLER_REFUSED/);
});
test('unbound channel metadata cannot masquerade as configured authority', () => {
  assert.throws(() => composeTaskAuthOptions({ exact: { taskExecutorIdentity: identity, taskObservationPolicy: policy } }), /TASK_RUNTIME_UNUSED_BINDING_REFUSED/);
});
