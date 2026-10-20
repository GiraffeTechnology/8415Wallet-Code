/** Authenticated owner-policy presentation bridge. Pending references carry no
 * authority or factors. Reload only reads/reconciles; it never repeats a save. */
import { runTaskVerificationPolicyChange } from './task-verification-policy-ceremony.mjs';
import { validateTaskVerificationPolicyView } from './task-verification-policy-ui.mjs';
import { createTaskVerificationPolicyWire, taskPolicyChangeQuery } from './task-verification-policy-wire.mjs';
import { createTaskPolicyPendingStore, taskPolicyPendingReference } from './task-verification-policy-pending.mjs';
const refused = code => Object.assign(new Error(code), { code });
export function createTaskVerificationPolicyClient({ client, walletLogin, document, window,
  wire = createTaskVerificationPolicyWire({ crypto: window?.crypto ?? globalThis.crypto }) }) {
  if (!wire || !['status', 'prepared', 'verified', 'committed'].every(name => typeof wire[name] === 'function')) return null;
  let store = null;
  try { store = createTaskPolicyPendingStore({ storage: window?.sessionStorage }); } catch { /* Reading stays available. */ }
  let changing = false;
  function current(binding, signal) {
    if (signal?.aborted) throw refused('TASK_POLICY_CHANGE_CANCELLED');
    return walletLogin.assert(binding);
  }
  async function currentAccount(binding, signal) {
    const account = await client.account(); current(binding, signal);
    if (account?.taskHumanVerification === null || account?.taskHumanVerification === undefined)
      throw refused('TASK_POLICY_ADAPTER_UNAVAILABLE');
    return account;
  }
  function pendingReference(view, value) {
    return taskPolicyPendingReference({ scopeKey: view.scopeKey, changeId: value.changeId,
      changeDigest: value.changeDigest, mode: value.mode, previousRevision: value.expectedRevision });
  }
  async function requestStatus(binding, signal, session, account, reference = null) {
    const raw = await client.taskVerification('status', reference ? taskPolicyChangeQuery(reference) : {}, { signal });
    current(binding, signal);
    const decoded = await wire.status(raw, session, account, reference); current(binding, signal);
    validateTaskVerificationPolicyView(decoded.view, session);
    return decoded;
  }
  function resolve(reference, reconciliation) {
    if (['committed', 'not-committed'].includes(reconciliation?.state)) {
      store.forget(reference); return true;
    }
    return false;
  }
  async function readState(binding, signal) {
    const session = current(binding, signal), account = await currentAccount(binding, signal);
    let decoded = await requestStatus(binding, signal, session, account);
    if (!store || !decoded.changeProtocol) return { session, account, decoded, reference: null,
      view: Object.freeze({ ...decoded.view, canChange: false }) };
    let reference = store.read(decoded.view.scopeKey);
    if (!reference && decoded.pendingChange) reference = store.remember(pendingReference(decoded.view, decoded.pendingChange));
    if (reference) {
      decoded = await requestStatus(binding, signal, session, account, reference);
      if (resolve(reference, decoded.reconciliation)) {
        reference = null;
        // A newer tab's current draft remains unresolved even after our own
        // old reference is conclusively resolved. Never silently replace it.
        if (decoded.pendingChange) reference = store.remember(pendingReference(decoded.view, decoded.pendingChange));
      }
    }
    const view = Object.freeze({ ...decoded.view, changeState: reference ? 'unknown' : decoded.view.changeState });
    return { session, account, decoded, reference, view };
  }
  return Object.freeze({
    async read({ binding, signal }) { return (await readState(binding, signal)).view; },
    async cancelPending({ binding, signal, expectedScopeKey }) {
      if (changing) throw refused('TASK_POLICY_CHANGE_UNRESOLVED');
      changing = true;
      try {
        const state = await readState(binding, signal), { reference, session, account, decoded } = state;
        if (state.view.scopeKey !== expectedScopeKey) throw refused('TASK_VERIFICATION_REVISION_CONFLICT');
        if (!reference) return state.view;
        // UNKNOWN is not permission to retry or a false cancellation success.
        // Only the exact live, noncommitting draft is cancellable from this UI.
        if (decoded.reconciliation?.state !== 'pending') return state.view;
        const raw = await client.taskVerification('cancel', taskPolicyChangeQuery(reference), { signal }); current(binding, signal);
        if (typeof wire.cancelled !== 'function') throw refused('TASK_POLICY_WIRE_REFUSED');
        const result = wire.cancelled(raw, reference, decoded); current(binding, signal);
        resolve(reference, result);
        return (await readState(binding, signal)).view;
      } finally { changing = false; }
    },
    async change({ binding, signal, expectedRevision, expectedScopeKey, mode }) {
      if (changing) throw refused('TASK_POLICY_CHANGE_UNRESOLVED');
      changing = true;
      try {
        const { session, account, decoded, reference, view: reviewed } = await readState(binding, signal);
        if (!store || reference || reviewed.revision !== expectedRevision || reviewed.scopeKey !== expectedScopeKey ||
          !reviewed.canChange || reviewed.changeState !== 'settled' || reviewed.mode === mode)
          throw refused('TASK_VERIFICATION_REVISION_CONFLICT');
        let preparedReference = null;
        return await runTaskVerificationPolicyChange({ document, window, walletLogin, client,
          binding, signal, reviewed, mode, decoders: wire,
          onPrepared(prepared) {
            current(binding, signal);
            preparedReference = store.remember(taskPolicyPendingReference({ scopeKey: reviewed.scopeKey,
              changeId: prepared.changeId, changeDigest: prepared.changeDigest, mode, previousRevision: expectedRevision }));
          },
          onConfirmDispatch() {
            current(binding, signal);
            const saved = store.read(reviewed.scopeKey);
            if (!preparedReference || JSON.stringify(saved) !== JSON.stringify(preparedReference))
              throw refused('TASK_POLICY_CHANGE_UNRESOLVED');
          },
          async onCommitted(committed) {
            // Do not use current mode or lastChange as the outcome authority.
            // The full durable-audit query also finds commits before later saves.
            const status = await requestStatus(binding, signal, session, account, preparedReference);
            if (status.reconciliation?.state !== 'committed') throw refused('TASK_POLICY_COMMIT_AUDIT_REFUSED');
            resolve(preparedReference, status.reconciliation);
          },
          onCancelled(raw) {
            if (!preparedReference || typeof wire.cancelled !== 'function') return;
            const outcome = wire.cancelled(raw, preparedReference, decoded);
            // If a concurrent save advanced the revision, this earlier status
            // is insufficient to decode it. A later authenticated read resolves it.
            resolve(preparedReference, outcome);
          },
        });
      } finally { changing = false; }
    },
  });
}

