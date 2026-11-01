/** Approved Linux loopback mTLS fixtures only; no original key, identity or grant. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:https';
import { once } from 'node:events';
import { createTaskJournalCapabilityHandler } from '../server/task-listing-bootstrap-core.mjs';
import { createWholeReceiptHost } from '../server/whole-receipt-host.mjs';
import { certificates } from './helpers/task-https-fixture.mjs';

async function fixture(t, options = {}) {
  const certs = await certificates(t), calls = [];
  const consumerPeerId = 'spiffe://artfi/journal';
  const registry = { consumeCapability(value, peer) { calls.push({ value, peer });
    if (options.consume) return options.consume(value, peer); return { accepted: true }; } };
  const configuration = { peerId: consumerPeerId, clientFingerprint256: certs.journal.fingerprint };
  const binding = { createInstallation: () => Object.freeze({ authOptions: {}, connectAuthorization() {},
    consumeCapability: registry.consumeCapability.bind(registry), operation() {}, stop() {} }), journalStore: {}, consumerPeerId,
    taskExecutorIdentity: {}, provider: {}, journal: {} };
  const host = createWholeReceiptHost({ binding, store: {} }); host.connectAuthorization({});
  const handler = host.createCapabilityRequestHandler(configuration);
  const server = createServer({ cert: certs.wallet.certBytes, key: certs.wallet.keyBytes, ca: certs.caBytes,
    requestCert: true, rejectUnauthorized: true }, handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await host.stop(); });
  const call = (overrides = {}) => new Promise((resolve, reject) => {
    const body = overrides.body ?? JSON.stringify({ capability: 'fixture-token', peerId: 'body-is-not-authenticated-peer' });
    const client = overrides.certificate ?? certs.journal;
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path: overrides.path ?? '/internal/v1/task-journal-capabilities/consume',
      method: overrides.method ?? 'POST', agent: false, cert: client.certBytes, key: client.keyBytes, ca: certs.caBytes,
      headers: { 'content-type': 'application/json', ...overrides.headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.once('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); req.once('error', reject); req.end(body);
  });
  return { certs, calls, configuration, host, handler, call };
}

test('receipt handler mounts on an existing TLS listener and passes only its verified URI peer', async t => {
  const f = await fixture(t), result = await f.call();
  assert.equal(result.status, 200); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].peer, 'spiffe://artfi/journal');
  assert.equal(f.calls[0].value.peerId, 'body-is-not-authenticated-peer');
});

test('trusted certificate with wrong pinned fingerprint or URI cannot consume a receipt capability', async t => {
  const f = await fixture(t);
  assert.equal((await f.call({ certificate: f.certs.wallet })).status, 403);
  assert.equal(f.calls.length, 0);
  const wrong = createTaskJournalCapabilityHandler({ peerId: 'spiffe://artfi/other', clientFingerprint256: f.certs.journal.fingerprint },
    { consumeCapability() { throw Error('must not consume'); } });
  let status; await wrong({ socket: { encrypted: true, authorized: true, getPeerCertificate: () => ({ fingerprint256: f.certs.journal.fingerprint,
    subjectaltname: 'URI:spiffe://artfi/journal' }) } }, { setHeader() {}, set statusCode(value) { status = value; }, end() {} });
  assert.equal(status, 403);
});

test('HTTP, spoofed peer headers and unverified TLS cannot reach the registry', async t => {
  const f = await fixture(t);
  for (const socket of [{ encrypted: false, authorized: true }, { encrypted: true, authorized: false }]) {
    let status;
    await f.handler({ socket: { ...socket, getPeerCertificate: () => ({ fingerprint256: f.certs.journal.fingerprint,
      subjectaltname: 'URI:spiffe://artfi/journal' }) }, headers: { 'x-peer-id': 'spiffe://artfi/journal' } },
    { setHeader() {}, set statusCode(value) { status = value; }, end() {} });
    assert.equal(status, 403);
  }
  assert.equal(f.calls.length, 0);
});

test('fixed method/path, browser rejection, JSON parsing and 16KiB bound precede registry consumption', async t => {
  const f = await fixture(t);
  for (const change of [{ path: '/auth/bootstrap' }, { path: '/internal/v1/task-journal-capabilities/consume?peer=other' },
    { method: 'PUT' }, { headers: { origin: 'https://wallet.example.invalid' } }, { headers: { 'sec-fetch-site': 'same-origin' } },
    { headers: { 'content-type': 'text/plain' } }, { body: '{' }, { body: JSON.stringify({ data: 'a'.repeat(16384) }) }])
    assert.equal((await f.call(change)).status, 403);
  assert.equal(f.calls.length, 0);
});

test('a registry rejection is terminal for that request and never tries another registry', async t => {
  let attempts = 0; const f = await fixture(t, { consume() { attempts++; throw Error('TASK_JOURNAL_CAPABILITY_REFUSED'); } });
  assert.equal((await f.call()).status, 403); assert.equal(attempts, 1);
});

test('host binds only its configured consumer and detaches verified listener identity from later mutation', async t => {
  const f = await fixture(t);
  assert.throws(() => f.host.createCapabilityRequestHandler({ ...f.configuration, peerId: 'spiffe://artfi/other' }), /BINDING_REFUSED/);
  f.configuration.peerId = 'spiffe://artfi/other'; f.configuration.clientFingerprint256 = '0'.repeat(64);
  assert.equal((await f.call()).status, 200); assert.equal(f.calls[0].peer, 'spiffe://artfi/journal');
  await f.host.stop(); assert.throws(() => f.host.createCapabilityRequestHandler(f.configuration), /NOT_ACCEPTING/);
});
