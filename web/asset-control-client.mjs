/** Human-owned asset setting change adapter. No automatic retry on an uncertain
 * prepare/confirm and no browser value becomes an authoritative saved policy.
 */
import { createAssetControlTransport } from './asset-control-transport.mjs';
import { createAssetControlWire } from './asset-control-wire.mjs';
import { runTaskVerificationPolicyChange } from './task-verification-policy-ceremony.mjs';
const fail = () => { throw new Error('ASSET_CONTROL_CHANGE_UNRESOLVED'); };
export function createAssetControlClient({ client, walletLogin, document, window }) {
  const transport = createAssetControlTransport({ client, walletLogin });
  const wire = createAssetControlWire({ crypto: window.crypto });
  let changing = false;
  const current = (binding, signal) => {
    if (signal?.aborted) fail();
    const session = walletLogin.assert(binding); if (!session?.serverId) fail(); return session;
  };
  const storageKey = view => '8415wallet-asset-control-pending/1:' + view.scopeDigest;
  const pending = view => {
    const text = window.sessionStorage.getItem(storageKey(view));
    if (text === null) return null;
    const value = JSON.parse(text);
    if (!value || value.scopeDigest !== view.scopeDigest || !['preparing', 'prepared'].includes(value.phase)) fail();
    return value;
  };
  const remember = (view, value) => {
    const text = JSON.stringify({ scopeDigest: view.scopeDigest, ...value });
    window.sessionStorage.setItem(storageKey(view), text);
    if (window.sessionStorage.getItem(storageKey(view)) !== text) fail();
  };
  function forget(view) { window.sessionStorage.removeItem(storageKey(view)); }
  async function read({ binding, signal }) {
    const session = current(binding, signal), account = await client.account(); current(binding, signal);
    const authorizationContext=typeof client.authorizationContext==='function'?await client.authorizationContext():null;current(binding,signal);
    const raw = await transport.request('status', {}, { binding, signal });
    const view = await wire.status(raw, session, account,authorizationContext); current(binding, signal);
    const catalog = await wire.catalog(await transport.request('catalog', {}, { binding, signal }), view); current(binding, signal);
    let reference, changeState = 'settled', canChange = view.canSave;
    try {
      reference = pending(view);
      if (reference) {
        changeState = 'unknown';
        // A preparing marker is written before prepare and replaced with the
        // exact reference before either factor can be sent. After interruption
        // it cannot represent a dispatched confirm. Clearing it performs no
        // request, retry or save; a new change still needs explicit human input.
        if (reference.phase === 'preparing' && !changing) { forget(view); changeState = 'settled'; }
        if (reference.phase === 'prepared') {
          const result = await wire.reconciliation(await transport.request('reconcile', reference.query, { binding, signal }), reference.query, view);
          current(binding, signal);
          if (['committed', 'not-committed'].includes(result.state)) {
            forget(view); changeState = 'settled';
            // Reconciliation can observe a commit newer than the initial read.
            // Never unlock editing while displaying the older saved value.
            if (result.revision !== view.revision) return read({ binding, signal });
          }
        }
      }
    } catch { canChange = false; changeState = 'unknown'; }
    return { view, catalog, account, authorizationContext, changeState, canChange: canChange && changeState === 'settled' };
  }
  async function change({ binding, signal, reviewed, patch, scopeLabel }) {
    if (changing) fail(); changing = true;
    let prepared = null;
    try {
      const fresh = await read({ binding, signal }); current(binding, signal);
      if (!fresh.canChange || fresh.view.scopeDigest !== reviewed.scopeDigest || fresh.view.revision !== reviewed.revision) fail();
      const mode = patch.value ? 'ON' : 'OFF';
      const facade = {
        account: () => client.account(),
        async taskVerification(action, body, options = {}) {
          current(binding, options.signal);
          if (action === 'prepare') {
            // Persist uncertainty BEFORE the request; lost prepare is not a
            // reason to issue a second challenge silently after reload.
            remember(fresh.view, { phase: 'preparing' });
            return transport.request('prepare', { expectedRevision: reviewed.revision,
              identityMethod: body.identityMethod, patch, ...(fresh.authorizationContext?.continuation?{protocol:'8415-asset-control-change-wire/2'}:{}) }, { binding, ...options });
          }
          if (action === 'cancel') {
            if (!prepared) fail();
            return transport.request('cancel', { changeId: prepared.request.changeId,
              changeDigest: prepared.changeDigest, expectedRevision: reviewed.revision }, { binding, ...options });
          }
          return transport.request(action, body, { binding, ...options });
        },
      };
      const result = await runTaskVerificationPolicyChange({ document, window, walletLogin,
        client: facade, binding, signal, mode, authorizationContext:fresh.authorizationContext,
        reviewed: { revision: reviewed.revision, mode: patch.value ? 'OFF' : 'ON',
          walletLabel: reviewed.scope.tenant, context: reviewed.scope,
          agentId: reviewed.scope.agentId, agentLabel: reviewed.scope.agentId, scopeLabel:scopeLabel+(fresh.authorizationContext?.continuation?' · Authorization origin: '+reviewed.scope.origin:'') },
        decoders: {
          async prepared(raw, context) {
            prepared = await wire.prepared(raw, { ...context, reviewed, patch });
            current(binding, signal);
            return { ...prepared, changeId: prepared.request.changeId,
              issuedAt: prepared.request.issuedAt, expiresAt: prepared.request.expiresAt };
          },
          verified: (raw, _value, now) => wire.verified(raw, prepared, now),
          async committed(raw) {
            const session = current(binding, signal), account = await client.account(); current(binding, signal);
            const view = await wire.status(raw, session, account,fresh.authorizationContext); current(binding, signal);
            if (view.scopeDigest !== reviewed.scopeDigest || BigInt(view.revision) <= BigInt(reviewed.revision)) fail();
            return view;
          },
        },
        onPrepared() {
          remember(reviewed, { phase: 'prepared', query: { changeId: prepared.request.changeId,
            changeDigest: prepared.changeDigest, expectedRevision: reviewed.revision } });
        },
        onConfirmDispatch() {
          current(binding, signal);
          if (pending(reviewed)?.query?.changeDigest !== prepared.changeDigest) fail();
        },
        async onCommitted(view) {
          const reference = pending(reviewed);
          const result = await wire.reconciliation(await transport.request('reconcile', reference.query, { binding, signal }), reference.query, view);
          current(binding, signal); if (result.state !== 'committed') fail(); forget(reviewed);
        },
        async onCancelled(raw) {
          // Navigation aborts presentation, not an exact cancellation receipt.
          // Identity must still match; never clear a new account's pending state.
          walletLogin.assert(binding);
          const reference = pending(reviewed);
          if (!reference?.query || reference.query.changeId !== prepared.request.changeId ||
              reference.query.changeDigest !== prepared.changeDigest || typeof raw?.cancelled !== 'boolean') fail();
          const result = await wire.reconciliation(raw.reconciliation, reference.query, reviewed);
          walletLogin.assert(binding);
          if (['committed', 'not-committed'].includes(result.state) &&
              JSON.stringify(pending(reviewed)?.query) === JSON.stringify(reference.query)) forget(reviewed);
        },
      });
      current(binding, signal); return result;
    } finally { changing = false; }
  }
  return Object.freeze({ read, change });
}
