/** Server-owned ArtFi installation binding. No loader, listener or resource ownership. */
import { createTaskReceiptRuntime } from './task-receipt-runtime.mjs';
import { createReceiptProviderHandler } from './receipt-provider-handler.mjs';
import { createTaskJournalCapabilityHandler } from './task-listing-bootstrap-core.mjs';

const refuse = () => { throw Error('WHOLE_RECEIPT_HOST_BINDING_REFUSED'); };
function fields(value, keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key =>
    !Object.hasOwn(descriptors[key] ?? {}, 'value') || !descriptors[key].enumerable)) refuse();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

/** The original bootstrap imports both factories through its existing module
 * route. This composition passes the host's existing opaque TLS context only
 * to the transport factory; it never reads key material or creates a listener. */
export function createWholeReceiptBootstrapBinding(raw) {
  const input = fields(raw, ['createInstallation', 'createJournalTransport', 'journalStore',
    'consumerPeerId', 'taskExecutorIdentity', 'provider', 'journal']);
  const journal = fields(input.journal, ['url', 'peerId', 'secureContext']);
  if (typeof input.createInstallation !== 'function' || typeof input.createJournalTransport !== 'function' ||
      typeof journal.url !== 'string' || typeof journal.peerId !== 'string' ||
      !journal.secureContext || typeof journal.secureContext !== 'object') refuse();
  const transport = input.createJournalTransport({ url: journal.url, secureContext: journal.secureContext });
  if (typeof transport !== 'function') refuse();
  return Object.freeze({ createInstallation: input.createInstallation, journalStore: input.journalStore,
    consumerPeerId: input.consumerPeerId, taskExecutorIdentity: input.taskExecutorIdentity, provider: input.provider,
    journal: Object.freeze({ url: journal.url, peerId: journal.peerId, transport }) });
}

/** The existing ArtFi bootstrap supplies its factory and original provider/journal
 * capabilities. The original auth host supplies its own credential store. */
export function createWholeReceiptHost({ binding, store, now = Date.now, receiptTaskContentContext = null }) {
  if (binding === null) return null;
  const input = fields(binding, ['createInstallation', 'journalStore', 'consumerPeerId',
    'taskExecutorIdentity', 'provider', 'journal']);
  if (typeof input.createInstallation !== 'function' || typeof now !== 'function' ||
      !store || !input.journalStore || store === input.journalStore) refuse();
  const installation = input.createInstallation({ createTaskReceiptRuntime, createProviderHandler: receiptTaskContentContext === null ? createReceiptProviderHandler :
      options => createReceiptProviderHandler({...options,receiptTaskContentContext}),
    store, journalStore: input.journalStore, consumerPeerId: input.consumerPeerId,
    taskExecutorIdentity: input.taskExecutorIdentity, provider: input.provider, journal: input.journal, now });
  const api = fields(installation, ['authOptions', 'connectAuthorization', 'consumeCapability', 'operation', 'stop']);
  if (!Object.isFrozen(installation) || ['connectAuthorization', 'consumeCapability', 'operation', 'stop']
    .some(key => typeof api[key] !== 'function')) refuse();
  let attempted = false, connected = false, connectionFailed = false, closing = false, stopPromise = null;
  const pending = new Set();
  function active() {
    if (!connected || closing) throw Error('WHOLE_RECEIPT_HOST_NOT_ACCEPTING');
  }
  function track(action) {
    active();
    // Invoke immediately: do not move authority checks/reservations to another turn.
    const result = action();
    const accepted = Promise.resolve(result).then(value => { pending.delete(accepted); return value; },
      error => { pending.delete(accepted); throw error; });
    pending.add(accepted);
    return accepted;
  }
  return Object.freeze({
    authOptions: api.authOptions,
    connectAuthorization(authority) {
      if (attempted || closing) throw Error('WHOLE_RECEIPT_HOST_CONNECTION_REFUSED');
      attempted = true;
      // Pass the original four-method authority unchanged. The factory owns
      // connection failure cleanup and its one-attempt runtime semantics.
      try { api.connectAuthorization.call(installation, authority); }
      catch (error) { connectionFailed = true; throw error; }
      connected = true;
    },
    consumeCapability(...args) {
      // An already accepted operation may need its journal capability while
      // shutdown waits for the durable result. Never add an HTTP/bearer bridge.
      return api.consumeCapability.apply(installation, args);
    },
    createCapabilityRequestHandler(configuration) {
      active();
      const peer = Object.getOwnPropertyDescriptor(configuration ?? {}, 'peerId');
      if (!peer || !Object.hasOwn(peer, 'value') || peer.value !== input.consumerPeerId) refuse();
      // The original bootstrap mounts this on its existing authenticated TLS
      // listener, with one explicit registry owner. No listener or route is added.
      return createTaskJournalCapabilityHandler(configuration, installation);
    },
    operation(input) {
      active();
      const operation = api.operation.call(installation, input);
      const methods = fields(operation, ['operationId', 'create', 'read', 'execute']);
      if (['create', 'read', 'execute'].some(key => typeof methods[key] !== 'function')) refuse();
      return Object.freeze({ operationId: methods.operationId,
        create: (...args) => track(() => methods.create.apply(operation, args)),
        read: (...args) => track(() => methods.read.apply(operation, args)),
        execute: (...args) => track(() => methods.execute.apply(operation, args)) });
    },
    stop() {
      if (stopPromise) return stopPromise;
      closing = true;
      stopPromise = (async () => {
        // stop() on the installation is synchronous and is not a drain. Keep
        // its gates alive until accepted create/read/execute result writes end.
        while (pending.size) await Promise.allSettled([...pending]);
        // The original factory owns failed-connection cleanup, including its
        // refusal to stop an unexpected runtime owned by another installation.
        if (!connectionFailed) api.stop.call(installation);
      })();
      return stopPromise;
    }
  });
}
