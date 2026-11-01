/** Contract/lifecycle fixtures only; no native journal, provider RPC or chain acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWholeReceiptHost } from '../server/whole-receipt-host.mjs';
import { createTaskReceiptRuntime } from '../server/task-receipt-runtime.mjs';
import { createReceiptProviderHandler } from '../server/receipt-provider-handler.mjs';
import { createAuthRuntime } from '../server/main.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { disabledTaskListingRuntime } from '../server/task-listing-runtime.mjs';
import { get } from 'node:http';

const identity = Object.freeze({ schema: '8415-task-executor/1', agentId: 'fixture:artfi', agentVersion: '1',
  adapterId: 'artfi:whole-receipt:v1', adapterVersion: '1', implementationDigest: '0x' + '7'.repeat(64) });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const events = [], store = new MemoryCredentialStore(), journalStore = { close() { throw Error('host must not close journal'); } };
  let supplied, authority, receiptRuntime;
  const binding = { createInstallation(input) {
    supplied = input;
    receiptRuntime = input.createTaskReceiptRuntime({ store: input.store, journalStore: input.journalStore,
      peerId: input.journal.peerId, consumerPeerId: input.consumerPeerId, digest: () => '1'.repeat(64),
      nativeDigest: () => '2'.repeat(64), now: input.now });
    return Object.freeze({ authOptions: Object.freeze({ taskReceiptHandlerId: 'artfi:whole-receipt:v1', taskExecutorIdentity: identity }),
      connectAuthorization(value) { authority = value; events.push('connect'); receiptRuntime.connectAuthorization(value); },
      ...(overrides.principal?{connectPrincipalAuthorization(value){events.push('principal-connect');receiptRuntime.connectPrincipalAuthorization(value);}}:{}),
      consumeCapability(...args) { events.push(['consume', ...args]); return overrides.consume?.(...args) ?? 'consumed'; },
      operation(input) { events.push(['operation', input]); return { operationId: 'fixture:operation',
        create(...args) { return overrides.create?.(...args) ?? Promise.resolve('created'); },
        read(...args) { return overrides.read?.(...args) ?? Promise.resolve('read'); },
        execute(...args) { return overrides.execute?.(...args) ?? Promise.resolve('executed'); } }; },
      stop() { events.push('installation-stop'); receiptRuntime.stop(); } });
  }, journalStore, consumerPeerId: 'spiffe://fixture/consumer', taskExecutorIdentity: identity,
  provider: { request() { throw Error('no RPC in fixture'); } },
  journal: { url: 'https://journal.example.invalid/internal/v1/nft/operations', peerId: 'spiffe://fixture/wallet',
    transport() { throw Error('no network in fixture'); } } };
  const standaloneAuthority = { withPreparation() {}, withAuthorization() {}, readState() {},
    assertIndependentStore(other) { assert.strictEqual(other, journalStore); } };
  return { binding, store, events, standaloneAuthority, get supplied() { return supplied; }, get authority() { return authority; },
    get receiptRuntime() { return receiptRuntime; } };
}
const config = () => ({ origin: 'https://wallet.example.invalid', tenant: 'fixture', port: 31999,
  statePath: '/fixture/credentials.enc', accounts: [{ username: 'tester', wallets: [{ account: '0x' + '1'.repeat(40), chainId: '560048' }] }] });
const listing = () => ({ runtime: disabledTaskListingRuntime(), async start() {}, async stop() {} });

test('standard host connects an explicitly supporting installation to its original principal snapshot port',async()=>{
 const f=fixture({principal:true}),runtime=await createAuthRuntime({config:config(),store:f.store,listingRuntime:listing(),wholeReceipt:f.binding});
 try{assert.equal(f.events.filter(x=>x==='principal-connect').length,1);
  assert.throws(()=>runtime.wholeReceipt.connectPrincipalAuthorization(runtime.handler.receiptPrincipalAuthorization),/PRINCIPAL_CONNECTION_REFUSED/);
 }finally{await runtime.stop();await f.store.close();}
});

test('original Wallet factories, stores and complete bootstrap capabilities reach the installation unchanged', async () => {
  const f = fixture(), now = () => 1800000000000;
  const host = createWholeReceiptHost({ binding: f.binding, store: f.store, now });
  assert.strictEqual(f.supplied.createTaskReceiptRuntime, createTaskReceiptRuntime);
  assert.strictEqual(f.supplied.createProviderHandler, createReceiptProviderHandler);
  for (const key of ['journalStore', 'consumerPeerId', 'taskExecutorIdentity', 'provider', 'journal']) assert.strictEqual(f.supplied[key], f.binding[key]);
  assert.strictEqual(f.supplied.store, f.store); assert.strictEqual(f.supplied.now, now);
  host.connectAuthorization(f.standaloneAuthority);
  assert.strictEqual(f.authority, f.standaloneAuthority);
  assert.throws(() => host.connectAuthorization(f.standaloneAuthority), /CONNECTION_REFUSED/);
  await host.stop();
});

test('runtime entry connects its original four-method receipt authority and leaves default binding absent', async () => {
  const f = fixture(), runtime = await createAuthRuntime({ config: config(), store: f.store, listingRuntime: listing(), wholeReceipt: f.binding });
  assert.strictEqual(f.authority, runtime.handler.taskReceiptAuthorization);
  for (const key of ['withPreparation', 'withAuthorization', 'readState', 'assertIndependentStore']) assert.equal(typeof f.authority[key], 'function');
  assert.notEqual(f.receiptRuntime.authority, null);
  await runtime.stop();
  const plain = await createAuthRuntime({ config: config(), store: new MemoryCredentialStore(), listingRuntime: listing() });
  assert.equal(plain.wholeReceipt, null); await plain.stop();
});

for (const method of ['create', 'read', 'execute']) test(`shutdown fences new ${method} calls but drains accepted result recording`, async () => {
  const gate = deferred(), f = fixture({ [method]: async value => {
    f.events.push('accepted'); await gate.promise;
    assert.equal(f.events.includes('installation-stop'), false);
    f.events.push('durable-result'); return value;
  } });
  const host = createWholeReceiptHost({ binding: f.binding, store: f.store }); host.connectAuthorization(f.standaloneAuthority);
  const input = { task: { policy: {}, digest: 'fixture:digest' }, claimed: { operationId: 'fixture:operation', phase: 'funded' } };
  const operation = host.operation(input); assert.strictEqual(f.events[1][1], input);
  const accepted = operation[method]('result'); const stopping = host.stop();
  assert.strictEqual(host.stop(), stopping); assert.throws(() => operation[method](), /NOT_ACCEPTING/);
  assert.throws(() => host.operation(input), /NOT_ACCEPTING/);
  assert.equal(host.consumeCapability('request', 'spiffe://fixture/consumer'), 'consumed');
  await Promise.resolve(); assert.equal(f.events.includes('installation-stop'), false);
  gate.resolve(); assert.equal(await accepted, 'result'); await stopping;
  assert.ok(f.events.indexOf('durable-result') < f.events.indexOf('installation-stop'));
});

test('host stop waits for unknown outcome rejection without replay, cancellation or successful result fabrication', async () => {
  const gate = deferred(); let calls = 0;
  const f = fixture({ execute() { calls++; return gate.promise; } }), host = createWholeReceiptHost({ binding: f.binding, store: f.store });
  host.connectAuthorization(f.standaloneAuthority);
  const accepted = host.operation({}).execute(); const rejected = assert.rejects(accepted, /UNKNOWN/); const stopping = host.stop();
  gate.reject(Error('UNKNOWN')); await rejected; await stopping; assert.equal(calls, 1);
});

test('runtime stop drains receipt writes before its caller closes the original store or transport', async () => {
  const gate = deferred(), events = [];
  const f = fixture({ execute: async () => { await gate.promise; events.push('recorded'); } });
  const l = listing(); l.stop = async () => { events.push('listing-stop'); };
  const runtime = await createAuthRuntime({ config: config(), store: f.store, listingRuntime: l, wholeReceipt: f.binding });
  const accepted = runtime.wholeReceipt.operation({}).execute();
  const stopping = (async () => { await runtime.stop(); events.push('store-close'); events.push('transport-close'); })();
  await Promise.resolve(); assert.deepEqual(events, []);
  gate.resolve(); await accepted; await stopping;
  assert.deepEqual(events, ['recorded', 'listing-stop', 'store-close', 'transport-close']);
});

test('an accepted HTTP response and receipt result both drain before outer resource closure', async () => {
  const release = deferred(), arrived = deferred(), events = [];
  const f = fixture({ execute: async () => { await release.promise; events.push('receipt-recorded'); } });
  const runtime = await createAuthRuntime({ config: config(), store: f.store, listingRuntime: listing(), wholeReceipt: f.binding });
  // Hold an ordinary response until its accepted fixture operation has recorded
  // its result. This tests the real HTTP close/drain boundary without adding a
  // receipt HTTP endpoint, authenticating a synthetic user or calling a provider.
  runtime.server.prependListener('request', (_request, response) => {
    const accepted = runtime.wholeReceipt.operation({}).execute();
    const end = response.end;
    response.end = function (...args) {
      accepted.then(() => { events.push('response-ended'); end.apply(this, args); }, error => this.destroy(error));
      return this;
    };
    arrived.resolve();
  });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const response = new Promise((resolve, reject) => {
    const request = get({ host: '127.0.0.1', port: runtime.server.address().port, path: '/auth/bootstrap',
      agent: false, headers: { host: 'wallet.example.invalid', 'x-wallet-tenant': 'fixture' } }, result => {
      result.resume(); result.once('end', () => resolve(result.statusCode)); result.once('error', reject);
    }); request.once('error', reject);
  });
  await arrived.promise;
  const stopping = runtime.stop().then(() => { events.push('store-close'); events.push('transport-close'); });
  assert.equal(runtime.server.listening, false, 'listener admission closes before either drain finishes');
  assert.throws(() => runtime.wholeReceipt.operation({}), /NOT_ACCEPTING/);
  await Promise.resolve(); assert.deepEqual(events, []);
  release.resolve(); assert.equal(await response, 200); await stopping;
  assert.deepEqual(events, ['receipt-recorded', 'response-ended', 'store-close', 'transport-close']);
});

test('binding refuses accessors, symbols, extra fields and reentrant journal before calling a factory', () => {
  const f = fixture(); let getters = 0;
  for (const binding of [{ ...f.binding, extra: 1 }, { ...f.binding, [Symbol('extra')]: 1 },
    { ...f.binding, journalStore: f.store }, Object.defineProperty({ ...f.binding }, 'journal', { get() { getters++; throw Error('getter'); } })])
    assert.throws(() => createWholeReceiptHost({ binding, store: f.store }), /BINDING_REFUSED/);
  assert.equal(getters, 0); assert.equal(f.supplied, undefined);
});

test('failed connection consumes attempt without adding cleanup of another factory-owned runtime', async () => {
  let connections = 0, stops = 0; const f = fixture();
  f.binding.createInstallation = () => Object.freeze({ authOptions: {}, connectAuthorization() { connections++; throw Error('SHARED_RUNTIME_REFUSED'); },
    consumeCapability() {}, operation() {}, stop() { stops++; } });
  const host = createWholeReceiptHost({ binding: f.binding, store: f.store });
  assert.throws(() => host.connectAuthorization(f.standaloneAuthority), /SHARED_RUNTIME_REFUSED/);
  assert.throws(() => host.connectAuthorization(f.standaloneAuthority), /CONNECTION_REFUSED/);
  await host.stop(); assert.equal(connections, 1); assert.equal(stops, 0);
});
