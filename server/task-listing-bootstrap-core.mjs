/** Deployment bootstrap from a strict server configuration and private provisioned
 * files. No custody choice, credential creation, module discovery or deployment. */
import { createServer } from 'node:https';
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { validateTaskListingConfig } from './task-listing-config.mjs';
import { createTaskListingRuntime, disabledTaskListingRuntime } from './task-listing-runtime.mjs';
import { TASK_JOURNAL_CAPABILITY_PATH } from './task-journal-capabilities.mjs';
import { readTaskListingPrivateFile, readTaskListingTLS, createTaskListingTransport } from './task-listing-transport.mjs';
import { openEncryptedStore } from './store.mjs';
const check = (ok, code) => { if (!ok) throw Error(code); };
/** Entry wrappers call this before credential state is opened. A configured
 * listing process gets the installed package's required condition automatically. */
export async function ensureTaskListingServerCondition(configuration) {
  if (!configuration?.enabled || process.execArgv.some(arg => arg === '--conditions=react-server' || arg === '-C=react-server')) return;
  const child = spawn(process.execPath, ['--conditions=react-server', ...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: process.env });
  const forward = signal => () => child.kill(signal), handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, forward(signal)]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))); });
  for (const [signal, handler] of handlers) process.off(signal, handler);
  process.exit(code);
}
export function createTaskJournalCapabilityListener(configuration, tls, runtime) {
  const server = createServer({ ...tls, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, async (req, res) => {
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    try {
      const cert = req.socket.getPeerCertificate();
      check(req.socket.authorized && cert.fingerprint256?.replaceAll(':', '').toLowerCase() === configuration.clientFingerprint256 &&
        cert.subjectaltname?.split(', ').includes(`URI:${configuration.peerId}`), 'TASK_LISTING_PEER_REFUSED');
      check(req.method === 'POST' && req.url === TASK_JOURNAL_CAPABILITY_PATH && req.headers['content-type'] === 'application/json' &&
        !req.headers.origin && !req.headers['sec-fetch-site'], 'TASK_LISTING_INTERNAL_ROUTE_REFUSED');
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; check(length <= 16384, 'TASK_LISTING_INTERNAL_BODY_REFUSED'); chunks.push(chunk); }
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = runtime.consumeCapability(request, configuration.peerId);
      res.statusCode = 200; res.end(JSON.stringify(result));
    } catch (error) { res.statusCode = error?.status === 503 ? 503 : 403; res.end(JSON.stringify({ error: 'TASK_JOURNAL_CAPABILITY_REFUSED' })); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.timeout = 5000; server.maxHeadersCount = 20;
  return server;
}
/** The pinned ArtFi factory owns one provider shared by all of its readers.
 * Its native engine instead destroys every provider it obtains. Keep the first
 * factory instance exclusively for observation; give every engine acquisition
 * a fresh instance with the same validated configuration and read-only class.
 * Neither the engine's destroy nor any signing/authorization boundary changes. */
export function createTaskListingDependencyOwner({ modules, configuration, now = Date.now }) {
  check(typeof modules?.validateServerListingConfig === 'function' &&
    typeof modules?.createServerListingDependencies === 'function' &&
    typeof modules?.createNativeNftTaskPort === 'function' && typeof now === 'function',
    'TASK_LISTING_DEPENDENCY_FACTORY_REQUIRED');
  const config = modules.validateServerListingConfig(configuration);
  const create = modules.createServerListingDependencies.bind(modules);
  const createPort = modules.createNativeNftTaskPort.bind(modules), acquisitions = new AsyncLocalStorage();
  const journal = () => { throw Error('TASK_LISTING_JOURNAL_NOT_CONNECTED'); };
  const make = () => create(config, { journal, now });
  const base = make(), native = base.nativeDependencies;
  const validateScope = native.provider.bind(native);
  // The public factory exposes its owned provider through a validated scope;
  // this is a construction-only lookup and does not make an RPC request.
  const observerProvider = validateScope(native.scope(config.collections[0].slug));
  const request = base.observationDependencies.readOnlyProvider.request.bind(base.observationDependencies.readOnlyProvider);
  let closed = false;
  const active = () => check(!closed, 'TASK_LISTING_DEPENDENCIES_CLOSED');
  const readOnlyProvider = Object.freeze({ sourceId: base.observationDependencies.readOnlyProvider.sourceId,
    async request(input) { active(); return request(input); } });
  return Object.freeze({
    nativeDependencies: Object.freeze({ ...native,
      provider(value) {
        active();
        const acquisition = acquisitions.getStore();
        check(acquisition?.active === true, 'TASK_LISTING_PROVIDER_SCOPE_REQUIRED');
        // Refuse an altered scope before allocating another provider. Pass the
        // factory's immutable canonical scope to the fresh instance afterwards.
        validateScope(value);
        const scope = native.scope(value.slug);
        const provider = make().nativeDependencies.provider(scope);
        acquisition.providers.add(provider);
        return provider;
      },
    }),
    observationDependencies: Object.freeze({ ...base.observationDependencies, readOnlyProvider }),
    canonicalReader: readOnlyProvider,
    createNativeNftTaskPort(input) {
      active();
      const port = createPort(input);
      return Object.freeze(Object.fromEntries(['prepareListing', 'reviewListing', 'publishListing', 'readPublication'].map(name => {
        check(typeof port?.[name] === 'function', 'TASK_LISTING_NATIVE_PORT_REQUIRED');
        const call = port[name].bind(port);
        return [name, async (...args) => {
          active();
          const acquisition = { active: true, providers: new Set() };
          return acquisitions.run(acquisition, async () => {
            try { return await call(...args); }
            finally {
              // The pinned engine can throw while constructing its SDK before
              // entering its own try/finally. Close that invocation's leftovers
              // too, without re-destroying resources the engine already closed.
              acquisition.active = false;
              let cleanupFailed = false;
              for (const provider of acquisition.providers) {
                try { if (!provider.destroyed) provider.destroy(); }
                catch { cleanupFailed = true; }
              }
              acquisition.providers.clear();
              check(!cleanupFailed, 'TASK_LISTING_PROVIDER_CLEANUP_FAILED');
            }
          });
        }];
      })));
    },
    async close() {
      if (closed) return;
      closed = true;
      // Acquired native providers remain owned by the engine's existing finally.
      // Closing observation must not tear down a concurrent native operation.
      observerProvider.destroy();
    },
  });
}
export async function bootstrapTaskListingRuntimeCore({ configuration = null, store, authStatePath, now = Date.now } = {}, { loadInstalledTaskListingModules }) {
  const owned = [], ownedKeys = [], disabled = code => ({ runtime: disabledTaskListingRuntime(code), async start() {}, async stop() {} });
  if (configuration === null || configuration === undefined || configuration.enabled === false) {
    validateTaskListingConfig(configuration); return disabled('TASK_LISTING_NOT_CONFIGURED');
  }
  let server = null, runtime = null;
  async function closeOwned() {
    const closed = await Promise.allSettled(owned.map(item => item.close()));
    for (const key of ownedKeys) key.fill(0);
    if (closed.some(result => result.status === 'rejected')) throw Error('TASK_LISTING_CLEANUP_FAILED');
  }
  try {
    const c = validateTaskListingConfig(configuration);
    check(c.stores.bridge.path !== authStatePath && c.stores.observation.path !== authStatePath, 'TASK_LISTING_STORE_REENTRY_REFUSED');
    const m = await loadInstalledTaskListingModules();
    m.validateServerListingConfig(c.artfi);
    const [peerTLS, listenerTLS, signerTLS, quoteTLS, requestTLS] = await Promise.all([c.peer.tls, c.peer.capabilityListener,
      c.gateways.signer.tls, c.gateways.quote.tls, c.gateways.request.tls].map(readTaskListingTLS));
    const stores = {};
    for (const name of ['bridge', 'observation']) {
      const bytes = await readTaskListingPrivateFile(c.stores[name].keyFile, 66); let key;
      try { const text = bytes.toString('utf8').trim(); check(/^[a-fA-F0-9]{64}$/.test(text), 'TASK_LISTING_STORE_KEY_REFUSED'); key = Buffer.from(text, 'hex');
        stores[name] = await openEncryptedStore(c.stores[name].path, key); owned.push(stores[name]); ownedKeys.push(key); key = null; }
      finally { bytes.fill(0); key?.fill(0); }
    }
    const peerTransport = createTaskListingTransport({ url: c.peer.journalUrl, tls: peerTLS,
      serverFingerprint256: c.peer.tls.serverFingerprint256, timeoutMs: 10000 });
    const gateway = (name, tls) => {
      const config = c.gateways[name], transport = createTaskListingTransport({ url: config.url, tls, serverFingerprint256: config.tls.serverFingerprint256, timeoutMs: config.timeoutMs });
      return async (body, options = {}) => { const response = await transport(config.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: options.signal }); check(response.status === 200, 'TASK_LISTING_GATEWAY_REFUSED'); return response.json(); };
    };
    const sign = gateway('signer', signerTLS), quote = gateway('quote', quoteTLS), request = gateway('request', requestTLS);
    const native = createTaskListingDependencyOwner({ modules: m, configuration: c.artfi, now });
    owned.push(native);
    runtime = createTaskListingRuntime({ store, now, serverConfiguration: {
      modules: { ...m, createNativeNftTaskPort: native.createNativeNftTaskPort }, bridgeStore: stores.bridge, observationStore: stores.observation,
      ...native, executor: c.executor, observationPolicy: c.observationPolicy,
      configurationDigest: m.nftTaskJournalDigest({ artfi: c.artfi, observationPolicy: c.observationPolicy,
        peers: [c.peer.tls.serverFingerprint256, c.peer.capabilityListener.clientFingerprint256],
        gateways: Object.fromEntries(Object.entries(c.gateways).map(([key, g]) => [key, { url: g.url, peer: g.tls.serverFingerprint256, timeoutMs: g.timeoutMs }])) }),
      consumerPeerId: c.peer.capabilityListener.peerId, peerJournal: { url: c.peer.journalUrl, peerId: c.peer.id, transport: peerTransport },
      signerMetadata: { protocol: c.gateways.signer.protocol, capabilityId: c.gateways.signer.capabilityId, version: c.gateways.signer.version },
      signerTimeoutMs: c.gateways.signer.timeoutMs,
      signer: { async signTypedData(exactRequest, options) { const result = await sign({ schema: '8415-sign-only-http/1', capabilityId: c.gateways.signer.capabilityId,
        capabilityVersion: c.gateways.signer.version, request: exactRequest }, options);
        check(result?.schema === '8415-sign-only-result/1' && result.typedDataDigest === exactRequest.typedDataDigest &&
          typeof result.signature === 'string' && Object.keys(result).sort().join() === 'schema,signature,typedDataDigest', 'TASK_LISTING_SIGNER_RESPONSE_REFUSED'); return result.signature; } },
      quoteSource: policy => quote({ schema: '8415-listing-quote-request/1', valuationPolicy: policy }),
      requestSource: task => request({ schema: '8415-listing-native-request/1', task }),
    } });
    server = createTaskJournalCapabilityListener(c.peer.capabilityListener, listenerTLS, runtime);
    let started = false, stopPromise = null;
    return { runtime,
      async start() { check(!started, 'TASK_LISTING_LISTENER_ALREADY_STARTED'); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(c.peer.capabilityListener.port, c.peer.capabilityListener.host, () => { server.off('error', reject); resolve(); }); }); started = true; },
      async stop() {
        if (stopPromise) return stopPromise;
        stopPromise = (async () => { runtime.stop(); if (started) await new Promise(resolve => server.close(resolve)); await closeOwned(); })();
        return stopPromise;
      },
    };
  } catch (error) {
    runtime?.stop(); try { await closeOwned(); } catch { return disabled('TASK_LISTING_CLEANUP_FAILED'); }
    return disabled(/^TASK_LISTING_[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'TASK_LISTING_DEPENDENCIES_UNAVAILABLE');
  }
}
