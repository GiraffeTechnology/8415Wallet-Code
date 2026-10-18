/** Account-owned presentation bridge using the exact verified 92b3a11 source.
 * Status is readable when the server makes it available. Changes stay disabled
 * until session-wide cancellation and reload reconciliation are authoritative.
 * Do not activate the server's default-false execution flag from this UI.
 */
import { runTaskVerificationPolicyChange } from './task-verification-policy-ceremony.mjs';
import { validateTaskVerificationPolicyView } from './task-verification-policy-ui.mjs';
import { createTaskVerificationPolicyWire } from './task-verification-policy-wire.mjs';

const refused = code => Object.assign(new Error(code), { code });

/** One stable bridge per AccountAuthClient. wire is a source-owned decoder seam
 * for isolated contract tests; the normal startup never injects it from a global,
 * browser storage, JSON payload or an asserted capability flag.
 *
 * wire.status(raw, session, account) -> {view, lastChange}; view satisfies the strict UI
 * contract, lastChange is the verified audit entry or null. The exact audit must
 * retain changeId/changeDigest/mode/previousRevision/revision for reconciliation.
 * The current wire decoder establishes these fields from verified source bytes.
 * RELEASE BLOCKERS also include session-wide cancel/replacement safety and
 * authoritative UNKNOWN reconciliation across reload/session replacement. Pending
 * below is in-memory only and must not be represented as solving those cases.
 * wire.prepared/verified/committed implement the ceremony's documented seam.
 */
export function createTaskVerificationPolicyClient({ client, walletLogin, document, window,
  wire = createTaskVerificationPolicyWire({ crypto: window?.crypto ?? globalThis.crypto }) }) {
  if (!wire || !['status', 'prepared', 'verified', 'committed'].every(name => typeof wire[name] === 'function')) return null;
  let pending = null, changing = false;
  function current(binding, signal) {
    if (signal?.aborted) throw refused('TASK_POLICY_CHANGE_CANCELLED');
    return walletLogin.assert(binding);
  }
  async function currentAccount(binding, signal) {
    const account = await client.account(); current(binding, signal);
    // Exact 92b /account advertises null when the server-owned service is off.
    // Do not probe a disabled/missing policy entry or fabricate a saved default.
    if (account?.taskHumanVerification === null || account?.taskHumanVerification === undefined) {
      throw refused('TASK_POLICY_ADAPTER_UNAVAILABLE');
    }
    return account;
  }
  function matches(entry) {
    return pending && entry && entry.changeId === pending.changeId && entry.changeDigest === pending.changeDigest &&
      entry.mode === pending.mode && entry.previousRevision === pending.previousRevision &&
      typeof entry.revision === 'string' && BigInt(entry.revision) > BigInt(pending.previousRevision);
  }
  return Object.freeze({
    async read({ binding, signal }) {
      const session = current(binding, signal);
      const account = await currentAccount(binding, signal);
      const raw = await client.taskVerification('status', {}, { signal }); current(binding, signal);
      const decoded = await wire.status(raw, session, account); current(binding, signal);
      const view = validateTaskVerificationPolicyView(decoded.view, session);
      if (matches(decoded.lastChange)) pending = null;
      // A current mode alone cannot resolve a timed-out confirmation. Keep the
      // unknown marker until that exact change is matched by authoritative audit.
      return Object.freeze({ ...view, changeState: pending ? 'unknown' : view.changeState });
    },
    async change({ binding, signal, expectedRevision, expectedScopeKey, mode }) {
      if (changing || pending) throw refused('TASK_POLICY_CHANGE_UNRESOLVED');
      const session = current(binding, signal); changing = true;
      try {
        const account = await currentAccount(binding, signal);
        const raw = await client.taskVerification('status', {}, { signal }); current(binding, signal);
        const decoded = await wire.status(raw, session, account); current(binding, signal);
        const reviewed = validateTaskVerificationPolicyView(decoded.view, session);
        if (reviewed.revision !== expectedRevision || reviewed.scopeKey !== expectedScopeKey ||
          !reviewed.canChange || reviewed.changeState !== 'settled' || reviewed.mode === mode) {
          throw refused('TASK_VERIFICATION_REVISION_CONFLICT');
        }
        return await runTaskVerificationPolicyChange({ document, window, walletLogin, client,
          binding, signal, reviewed, mode, decoders: wire,
          onConfirmDispatch(prepared) {
            current(binding, signal);
            pending = Object.freeze({ changeId: prepared.changeId, changeDigest: prepared.changeDigest,
              mode, previousRevision: expectedRevision });
          },
          async onCommitted(committed) {
            const decoded = await wire.status(committed, session, account); current(binding, signal);
            validateTaskVerificationPolicyView(decoded.view, session);
            if (!matches(decoded.lastChange)) throw refused('TASK_POLICY_COMMIT_AUDIT_REFUSED');
            pending = null;
          },
          // cancel acknowledgement cannot prove a dispatched confirmation did
          // not already commit, so it never clears pending here.
        });
      } finally { changing = false; }
    },
  });
}
