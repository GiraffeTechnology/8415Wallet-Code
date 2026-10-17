/** Server-only receipt composition root. It gives the ArtFi native operation
 * journal the held execution context the receipt path previously lacked, and
 * nothing else: no HTTP route, provider, signer, credential or new grant. The
 * installed authorization semantics are reused exactly as the listing runtime
 * reuses them. */
import { createTaskJournalCapabilities } from './task-journal-capabilities.mjs';
const check = (ok, code = 'TASK_RECEIPT_RUNTIME_CONFIG_REFUSED') => { if (!ok) throw Error(code); };
const authorityKeys = ['withAuthorization', 'withPreparation', 'readState', 'assertIndependentStore'];

/** The authority has already proved every field of `claimed` against the stored
 * grant before the callback runs, so the journal principal is derived from that
 * validated binding rather than from anything the journal supplies itself. */
const journalSnapshot = (snapshot, claimed) => Object.freeze({ ...structuredClone(snapshot),
  grantReference: claimed.grantReference, grantPolicyVersion: claimed.grantPolicyVersion,
  operationId: claimed.operationId });

export function disabledTaskReceiptRuntime(code = 'TASK_RECEIPT_NOT_CONFIGURED') {
  check(/^TASK_RECEIPT_[A-Z0-9_]+$/.test(code));
  return Object.freeze({ state: 'disabled', code, authority: null,
    connectAuthorization() { const error = Error(code); error.status = 503; throw error; },
    inHeldGate: () => false, stop() {},
    withCapability() { const error = Error(code); error.status = 503; throw error; },
    consumeCapability() { const error = Error(code); error.status = 503; throw error; } });
}

export function createTaskReceiptRuntime({ store, journalStore, peerId, consumerPeerId, digest, nativeDigest, now = Date.now } = {}) {
  check(store && journalStore && store !== journalStore, 'TASK_RECEIPT_STORE_REENTRY_REFUSED');
  const capabilities = createTaskJournalCapabilities({ peerId, consumerPeerId, digest, nativeDigest, now });
  let authority = null, connected = false;
  return Object.freeze({
    state: 'configured', code: null,
    get authority() { return authority; },
    connectAuthorization(configured) {
      check(!connected && authorityKeys.every(key => typeof configured?.[key] === 'function'),
        'TASK_RECEIPT_AUTHORIZATION_CONNECTION_REFUSED');
      const independent = configured.assertIndependentStore.bind(configured);
      // The journal must not share the grant store it would re-enter under the
      // held read gate. Refused here, once, at connection time.
      independent(journalStore);
      const gate = configured.withAuthorization.bind(configured), prepare = configured.withPreparation.bind(configured);
      /** Both receipt gates read the grant store. The store serializes every
       * read gate and write on one queue and documents that a callback must not
       * re-enter it, so opening a second gate from inside a held one would wait
       * on a lock its own caller holds and never return. Refused immediately
       * instead, with the reason, rather than left to deadlock. */
      const outermost = () => { if (capabilities.inHeldGate()) {
        const error = Error('TASK_RECEIPT_GATE_REENTRY_REFUSED'); error.status = 500; throw error; } };
      authority = Object.freeze({
        assertIndependentStore: independent,
        readState: configured.readState.bind(configured),
        withPreparation(claimed, purpose, action) {
          outermost();
          return prepare(claimed, purpose, (snapshot, recheck) =>
            capabilities.withHeld(journalSnapshot(snapshot, claimed), recheck, purpose, () => action(snapshot, recheck)));
        },
        /** One send per phase. The gate is opened by the send, never by the
         * journal, so a journal call can never consume a permitted attempt. */
        withAuthorization(claimed, wire, action) {
          outermost();
          return gate(claimed, wire, (snapshot, recheck) =>
            capabilities.withHeld(journalSnapshot(snapshot, claimed), recheck, 'publish', () => action(snapshot, recheck)));
        },
      });
      connected = true;
      return authority;
    },
    inHeldGate: capabilities.inHeldGate,
    /** Unlike the listing journal, this never opens a gate of its own: opening a
     * receipt gate writes a durable attempt and claims the nonce, and the single
     * permitted attempt per phase is not the journal's to spend. */
    withCapability(scope, use) {
      check(connected, 'TASK_RECEIPT_AUTHORIZATION_NOT_CONNECTED');
      if (!capabilities.inHeldGate()) { const error = Error('TASK_RECEIPT_JOURNAL_GATE_REQUIRED'); error.status = 503; throw error; }
      return capabilities.withCapability(scope, use);
    },
    consumeCapability: capabilities.consume,
    stop: capabilities.stop,
  });
}
