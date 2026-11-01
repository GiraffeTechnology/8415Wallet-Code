/** Actual pinned producer factories through the original loader and Wallet host.
 * No granted execution: original receipt registry remains empty and must refuse. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';
import { loadInstalledTaskListingModules } from '../server/task-listing-installed.mjs';
import { createWholeReceiptBootstrapBinding } from '../server/whole-receipt-host.mjs';
import { createSecureContext } from 'node:tls';
const producer = await loadInstalledTaskListingModules();
import { once } from 'node:events';
import { createAuthRuntime } from '../server/main.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { disabledTaskListingRuntime } from '../server/task-listing-runtime.mjs';
import { createTaskJournalCapabilityListener } from '../server/task-listing-bootstrap-core.mjs';
import { certificates } from './helpers/task-https-fixture.mjs';

async function composition(t) {
  const certs = await certificates(t), store = new MemoryCredentialStore(), journalStore = {};
  const state = { factoryCalls: 0, connections: 0, consumes: [], providerCalls: 0, stops: 0 };
  const identity = Object.freeze({ schema: '8415-task-executor/1', agentId: 'fixture:receipt', agentVersion: '1',
    adapterId: 'artfi:whole-receipt:v1', adapterVersion: '1', implementationDigest: '0x' + '7'.repeat(64) });
  let peer;
  const runtime = await createAuthRuntime({ config: { origin: 'https://wallet.example.invalid', tenant: 'fixture', port: 31999,
    statePath: '/synthetic/credentials.enc', accounts: [{ username: 'tester', wallets: [{ account: '0x' + '1'.repeat(40), chainId: '31337' }] }] },
    store, listingRuntime: { runtime: disabledTaskListingRuntime(), async start() {}, async stop() {
      if (peer?.listening) await new Promise(resolve => peer.close(resolve));
    } }, wholeReceipt: createWholeReceiptBootstrapBinding({
      createInstallation(input) {
        state.factoryCalls++; assert.strictEqual(input.store, store); assert.strictEqual(input.journalStore, journalStore);
        const installation = producer.createWholeReceiptInstallation(input);
        return Object.freeze({ authOptions: installation.authOptions,
          connectAuthorization(authority) { state.connections++; state.authority = authority; installation.connectAuthorization(authority); },
          consumeCapability(value, authenticatedPeerId) { state.consumes.push({ value, authenticatedPeerId }); return installation.consumeCapability(value, authenticatedPeerId); },
          operation: installation.operation,
          stop() { state.stops++; installation.stop(); } });
      }, createJournalTransport: producer.createNftTaskJournalHttpsTransport, journalStore, consumerPeerId: 'spiffe://artfi/journal', taskExecutorIdentity: identity,
      provider: { request() { state.providerCalls++; throw Error('NO_PROVIDER_IO'); } },
      journal: { url: 'https://journal.example.invalid/internal/v1/nft/operations', peerId: 'spiffe://artfi/wallet',
        secureContext: createSecureContext({ cert: certs.wallet.certBytes, key: certs.wallet.keyBytes, ca: certs.caBytes }) }
    }) });
  // This is the pre-existing listener factory, with exactly one registry owner:
  // the already connected host consumer. No new product listener/URL/API exists.
  peer = createTaskJournalCapabilityListener({ peerId: 'spiffe://artfi/journal', clientFingerprint256: certs.journal.fingerprint },
    { cert: certs.wallet.certBytes, key: certs.wallet.keyBytes, ca: certs.caBytes }, runtime.wholeReceipt);
  peer.listen(0, '127.0.0.1'); await once(peer, 'listening');
  t.after(() => runtime.stop());
  return { runtime, peer, certs, store, state };
}
const input = () => ({ capability: 'x'.repeat(43), peerId: 'spiffe://artfi/wallet', action: 'get',
  nativeOperationId: 'native_' + '1'.repeat(64), planDigest: '', requestDigest: '2'.repeat(64) });
function consume(f, client = f.certs.journal) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: f.peer.address().port, method: 'POST',
      path: '/internal/v1/task-journal-capabilities/consume', agent: false,
      cert: client.certBytes, key: client.keyBytes, ca: f.certs.caBytes, headers: { 'content-type': 'application/json' } }, response => {
      const chunks = []; response.on('data', value => chunks.push(value));
      response.once('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); req.once('error', reject); req.end(JSON.stringify(input()));
  });
}

test('existing auth caller and mTLS listener reach the same connected real receipt registry without granting access', async t => {
  const f = await composition(t);
  assert.equal(f.state.factoryCalls, 1); assert.equal(f.state.connections, 1);
  assert.strictEqual(f.state.authority, f.runtime.handler.taskReceiptAuthorization);
  for (const key of ['withPreparation','withAuthorization','readState','assertIndependentStore']) assert.equal(typeof f.state.authority[key], 'function');
  const before = await f.store.read('fixture:tester');
  const result = await consume(f);
  assert.equal(result.status, 403); assert.deepEqual(result.body, { error: 'TASK_JOURNAL_CAPABILITY_REFUSED' });
  assert.equal(f.state.consumes.length, 1); assert.equal(f.state.consumes[0].authenticatedPeerId, 'spiffe://artfi/journal');
  assert.deepEqual(f.state.consumes[0].value, input());
  assert.deepEqual(await f.store.read('fixture:tester'), before);
  assert.equal((await consume(f, f.certs.wallet)).status, 403);
  assert.equal(f.state.consumes.length, 1, 'wrong TLS peer cannot try the registry');
  assert.equal(f.state.providerCalls, 0); assert.equal(f.runtime.server.listening, false);
  await f.runtime.stop(); assert.equal(f.peer.listening, false); assert.equal(f.state.stops, 1);
});

test('configured receipt consumer is never mounted as a bearer route on ordinary auth HTTP', async t => {
  const f = await composition(t);
  const observed = [];
  f.runtime.server.prependListener('request', req => observed.push({ host: req.headers.host,
    origin: req.headers.origin, tenant: req.headers['x-wallet-tenant'], path: req.url }));
  f.runtime.server.listen(0, '127.0.0.1'); await once(f.runtime.server, 'listening');
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: f.runtime.server.address().port,
      path: '/internal/v1/task-journal-capabilities/consume', method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'x-wallet-tenant': 'fixture', host: 'wallet.example.invalid',
        origin: 'https://wallet.example.invalid', authorization: 'Bearer ' + 'x'.repeat(43) } }, res => {
      const chunks = []; res.on('data', value => chunks.push(value));
      res.once('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); req.once('error', reject); req.end(JSON.stringify(input()));
  });
  const body = response.body;
  t.diagnostic(JSON.stringify({ status: response.status, body, observed }));
  assert.deepEqual(observed, [{ host: 'wallet.example.invalid', origin: 'https://wallet.example.invalid',
    tenant: 'fixture', path: '/internal/v1/task-journal-capabilities/consume' }]);
  assert.equal(response.status, 404);
  assert.deepEqual(body, { error: 'AUTH_ROUTE_REFUSED' });
  assert.equal(f.state.consumes.length, 0); assert.equal(f.state.providerCalls, 0);
});
