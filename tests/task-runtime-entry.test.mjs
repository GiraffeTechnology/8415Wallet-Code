import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthRuntime } from '../server/main.mjs';
import { createTaskExactRuntime } from '../server/task-exact-runtime.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { disabledTaskListingRuntime } from '../server/task-listing-runtime.mjs';

const origin = 'https://wallet.example.invalid';
const configuration = () => ({ origin, tenant: 'xiongan', port: 31999,
  statePath: '/synthetic-task-runtime/credentials.enc',
  accounts: [{ username: 'tester', wallets: [{ account: `0x${'1'.repeat(40)}`, chainId: '560048' }] }] });
function exact() {
  return { provider: { request() { throw Error('No RPC during entry construction'); } },
    externalSigner: { signExactTransaction() { throw Error('No signing during entry construction'); } },
    signerIdentity: { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: `0x${'5'.repeat(64)}` },
    maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1',
    observationPolicy: { minimumConfirmations: '2' } };
}
const listing = () => ({ runtime: disabledTaskListingRuntime(), async start() {}, async stop() {} });
async function capabilities(runtime) {
  let body, status;
  const response = { setHeader() {}, set statusCode(value) { status = value; }, end(value) { body = JSON.parse(value); } };
  await runtime.handler({ method: 'GET', url: '/auth/capabilities', headers: {
    host: 'wallet.example.invalid', 'x-wallet-tenant': 'xiongan' }, socket: { remoteAddress: '127.0.0.1' } }, response);
  assert.equal(status, 200);
  return body;
}
test('standard runtime entry stays disabled with absent trusted exact capability', async () => {
  const runtime = await createAuthRuntime({ config: configuration(), store: new MemoryCredentialStore(), listingRuntime: listing() });
  try {
    assert.equal(runtime.exactState, 'disabled');
    assert.equal((await capabilities(runtime)).taskAuthorization.adapterConfigured, false);
    assert.equal(runtime.server.listening, false);
  } finally { await runtime.stop(); }
});
test('standard runtime boundary instantiates and injects the configured exact adapter', async () => {
  const runtime = await createAuthRuntime({ config: configuration(), store: new MemoryCredentialStore(),
    listingRuntime: listing(), exactServerConfiguration: exact() });
  try {
    assert.equal(runtime.exactState, 'configured');
    const result = await capabilities(runtime);
    assert.equal(result.taskAuthorization.adapterConfigured, true);
    assert.equal(result.taskAuthorization.executable, false, 'port availability is not authorization or execution');
    assert.equal(runtime.server.listening, false, 'this test does not open a listener');
  } finally { await runtime.stop(); }
});
test('JSON configuration cannot inject execution ports', async () => {
  for (const field of ['taskExecution', 'exactServerConfiguration', 'taskExecutorIdentity'])
    await assert.rejects(createAuthRuntime({ config: { ...configuration(), [field]: {} },
      store: new MemoryCredentialStore(), listingRuntime: listing() }), /AUTH_CONFIG_FIELD_REFUSED/);
});
test('entry rejects listing metadata without a listing port and stops its bootstrap', async () => {
  let stopped = 0;
  const l = listing();
  l.runtime = { ...l.runtime, authOptions: { taskExecutorIdentity: { schema: '8415-task-executor/1',
    agentId: 'synthetic:other', agentVersion: '1', adapterId: 'artfi:seaport', adapterVersion: '1',
    implementationDigest: `0x${'6'.repeat(64)}` }, taskObservationPolicy: { minimumConfirmations: '2' } } };
  l.stop = async () => { stopped++; };
  await assert.rejects(createAuthRuntime({ config: configuration(), store: new MemoryCredentialStore(),
    listingRuntime: l, exactServerConfiguration: exact() }), /TASK_RUNTIME_UNUSED_BINDING_REFUSED/);
  assert.equal(stopped, 1);
});

test('entry composes exact and listing ports with separate approval identities', async () => {
  const l = listing();
  l.runtime = { ...l.runtime, authOptions: {
    taskListingExecution: { async verify() {}, async send() {}, async recover() {} },
    taskExecutorIdentity: { schema: '8415-task-executor/1', agentId: 'synthetic:listing', agentVersion: '1',
      adapterId: 'artfi:seaport', adapterVersion: '1', implementationDigest: '0x' + '6'.repeat(64) },
    taskObservationPolicy: { minimumConfirmations: '3' } } };
  const runtime = await createAuthRuntime({ config: configuration(), store: new MemoryCredentialStore(),
    listingRuntime: l, exactServerConfiguration: exact() });
  try {
    const result = await capabilities(runtime);
    assert.equal(result.taskAuthorization.adapterConfigured, true);
    assert.equal(result.taskAuthorization.listing.adapterConfigured, true);
  } finally { await runtime.stop(); }
});
test('entry rejects reused channel identity before starting either runtime', async () => {
  const c = exact(), store = new MemoryCredentialStore(), identity = createTaskExactRuntime({ store, serverConfiguration: c }).authOptions.taskExecutorIdentity;
  const l = listing(); let stopped = 0;
  l.runtime = { ...l.runtime, authOptions: {
    taskListingExecution: { async verify() {}, async send() {}, async recover() {} },
    taskExecutorIdentity: identity, taskObservationPolicy: { minimumConfirmations: '2' } } };
  l.stop = async () => { stopped++; };
  await assert.rejects(createAuthRuntime({ config: configuration(), store, listingRuntime: l,
    exactServerConfiguration: c }), /TASK_RUNTIME_EXECUTOR_REUSE_REFUSED/);
  assert.equal(stopped, 1);
});
