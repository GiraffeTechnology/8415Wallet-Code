import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskExactRuntime } from '../server/task-exact-runtime.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';

function configured() {
  let calls = 0;
  return { calls: () => calls, value: {
    provider: { request() { calls++; throw Error('No RPC expected during construction'); } },
    externalSigner: { signExactTransaction() { calls++; throw Error('No signing expected during construction'); } },
    signerIdentity: { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: `0x${'5'.repeat(64)}` },
    maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1',
    observationPolicy: { minimumConfirmations: '2' },
  } };
}

test('disabled runtime supplies no authority, identity or policy', () => {
  const runtime = createTaskExactRuntime();
  assert.equal(runtime.state, 'disabled');
  assert.deepEqual(runtime.authOptions, {});
  assert.ok(Object.isFrozen(runtime.authOptions));
});

test('constructs executor and observer using one protected auth store without RPC or signing', () => {
  const c = configured();
  const runtime = createTaskExactRuntime({ store: new MemoryCredentialStore(), serverConfiguration: c.value });
  const options = runtime.authOptions;
  assert.equal(runtime.state, 'configured');
  assert.strictEqual(options.taskExecutorIdentity, options.taskExecution.identity);
  assert.deepEqual(options.taskObservationPolicy, options.taskReceipt.observationPolicy.policy);
  assert.equal(options.taskExecutorIdentity.adapterId, '8415wallet:external-exact-signer');
  for (const name of ['verify', 'send', 'recover']) assert.equal(typeof options.taskExecution[name], 'function');
  for (const name of ['observe', 'assessChild', 'observeReplacement']) assert.equal(typeof options.taskReceipt[name], 'function');
  assert.equal(options.taskExecution.plan, undefined, 'unconfigured planning remains unavailable');
  assert.equal(options.taskReceipt.send, undefined);
  assert.equal(c.calls(), 0);
});

test('refuses missing sign-only capability and missing shared store', () => {
  const c = configured().value;
  assert.throws(() => createTaskExactRuntime({ serverConfiguration: c }));
  delete c.externalSigner;
  assert.throws(() => createTaskExactRuntime({ store: new MemoryCredentialStore(), serverConfiguration: c }), /TASK_EXACT_RUNTIME_CONFIG_REFUSED/);
});

test('refuses arbitrary fields, accessor capabilities and malformed observation policy', () => {
  const make = value => createTaskExactRuntime({ store: new MemoryCredentialStore(), serverConfiguration: value });
  assert.throws(() => make({ ...configured().value, store: {} }), /TASK_EXACT_RUNTIME_CONFIG_REFUSED/);
  const c = configured().value;
  Object.defineProperty(c, 'provider', { get() { throw Error('Accessor must not execute'); } });
  assert.throws(() => make(c), /TASK_EXACT_RUNTIME_CONFIG_REFUSED/);
  assert.throws(() => make({ ...configured().value, observationPolicy: { minimumConfirmations: '0' } }));
});

test('detaches source policy and identity inputs', () => {
  const c = configured().value;
  const runtime = createTaskExactRuntime({ store: new MemoryCredentialStore(), serverConfiguration: c });
  const digest = runtime.authOptions.taskExecutorIdentity.implementationDigest;
  c.observationPolicy.minimumConfirmations = '1';
  c.signerIdentity.implementationDigest = `0x${'6'.repeat(64)}`;
  assert.equal(runtime.authOptions.taskObservationPolicy.minimumConfirmations, '2');
  assert.equal(runtime.authOptions.taskExecutorIdentity.implementationDigest, digest);
});
