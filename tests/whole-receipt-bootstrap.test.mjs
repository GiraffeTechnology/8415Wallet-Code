/** Host composition only; actual ArtFi transport TLS tests belong to its producer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWholeReceiptBootstrapBinding, createWholeReceiptHost } from '../server/whole-receipt-host.mjs';

function fixture() {
  const context = Object.defineProperty({}, 'privateKey', { get() { throw Error('must not inspect TLS material'); } });
  const state = { builds: 0, requests: [], stops: 0 };
  const transport = async (url, init) => { state.requests.push({ url, init }); return new Response('{}'); };
  const options = { createInstallation(input) {
    state.installationInput = input;
    assert.deepEqual(Object.keys(input.journal).sort(), ['peerId', 'transport', 'url']);
    return Object.freeze({ authOptions: {}, connectAuthorization(authority) { state.authority = authority; },
      consumeCapability() {}, operation() {}, stop() { state.stops++; } });
  }, createJournalTransport(input) { state.builds++; state.transportInput = input; return transport; },
  journalStore: {}, consumerPeerId: 'spiffe://fixture/journal', taskExecutorIdentity: {}, provider: {},
  journal: { url: 'https://journal.example.invalid/internal/v1/nft/operations', peerId: 'spiffe://fixture/wallet', secureContext: context } };
  return { options, context, state, transport };
}

test('bootstrap binds original factories/context and passes only the existing journal schema to installation', async () => {
  const f = fixture(), binding = createWholeReceiptBootstrapBinding(f.options);
  assert.equal(f.state.builds, 1); assert.strictEqual(f.state.transportInput.secureContext, f.context);
  assert.deepEqual(Object.keys(f.state.transportInput).sort(), ['secureContext', 'url']);
  assert.equal(Object.isFrozen(binding), true); assert.equal(Object.isFrozen(binding.journal), true);
  for (const key of ['createInstallation', 'journalStore', 'consumerPeerId', 'taskExecutorIdentity', 'provider'])
    assert.strictEqual(binding[key], f.options[key]);
  const store = {}, host = createWholeReceiptHost({ binding, store });
  assert.strictEqual(f.state.installationInput.store, store);
  assert.strictEqual(f.state.installationInput.journal.transport, f.transport);
  assert.equal(Object.hasOwn(f.state.installationInput.journal, 'secureContext'), false);
  const authority = {}; host.connectAuthorization(authority); assert.strictEqual(f.state.authority, authority);
  await host.stop(); assert.equal(f.state.stops, 1);
});

test('transport receives the original journal call without request rebuilding, retries or error translation', async () => {
  const f = fixture(), binding = createWholeReceiptBootstrapBinding(f.options);
  const init = { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: '{"action":"get"}', cache: 'no-store', redirect: 'error', signal: new AbortController().signal };
  const result = await binding.journal.transport(binding.journal.url, init);
  assert.equal(result.status, 200); assert.strictEqual(f.state.requests[0].init, init); assert.equal(f.state.requests.length, 1);
  const unknown = Error('TASK_JOURNAL_TRANSPORT_TIMEOUT'); let calls = 0;
  f.options.createJournalTransport = () => async () => { calls++; throw unknown; };
  const failed = createWholeReceiptBootstrapBinding(f.options);
  await assert.rejects(failed.journal.transport(failed.journal.url, init), error => error === unknown);
  assert.equal(calls, 1);
});

test('bootstrap freezes routing metadata without inspecting or closing externally owned TLS resources', () => {
  const f = fixture(), binding = createWholeReceiptBootstrapBinding(f.options);
  f.options.journal.url = 'https://changed.example.invalid/internal/v1/nft/operations';
  f.options.journal.peerId = 'spiffe://changed/wallet';
  assert.equal(binding.journal.url, 'https://journal.example.invalid/internal/v1/nft/operations');
  assert.equal(binding.journal.peerId, 'spiffe://fixture/wallet');
  assert.strictEqual(f.state.transportInput.secureContext, f.context);
  assert.equal(Object.hasOwn(binding, 'close'), false);
});

test('bootstrap refuses accessors, symbols, extra fields and asynchronous/invalid factory results without fallback', () => {
  for (const mutate of [o => ({ ...o, extra: true }), o => ({ ...o, [Symbol('hidden')]: true }),
    o => Object.defineProperty({ ...o }, 'journal', { get() { throw Error('must not invoke getter'); } }),
    o => ({ ...o, journal: { ...o.journal, keyFile: '/not-a-transport-capability' } })]) {
    const f = fixture(); assert.throws(() => createWholeReceiptBootstrapBinding(mutate(f.options)), /BINDING_REFUSED/);
    assert.equal(f.state.builds, 0);
  }
  for (const result of [null, {}, Promise.resolve(() => {})]) {
    const f = fixture(); let calls = 0; f.options.createJournalTransport = () => { calls++; return result; };
    assert.throws(() => createWholeReceiptBootstrapBinding(f.options), /BINDING_REFUSED/); assert.equal(calls, 1);
  }
  const f = fixture(), error = Error('TASK_JOURNAL_TRANSPORT_CONFIG_REFUSED');
  f.options.createJournalTransport = () => { throw error; };
  assert.throws(() => createWholeReceiptBootstrapBinding(f.options), value => value === error);
});
