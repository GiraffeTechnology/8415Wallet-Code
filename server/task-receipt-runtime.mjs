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
  let authority = null, connected = false, stopped = false, pendingSends = 0, principalSnapshot = null;
  const active = () => { if (stopped) {
    const error = Error('TASK_RECEIPT_RUNTIME_STOPPED'); error.status = 503; throw error; } };
  return Object.freeze({
    state: 'configured', code: null,
    get authority() { return authority; },
    connectPrincipalAuthorization(original) {
      active();
      check(connected && principalSnapshot === null && typeof original?.withPurposeJournalSnapshot === 'function',
        'TASK_RECEIPT_PRINCIPAL_CONNECTION_REFUSED');
      principalSnapshot=original.withPurposeJournalSnapshot.bind(original);
    },
    /** Only the original already-held principal guard can admit this read. The
     * existing registry and consume endpoint retain peer/native/request/TTL
     * checks. Never expose a raw withHeld accepting caller-supplied snapshots. */
    async withPrincipalJournalCapability(purpose, originalGuard, scope, use) {
      active();check(connected && principalSnapshot !== null,'TASK_RECEIPT_PRINCIPAL_NOT_CONNECTED');
      const action=Object.getOwnPropertyDescriptor(scope??{},'action');
      check(action && Object.hasOwn(action,'value') && action.value==='get' && typeof use==='function',
        'TASK_RECEIPT_PRINCIPAL_READ_ONLY');
      check(!capabilities.inHeldGate(),'TASK_RECEIPT_GATE_REENTRY_REFUSED');
      return principalSnapshot(purpose,originalGuard,(snapshot,recheck)=>{
        const liveRecheck=()=>{active();return recheck();};
        return capabilities.withHeld(snapshot,liveRecheck,'observe',()=>capabilities.withCapability(scope,use));
      });
    },
    connectAuthorization(configured) {
      active();
      check(!connected && authorityKeys.every(key => typeof configured?.[key] === 'function'),
        'TASK_RECEIPT_AUTHORIZATION_CONNECTION_REFUSED');
      const independent = configured.assertIndependentStore.bind(configured);
      // The journal must not share the grant store it would re-enter under the
      // held read gate. Refused here, once, at connection time.
      independent(journalStore);
      const gate = configured.withAuthorization.bind(configured), prepare = configured.withPreparation.bind(configured);
      const readState = configured.readState.bind(configured);
      /** All receipt reads and gates read the grant store. The store serializes every
       * read gate and write on one queue and documents that a callback must not
       * re-enter it, so opening a second gate from inside a held one would wait
       * on a lock its own caller holds and never return. Refused immediately
       * instead, with the reason, rather than left to deadlock. */
      // Refuse before entering the authority: opening a send gate durably
      // consumes its phase and nonce even when its action subsequently fails.
      const outermost = () => { active(); if (capabilities.inHeldGate()) {
        const error = Error('TASK_RECEIPT_GATE_REENTRY_REFUSED'); error.status = 500; throw error; } };
      authority = Object.freeze({
        assertIndependentStore: independent,
        readState(claimed) {
          outermost();
          return readState(claimed);
        },
        withPreparation(rawClaimed, purpose, action) {
          outermost();
          // Detach before the authority's first await. The same immutable
          // binding must be validated and later used for the journal principal.
          const claimed = Object.freeze(structuredClone(rawClaimed));
          return prepare(claimed, purpose, (snapshot, recheck) => {
            // Preparation never reserves a send. Its capabilities must stop
            // immediately, even while an unrelated reserved send is draining.
            const liveRecheck = () => { active(); return recheck(); };
            return capabilities.withHeld(journalSnapshot(snapshot, claimed), liveRecheck, purpose, () => action(snapshot, liveRecheck));
          });
        },
        /** One send per phase. The gate is opened by the send, never by the
         * journal, so a journal call can never consume a permitted attempt. */
        withAuthorization(rawClaimed, wire, action) {
          outermost();
          const claimed = Object.freeze(structuredClone(rawClaimed));
          pendingSends++;
          const finish = () => { pendingSends--; if (stopped && pendingSends === 0) capabilities.stop(); };
          try {
            return Promise.resolve(gate(claimed, wire, (snapshot, recheck) =>
              capabilities.withHeld(journalSnapshot(snapshot, claimed), recheck, 'publish', () => action(snapshot, recheck)), active)).finally(finish);
          } catch (error) { finish(); throw error; }
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
    // Stop is not revocation of an accepted reservation. The synchronous fence
    // inside the store updater is the cutoff; persistence may still be running.
    // Queued calls fail that fence. Accepted calls retain their journal until
    // they settle, avoiding a shutdown-induced unknown outcome before dispatch.
    stop() { stopped = true; if (pendingSends === 0) capabilities.stop(); },
  });
}
