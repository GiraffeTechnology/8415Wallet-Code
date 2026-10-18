import { walletLogin } from './wallet-auth.mjs';
import { openHoodiJourneyRead, compareHoodiReleaseHistory, renderHoodiReleaseHistory }
  from '../dist/browser/browser.js';

// This module adds a read-only panel, never an authentication or execution path.
const root = document.getElementById('wallet-private');
if (root) {
  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Hoodi original release and late register history');
  const title = document.createElement('h2');
  title.textContent = 'Hoodi — original release / later register history';
  const help = document.createElement('p');
  help.textContent = 'Compare the original v2 record with a later v3 for the bound test asset. Read only; no release or transaction is authorized.';
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.setAttribute('aria-label', 'Original release and later v3 evidence JSON');
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'Compare authenticated Hoodi history';
  const output = document.createElement('pre');
  output.setAttribute('aria-live', 'polite');
  output.style.whiteSpace = 'pre-wrap'; output.style.overflowWrap = 'anywhere';
  panel.append(title, help, input, button, output); root.append(panel);
  // Each refusal says which rule refused and the bound it enforced. The codes
  // are tagged rather than matched on message text, so a backend failure can
  // never present itself as one of them; anything untagged stays generic.
  const REFUSALS = Object.freeze({
    EVIDENCE_FILE_REQUIRED: 'EVIDENCE_FILE_REQUIRED: choose an evidence JSON file',
    EVIDENCE_FILE_TOO_LARGE: 'EVIDENCE_FILE_TOO_LARGE: at most 65536 bytes',
    EVIDENCE_INTEGER_INVALID: 'EVIDENCE_INTEGER_INVALID: integer fields must be decimal strings, not JSON numbers',
    EVIDENCE_ENVELOPE_INVALID: 'EVIDENCE_ENVELOPE_INVALID: exactly the keys original and laterV3',
    EVIDENCE_SESSION_MISMATCH: 'EVIDENCE_SESSION_MISMATCH: the signed-in account, chain 560048 and tenant must match the manifest',
  });
  const refuse = code => { const error = new Error(code); error.evidenceCode = code; throw error; };
  let generation = 0, pending = false;
  let page = globalThis.history?.state?.walletPage ?? 'activity';
  panel.setAttribute('data-page', 'activity'); panel.hidden = page !== 'activity';
  const clear = () => { generation++; input.value = ''; output.textContent = ''; pending = false; };
  const refresh = () => {
    try { walletLogin.assert(); button.disabled = pending || panel.hidden || document.visibilityState === 'hidden'; input.disabled = button.disabled; }
    catch { clear(); button.disabled = true; input.disabled = true; }
  };
  walletLogin.subscribe(() => { clear(); refresh(); });
  globalThis.addEventListener('pagehide', () => { clear(); refresh(); });
  globalThis.addEventListener('pageshow', () => { clear(); refresh(); });
  document.addEventListener?.('wallet:page', event => { page = event.detail; panel.hidden = page !== 'activity'; clear(); refresh(); });
  document.addEventListener?.('visibilitychange', () => { clear(); refresh(); });
  input.addEventListener('change', () => { generation++; output.textContent = ''; pending = false; refresh(); });
  const integers = new Set(['chainId', 'tokenId', 'blockNumber', 'recordedAt', 'version',
    'effectiveAt', 'supersededAt', 'buyerOccurrence', 'ownerOccurrence', 'holderOccurrence']);
  button.addEventListener('click', async () => {
    if (pending || panel.hidden || document.visibilityState === 'hidden') return;
    const currentGeneration = ++generation;
    pending = true; refresh();
    let binding;
    output.textContent = '';
    try {
      binding = walletLogin.capture();
      await walletLogin.check(); const session = walletLogin.assert(binding);
      if (currentGeneration !== generation || panel.hidden || document.visibilityState === 'hidden') return;
      const file = input.files?.[0];
      if (!file) refuse('EVIDENCE_FILE_REQUIRED');
      if (file.size > 65536) refuse('EVIDENCE_FILE_TOO_LARGE');
      const text = await file.text(); walletLogin.assert(binding);
      if (currentGeneration !== generation || panel.hidden || document.visibilityState === 'hidden') return;
      const envelope = JSON.parse(text, (key, value) => {
        if (!integers.has(key)) return value;
        if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) {
          refuse('EVIDENCE_INTEGER_INVALID');
        }
        return BigInt(value);
      });
      if (!envelope || Object.keys(envelope).sort().join(',') !== 'laterV3,original') {
        refuse('EVIDENCE_ENVELOPE_INVALID');
      }
      const manifest = envelope.original.manifest;
      const currentWallet = manifest.wallets.find(w =>
        typeof w.account === 'string' && w.account.toLowerCase() === session.account.toLowerCase());
      if (session.chainId !== '560048' || !currentWallet ||
          typeof session.tenant !== 'string' || session.tenant !== currentWallet.tenant) refuse('EVIDENCE_SESSION_MISMATCH');
      const pinned = await openHoodiJourneyRead(walletLogin.provider(), manifest);
      walletLogin.assert(binding); if (currentGeneration !== generation || panel.hidden || document.visibilityState === 'hidden') return;
      const report = await compareHoodiReleaseHistory(envelope.original, envelope.laterV3, pinned);
      walletLogin.assert(binding); await walletLogin.check(); walletLogin.assert(binding);
      if (currentGeneration !== generation || panel.hidden || document.visibilityState === 'hidden') return;
      output.textContent = renderHoodiReleaseHistory(report);
    } catch (error) {
      // Never display/log backend text, raw JSON, signatures or session details.
      if (binding) {
        try {
          walletLogin.assert(binding);
          if (currentGeneration === generation) output.textContent = REFUSALS[error?.evidenceCode] ?? 'HOODI_EVIDENCE_UNAVAILABLE';
        }
        catch { clear(); }
      }
    } finally {
      if (currentGeneration === generation) { pending = false; refresh(); }
    }
  });
  refresh();
}
