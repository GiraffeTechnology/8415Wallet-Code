/** Reusable server-only composition root. This function receives already installed
 * code and server-owned capabilities, never request JSON or browser factories. */
import { createHash } from 'node:crypto';
import { createTaskNativeListingComposition } from './task-native-listing-composition.mjs';
import { createTaskListingResults } from './task-listing-results.mjs';
import { createTaskJournalCapabilities } from './task-journal-capabilities.mjs';
const check = (ok, code = 'TASK_LISTING_RUNTIME_CONFIG_REFUSED') => { if (!ok) throw Error(code); };
const clone = value => structuredClone(value);
export const TASK_LISTING_ARTFI_INTERFACE = Object.freeze({ schema: 'artfi-task-listing-runtime/1', packageName: '@artfi/task-listing-runtime',
  packageVersion: '1.0.0', walletInterface: '8415-task-listing-runtime/1', entry: './server.mjs' });
export function disabledTaskListingRuntime(code = 'TASK_LISTING_NOT_CONFIGURED') {
  check(/^TASK_LISTING_[A-Z0-9_]+$/.test(code));
  return Object.freeze({ state: 'disabled', code, authOptions: Object.freeze({ taskListingExecution: null, taskListingResults: null,
    taskListingRuntimeStatus: Object.freeze({ state: 'disabled', code }) }),
    connectAuthorization() {}, stop() {}, consumeCapability() { const error = Error(code); error.status = 503; throw error; } });
}
export function createTaskListingRuntime({ store, serverConfiguration = null, now = Date.now } = {}) {
  if (serverConfiguration === null) return disabledTaskListingRuntime();
  const c = serverConfiguration, m = c.modules;
  check(store && typeof store.withReadGate === 'function' && c.bridgeStore && c.observationStore &&
    new Set([store, c.bridgeStore, c.observationStore]).size === 3, 'TASK_LISTING_STORE_REENTRY_REFUSED');
  check(m && Object.entries(TASK_LISTING_ARTFI_INTERFACE).every(([key, value]) => m.runtimeManifest?.[key] === value), 'TASK_LISTING_ARTFI_INTERFACE_REFUSED');
  check(['createNativeNftTaskPort', 'createNftSaleTermsVerifier', 'readNftRequest', 'kernelRequestDigest',
    'createListedOrderObserver', 'createNftTaskJournal', 'nftTaskJournalDigest'].every(key => typeof m[key] === 'function'));
  check(c.nativeDependencies && c.observationDependencies && c.canonicalReader && c.signer &&
    typeof c.signer.signTypedData === 'function' && typeof c.quoteSource === 'function' && typeof c.requestSource === 'function' &&
    typeof c.peerJournal?.transport === 'function' && typeof c.consumerPeerId === 'string' && typeof c.executor?.agentId === 'string' && typeof c.executor?.agentVersion === 'string');
  check(/^[a-f0-9]{64}$/.test(c.configurationDigest ?? ''));
  check(c.signerMetadata?.protocol === '8415-sign-only-http/1' && typeof c.signerMetadata.capabilityId === 'string' && typeof c.signerMetadata.version === 'string');
  // A change to installed code, signer capability/version, authenticated peer or
  // reviewed native/observer policy creates another executor approval digest.
  const implementationDigest = `0x${createHash('sha256').update(m.nftTaskJournalDigest({ manifest: m.runtimeManifest,
    signer: c.signerMetadata, peer: { id: c.peerJournal.peerId, consumerPeerId: c.consumerPeerId, url: c.peerJournal.url }, configurationDigest: c.configurationDigest })).digest('hex')}`;
  const executorIdentity = { schema: '8415-task-executor/1', agentId: c.executor.agentId, agentVersion: c.executor.agentVersion,
    adapterId: 'artfi:seaport', adapterVersion: m.runtimeManifest.packageVersion, implementationDigest };
  const capabilities = createTaskJournalCapabilities({ peerId: c.peerJournal.peerId, consumerPeerId: c.consumerPeerId, digest: m.nftTaskJournalDigest, nativeDigest: m.kernelRequestDigest, now });
  let authority = null, connected = false;
  const journal = m.createNftTaskJournal({ ...c.peerJournal, now,
    withCapability(scope, use) {
      check(connected && authority, 'TASK_LISTING_AUTHORIZATION_NOT_CONNECTED');
      const call = () => capabilities.withCapability(scope, use);
      if (capabilities.inHeldGate()) return call();
      const binding = clone(scope.principal); delete binding.kind;
      return authority.withAuthorization(binding, scope.action === 'create' ? 'prepare' : 'observe', call);
    } });
  const composition = createTaskNativeListingComposition({ bridgeStore: c.bridgeStore,
    createNativeNftTaskPort: m.createNativeNftTaskPort, nativeDependencies: { ...c.nativeDependencies, journal },
    createNftSaleTermsVerifier: m.createNftSaleTermsVerifier, ethers: m.ethers, validation: m.validation,
    readNftRequest: m.readNftRequest, kernelRequestDigest: m.kernelRequestDigest,
    signer: c.signer, signerTimeoutMs: c.signerTimeoutMs, quoteSource: c.quoteSource, requestSource: c.requestSource,
    createListedOrderObserver: m.createListedOrderObserver, observationDependencies: c.observationDependencies, now });
  const results = createTaskListingResults({ store: c.observationStore, observationSource: composition.observation.bind(composition),
    canonicalReader: c.canonicalReader, observationPolicyId: c.observationDependencies.policyId, now });
  return Object.freeze({ state: 'configured', code: null,
    authOptions: Object.freeze({ taskListingExecution: composition.execution, taskListingResults: results, taskExecutorIdentity: executorIdentity,
      taskObservationPolicy: clone(c.observationPolicy), taskListingRuntimeStatus: Object.freeze({ state: 'configured', code: null }) }),
    connectAuthorization(configured) {
      check(!connected && ['inspect', 'withAuthorization', 'assertIndependentStore'].every(key => typeof configured?.[key] === 'function'), 'TASK_LISTING_AUTHORIZATION_CONNECTION_REFUSED');
      const inspect = configured.inspect.bind(configured), gate = configured.withAuthorization.bind(configured), independent = configured.assertIndependentStore.bind(configured);
      independent(c.bridgeStore); independent(c.observationStore);
      authority = Object.freeze({ inspect, assertIndependentStore: independent,
        withAuthorization(binding, purpose, action) {
          return gate(binding, purpose, (snapshot, recheck) => capabilities.withHeld(snapshot, recheck, purpose, () => action(snapshot, recheck)));
        } });
      composition.connectListingAuthorization(authority); connected = true;
    },
    consumeCapability: capabilities.consume, stop: capabilities.stop,
  });
}
