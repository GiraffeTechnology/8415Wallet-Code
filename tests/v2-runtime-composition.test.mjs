/** Process composition over actual HTTP. Synthetic store and capability objects;
 * no real RPC, signing, publication, credential files or service installation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createAuthRuntime } from '../server/v2/main.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
async function config() {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  return { origin: `http://127.0.0.1:${port}`, tenant: 'fixture', port,
    statePath: '/synthetic-v2/credentials.enc', accounts: [{ username: 'owner',
      wallets: [{ account: '0x'+'1'.repeat(40), chainId: '1' }] }] };
}
function listing() {
  const effects = { starts: 0, stops: 0, authorized: 0 };
  return { effects,
    runtime: { state: 'configured', code: null,
      authOptions: { taskListingExecution: { async verify() { throw Error('NOT_EXECUTED'); }, async send() { throw Error('NOT_EXECUTED'); }, async recover() { throw Error('NOT_EXECUTED'); } },
        taskExecutorIdentity: { schema: '8415-task-executor/1', agentId: 'synthetic:listing', agentVersion: '1', adapterId: 'artfi:seaport', adapterVersion: '1', implementationDigest: '0x'+'6'.repeat(64) },
        taskObservationPolicy: { minimumConfirmations: '3' } },
      connectAuthorization(authority) { assert.equal(typeof authority.withAuthorization, 'function'); effects.authorized++; } },
    async start() { effects.starts++; }, async stop() { effects.stops++; } };
}
test('V2 listener serves actual truthful capability status with no private provider installed', async t => {
  const c = await config(), runtime = await createAuthRuntime({ config: c, store: new MemoryCredentialStore() });
  t.after(() => runtime.stop()); await runtime.start();
  const response = await fetch(`${c.origin}/auth/capabilities`, { headers: { 'X-Wallet-Tenant': c.tenant } });
  assert.equal(response.status, 200); const caps = await response.json();
  assert.equal(caps.taskAuthorization.adapterConfigured, false);
  assert.equal(caps.taskAuthorization.listing.code, 'TASK_LISTING_NOT_CONFIGURED');
  assert.equal(runtime.exactState, 'disabled'); assert.equal(runtime.listingState, 'disabled');
  await runtime.stop(); assert.equal(runtime.server.listening, false);
});
test('reviewed ordinary NFT listing port remains connected to real authorization and lifecycle', async t => {
  const c = await config(), l = listing(), runtime = await createAuthRuntime({ config: c, store: new MemoryCredentialStore(), listingRuntime: l });
  t.after(() => runtime.stop()); assert.equal(l.effects.authorized, 1); await runtime.start();
  const response = await fetch(`${c.origin}/auth/capabilities`, { headers: { 'X-Wallet-Tenant': c.tenant } });
  const caps = await response.json(); assert.equal(caps.taskAuthorization.listing.adapterConfigured, true);
  assert.equal(caps.taskAuthorization.executable, false, 'capability presence is not authorization');
  assert.equal(l.effects.starts, 1); await runtime.stop(); await runtime.stop(); assert.equal(l.effects.stops, 1);
});
test('HTTP configuration cannot inject a provider or bypass listing identity rules', async () => {
  const c = await config();
  await assert.rejects(createAuthRuntime({ config: { ...c, listingRuntime: listing() }, store: new MemoryCredentialStore() }), /AUTH_CONFIG_FIELD_REFUSED/);
  const l = listing(); delete l.runtime.authOptions.taskExecutorIdentity;
  await assert.rejects(createAuthRuntime({ config: c, store: new MemoryCredentialStore(), listingRuntime: l }), /TASK_RUNTIME_EXECUTOR_REQUIRED/);
  assert.equal(l.effects.stops, 1);
});
