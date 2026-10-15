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
  help.textContent = 'Xiongan, Giraffe and Lala: compare the original v2 record with a later v3. Read only; no release or transaction is authorized.';
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.setAttribute('aria-label', 'Original release and later v3 evidence JSON');
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = 'Compare authenticated Hoodi history';
  const output = document.createElement('pre');
  output.setAttribute('aria-live', 'polite');
  output.style.whiteSpace = 'pre-wrap'; output.style.overflowWrap = 'anywhere';
  panel.append(title, help, input, button, output); root.append(panel);
  let generation = 0, pending = false;
  const clear = () => { generation++; input.value = ''; output.textContent = ''; pending = false; };
  const refresh = () => {
    try { walletLogin.assert(); button.disabled = pending; input.disabled = pending; }
    catch { clear(); button.disabled = true; input.disabled = true; }
  };
  walletLogin.subscribe(() => { clear(); refresh(); });
  globalThis.addEventListener('pagehide', () => { clear(); refresh(); });
  globalThis.addEventListener('pageshow', () => { clear(); refresh(); });
  input.addEventListener('change', () => { generation++; output.textContent = ''; pending = false; refresh(); });
  const integers = new Set(['chainId', 'tokenId', 'blockNumber', 'recordedAt', 'version',
    'effectiveAt', 'supersededAt', 'buyerOccurrence', 'ownerOccurrence', 'holderOccurrence']);
  button.addEventListener('click', async () => {
    if (pending || document.visibilityState === 'hidden') return;
    const currentGeneration = ++generation;
    pending = true; refresh();
    let binding;
    output.textContent = '';
    try {
      binding = walletLogin.capture();
      await walletLogin.check(); const session = walletLogin.assert(binding);
      if (currentGeneration !== generation || document.visibilityState === 'hidden') return;
      const file = input.files?.[0];
      if (!file || file.size > 65536) throw new Error('EVIDENCE_FILE_REQUIRED');
      const text = await file.text(); walletLogin.assert(binding);
      if (currentGeneration !== generation) return;
      const envelope = JSON.parse(text, (key, value) => {
        if (!integers.has(key)) return value;
        if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) {
          throw new Error('EVIDENCE_INTEGER_INVALID');
        }
        return BigInt(value);
      });
      if (!envelope || Object.keys(envelope).sort().join(',') !== 'laterV3,original') {
        throw new Error('EVIDENCE_ENVELOPE_INVALID');
      }
      const manifest = envelope.original.manifest;
      const currentWallet = manifest.wallets.find(w =>
        typeof w.account === 'string' && w.account.toLowerCase() === session.account.toLowerCase());
      if (session.chainId !== '560048' || !currentWallet ||
          session.tenant && session.tenant !== currentWallet.tenant) throw new Error('EVIDENCE_SESSION_MISMATCH');
      const pinned = await openHoodiJourneyRead(walletLogin.provider(), manifest);
      walletLogin.assert(binding); if (currentGeneration !== generation) return;
      const report = await compareHoodiReleaseHistory(envelope.original, envelope.laterV3, pinned);
      walletLogin.assert(binding); await walletLogin.check(); walletLogin.assert(binding);
      if (currentGeneration !== generation) return;
      output.textContent = renderHoodiReleaseHistory(report);
    } catch {
      // Never display/log backend text, raw JSON, signatures or session details.
      if (binding) {
        try { walletLogin.assert(binding); if (currentGeneration === generation) output.textContent = 'HOODI_EVIDENCE_UNAVAILABLE'; }
        catch { clear(); }
      }
    } finally {
      if (currentGeneration === generation) { pending = false; refresh(); }
    }
  });
  refresh();
}
