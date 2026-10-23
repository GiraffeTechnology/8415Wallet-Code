/** Read-only bridge from the authoritative per-operation verification policy to
 * the Agent settings summary row. It reads the saved setting for the current
 * authenticated wallet and displays it; it never changes a policy, enables a
 * control, prepares a verification or invents a value. An unavailable service,
 * failed read, changed account or signed-out session falls back to the existing
 * unlocked ON default, never to a displayed OFF.
 *
 * Operating the switch stays in the human management entry, which owns login,
 * secondary verification, revision conflicts and cancellation.
 */
const UNCONNECTED = 'unconnected-default', SAVED = 'saved-policy';
const connections = new WeakMap();

export function connectFoundationPolicySummary({ document, walletLogin, getPolicyClient }) {
  if (connections.has(document)) return connections.get(document);
  const control = document.getElementById('foundation-humanVerification-switch');
  const value = document.getElementById('foundation-humanVerification-value');
  const savedNote = document.getElementById('foundation-policy-saved-note');
  if (!control || !value || !savedNote) return null;

  let epoch = 0, reading = false, destroyed = false;
  function reset() {
    epoch++;
    control.dataset.policySource = UNCONNECTED;
    control.dataset.displayMode = 'ON';
    delete control.dataset.savedRevision;
    control.setAttribute('aria-describedby', 'foundation-policy-note');
    value.textContent = 'ON';
    savedNote.hidden = true;
  }
  function show(view) {
    if (view?.mode !== 'ON' && view?.mode !== 'OFF') return false;
    // Displaying an authoritative view also invalidates any read still in
    // flight: that response predates this one and must never put the previous
    // mode and revision back after a saved change.
    epoch++;
    control.dataset.policySource = SAVED;
    control.dataset.displayMode = view.mode;
    control.dataset.savedRevision = view.revision;
    control.setAttribute('aria-describedby', 'foundation-policy-saved-note');
    value.textContent = view.mode;
    savedNote.hidden = false;
    return true;
  }
  async function read() {
    if (destroyed || reading) return;
    const ticket = ++epoch;
    reading = true;
    try {
      const binding = walletLogin.capture();
      walletLogin.assert(binding);
      const adapter = getPolicyClient();
      if (!adapter) { if (ticket === epoch) reset(); return; }
      const view = await adapter.read({ binding });
      // A login, account or chain change during the read invalidates its result.
      walletLogin.assert(binding);
      if (ticket !== epoch || destroyed) return;
      if (!show(view)) reset();
    } catch { if (ticket === epoch && !destroyed) reset(); }
    finally { reading = false; }
  }
  const onPage = event => { if (event.detail === 'settings') void read(); };
  reset();
  document.addEventListener('wallet:page', onPage);
  const unsubscribe = walletLogin.subscribe(() => reset());
  const connection = Object.freeze({
    read,
    // A fresh authoritative view from the management entry is adopted at once.
    // Hidden, busy and draft states carry no authoritative mode and change nothing.
    observe(state) { if (!destroyed) show(state?.view); },
    destroy() {
      if (destroyed) return;
      destroyed = true; reset(); unsubscribe?.();
      document.removeEventListener('wallet:page', onPage); connections.delete(document);
    },
  });
  connections.set(document, connection);
  return connection;
}
