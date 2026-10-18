import { ObservationDetailsFlow } from './observation-details-flow.mjs';
import { msg, paint } from './i18n.mjs';

/** Mounted inside the existing authenticated wallet shell, reusing its original
 * brand asset, language switcher and card/button system. No new endpoint, source
 * selector, signing or transaction-retry control is introduced.
 */
export function mountObservationDetails({ root, document, window, walletLogin,
  clientFor = () => null, onBack = () => {} }) {
  if (!root) return null;
  const panel = document.createElement('section'); panel.className = 'observation-details'; panel.hidden = true;
  const style = document.createElement('style');
  style.textContent = '.observation-details{display:flex;flex-direction:column;gap:24px;min-width:0;width:100%}' +
    '.observation-details[hidden]{display:none}.observation-details .card{box-sizing:border-box;width:100%;min-width:0}' +
    '.observation-details .review-row{min-width:0;display:flex;flex-wrap:wrap;gap:8px 16px}' +
    '.observation-details strong{overflow-wrap:anywhere;min-width:0;max-width:100%}' +
    '.observation-details button{min-height:48px;max-width:100%;white-space:normal}' +
    '@media(max-width:520px){.observation-details .review-row{flex-direction:column;align-items:flex-start}}';
  const title = document.createElement('h2'); title.tabIndex = -1; paint(title, msg('task.detailsTitle'));
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const original = document.createElement('section'), observed = document.createElement('section'), authority = document.createElement('section');
  for (const card of [original, observed, authority]) card.className = 'card';
  const refresh = document.createElement('button'), back = document.createElement('button');
  refresh.type = back.type = 'button'; paint(refresh, msg('task.detailsRefresh')); paint(back, msg('task.detailsBack'));
  const immutableNotice = document.createElement('p'); paint(immutableNotice, msg('task.readOnlyObserverNote'));
  authority.append(immutableNotice); panel.append(style, title, status, original, observed, authority, back, refresh); root.append(panel);
  let flow = null, selection = null, client = null, binding = null;
  function label(target, key, value, localized = false) {
    const row = document.createElement('div'); row.className = 'review-row';
    const name = document.createElement('span'), data = document.createElement('strong');
    paint(name, msg(key)); if (localized) paint(data, msg(`task.${value}`)); else data.textContent = String(value);
    row.append(name, data); target.append(row);
  }
  function verifier(target, key, value) {
    if (!value) return;
    const heading = document.createElement('h3'); paint(heading, msg(key)); target.append(heading);
    label(target, 'task.verifierId', value.verifierId); label(target, 'task.verifierVersion', value.verifierVersion);
    label(target, 'task.verifierDigest', value.verifierImplementationDigest);
  }
  function render(snapshot) {
    original.replaceChildren(); observed.replaceChildren();
    if (snapshot.phase === 'closed') {
      selection = null; client = null; binding = null;
      paint(status, ''); panel.hidden = true; refresh.disabled = true; return;
    }
    panel.setAttribute('aria-busy', snapshot.loading ? 'true' : 'false');
    refresh.disabled = snapshot.loading || client === null || selection === null;
    if (!selection) { paint(status, ''); return; }
    verifier(original, 'task.originalApprovalVerifier', selection.approvedVerifier);
    label(original, 'task.detailsAuthority', selection.grantState, true);
    label(original, 'task.detailsTransaction', selection.transactionHash);
    const evidence = snapshot.evidence;
    paint(status, msg(snapshot.loading ? 'task.detailsLoading' : snapshot.error === 'OBSERVATION_BINDING_REFUSED' ||
      snapshot.error === 'OBSERVATION_REVISION_STALE' ? 'task.detailsBindingRefused' :
      snapshot.error === 'OBSERVATION_SOURCE_UNSUPPORTED' ? 'task.detailsUnsupported' :
      evidence === null ? 'task.detailsNoEvidence' : snapshot.stale ? 'task.detailsRetained' : 'task.detailsAvailable'));
    if (evidence) {
      verifier(observed, 'task.detailsObservedBy', evidence.observedBy);
      label(observed, 'task.acceptedObservationRevision', evidence.savedRevision);
      label(observed, 'task.detailsObservedAt', evidence.observedAt);
      label(observed, 'task.detailsSourceRevision', evidence.sourceRevision);
      const outcome = document.createElement('p'); paint(outcome, msg(`task.observation.${evidence.outcome}`)); observed.append(outcome);
      const availability = document.createElement('p');
      paint(availability, msg(snapshot.stale || evidence.availability !== 'available' ? 'task.detailsRetained' : 'task.detailsAvailable'));
      observed.append(availability);
    }
  }
  function close() {
    flow?.close(); flow = null; selection = null; client = null; binding = null;
    original.replaceChildren(); observed.replaceChildren(); paint(status, ''); panel.hidden = true; refresh.disabled = true;
  }
  async function open(value) {
    close();
    const session = walletLogin.assert(), captured = walletLogin.capture();
    // The selection is from an already decoded, authenticated task/operation
    // view, never a URL-selected verifier, raw imported response or endpoint.
    selection = Object.freeze({ ...value }); binding = captured; client = clientFor(); panel.hidden = false;
    if (!client || !['resolveSource','readEvidence','decodeEvidence'].every(key => typeof client[key] === 'function')) {
      client = null; render({ loading: false, stale: false, evidence: null, error: 'OBSERVATION_SOURCE_UNSUPPORTED' });
      title.focus?.(); return;
    }
    const capturedClient = client;
    flow = new ObservationDetailsFlow({
      resolveSource: (context, options) => capturedClient.resolveSource(context, options),
      readEvidence: (context, options) => capturedClient.readEvidence(context, options),
      decodeEvidence: (raw, expected) => capturedClient.decodeEvidence(raw, expected),
      assertSession: token => { const current = walletLogin.assert(token);
        if (capturedClient !== clientFor()) throw Error('OBSERVATION_SESSION_CHANGED');
        return { ...current, account: current.account.toLowerCase() }; },
      onChange: render,
    });
    title.focus?.();
    await flow.open({ tenant: session.tenant, origin: session.origin, account: session.account.toLowerCase(),
      chainId: session.chainId, taskDigest: value.taskDigest, operationId: value.operationId, childDigest: value.childDigest }, binding);
  }
  refresh.addEventListener('click', () => { void flow?.refresh(); });
  back.addEventListener('click', () => { close(); onBack(); });
  walletLogin.subscribe(close);
  document.addEventListener('wallet:page', event => { if (event.detail !== 'tasks') close(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') close(); });
  window.addEventListener('pagehide', close);
  return Object.freeze({ open, close, snapshot: () => flow?.snapshot() ?? null, panel });
}
