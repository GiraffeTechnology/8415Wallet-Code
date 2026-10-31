import { readAssetWorkspace, renderAssetWorkspace } from '../dist/browser/browser.js';
import { paint, presentation } from './i18n.mjs';
import { rendererMessages } from './renderer-messages.mjs';
import workspaceCopy, { workspaceNarrative } from './locales/workspace.mjs';
import { privateReadProjection, identityText } from './wallet-identity-display.mjs';

/** Mounted by the existing app, with its original connected session references. */
export function mountAssetWorkspace({ root, login, getContext }) {
  if (!root) return;
  const message = key => presentation(locale => (workspaceCopy[locale] ?? workspaceCopy.en)[key]);
  const label = (element, key) => paint(element, message(key));
  const field = (input, key) => {
    const wrapper = document.createElement('label'), text = document.createElement('span');
    label(text, key); wrapper.append(text, input); return wrapper;
  };
  const panel = document.createElement('section');
  const title = document.createElement('h2'); title.id = 'asset-workspace-title'; label(title, 'title');
  panel.setAttribute('aria-labelledby', title.id);
  const instant = document.createElement('input'); instant.type = 'text'; instant.inputMode = 'numeric';
  const instantLabel = field(instant, 'instant');
  const sequence = document.createElement('input'); sequence.type = 'text';
  const sequenceLabel = field(sequence, 'sequence');
  const logs = document.createElement('input'); logs.type = 'checkbox';
  const logsLabel = field(logs, 'logs');
  const load = document.createElement('button'); load.type = 'button'; label(load, 'load');
  const next = document.createElement('button'); next.type = 'button'; label(next, 'next');
  const select = document.createElement('select'); const selectLabel = field(select, 'section');
  for (const value of ["asset", "temporal", "register-history", "dual-history", "responsibility", "payments"]) {
    const option = document.createElement('option'); option.value = value; label(option, value); select.append(option);
  }
  const output = document.createElement('pre'); output.setAttribute('aria-live', 'polite');
  output.style.whiteSpace = 'pre-wrap'; output.style.overflowWrap = 'anywhere';
  panel.append(title, instantLabel, sequenceLabel, logsLabel, load, next, selectLabel, output); root.append(panel);
  let generation = 0, report = null, nextVersion = null, pending = false;
  let page = globalThis.history?.state?.walletPage ?? 'native';
  panel.setAttribute('data-page', 'native'); panel.hidden = page !== 'native';
  const clear = () => { generation++; report = null; nextVersion = null; pending = false; paint(output, ''); };
  const refresh = () => {
    let authenticated = false; try { login.assert(); authenticated = true; } catch { clear(); }
    for (const item of [load, select, instant, sequence, logs]) item.disabled = !authenticated || pending || panel.hidden || document.visibilityState === 'hidden';
    next.disabled = !authenticated || pending || nextVersion === null || panel.hidden || document.visibilityState === 'hidden';
  };
  const render = () => { if (report) { const safe = report, tab = select.value;
    paint(output, presentation(locale => identityText(renderAssetWorkspace(safe, tab, (text, values = {}) => (workspaceNarrative[locale]?.[text] ?? text).replace(/\{([a-z]+)\}/g, (match, key) => values[key] ?? match), rendererMessages(locale)), locale))); } };
  login.subscribe(() => { clear(); instant.value = ''; sequence.value = ''; logs.checked = false; refresh(); });
  document.addEventListener('wallet:summary-stale', () => { clear(); refresh(); });
  for (const event of ['input', 'change']) document.getElementById('tokenId')?.addEventListener(event, () => { clear(); refresh(); });
  globalThis.addEventListener('pagehide', () => { clear(); refresh(); });
  globalThis.addEventListener('pageshow', () => { clear(); refresh(); });
  document.addEventListener('wallet:page', event => { page = event.detail; panel.hidden = page !== 'native'; clear(); refresh(); });
  document.addEventListener('visibilitychange', () => { clear(); refresh(); });
  for (const item of [instant, sequence, logs]) item.addEventListener('input', () => { clear(); refresh(); });
  select.addEventListener('change', () => { try { login.assert(); render(); } catch { clear(); refresh(); } });
  async function read(startVersion = 1n) {
    if (pending || panel.hidden || document.visibilityState === 'hidden') return;
    const epoch = ++generation; let binding;
    pending = true; refresh();
    report = null; nextVersion = null; paint(output, '');
    try {
      binding = login.capture(); await login.check(); const authenticated = login.assert(binding);
      if (epoch !== generation || panel.hidden || document.visibilityState === 'hidden') return;
      const context = getContext();
      if (!context?.wallet || context.wallet.reader.source.chainId.toString() !== authenticated.chainId) throw new Error('WORKSPACE_CONTEXT_REQUIRED');
      if (!/^(0|[1-9][0-9]{0,19})$/.test(instant.value)) throw new Error('WORKSPACE_INSTANT_REQUIRED');
      const sequenceId = sequence.value.trim();
      if (sequenceId && !/^0x[0-9a-f]{64}$/.test(sequenceId)) throw new Error('WORKSPACE_SEQUENCE_REFUSED');
      if (sequenceId && !context.linkedReader) throw new Error('WORKSPACE_LINKED_UNAVAILABLE');
      const options = { historyStart: startVersion, historyLimit: 16, includeLogs: logs.checked };
      if (sequenceId) options.linked = {
        sequenceId, reader: context.linkedReader,
        readBlockHash: async number => {
          const block = await context.provider.request({
            method: 'eth_getBlockByNumber', params: ['0x' + number.toString(16), false],
          });
          login.assert(binding);
          if (!block || typeof block.hash !== 'string') throw new Error('WORKSPACE_BLOCK_UNAVAILABLE');
          return block.hash.toLowerCase();
        },
        ...(context.payments ? { payments: context.payments } : {}),
      };
      const result = await readAssetWorkspace(context.wallet, context.tokenId, BigInt(instant.value), options);
      login.assert(binding); await login.check(); login.assert(binding);
      const latestContext = getContext();
      if (epoch !== generation || panel.hidden || document.visibilityState === 'hidden' || latestContext.wallet !== context.wallet || latestContext.tokenId !== context.tokenId) return;
      report = privateReadProjection(result, authenticated.account); nextVersion = result.registerHistory.state === 'ready' ? result.registerHistory.value.nextVersion : null;
      render();
    } catch {
      if (binding) { try { login.assert(binding); if (epoch === generation) paint(output, message('unavailable')); } catch { clear(); } }
    } finally { if (epoch === generation) { pending = false; refresh(); } }
  }
  load.addEventListener('click', () => read());
  next.addEventListener('click', () => { if (nextVersion !== null) { select.value = 'register-history'; void read(nextVersion); } });
  refresh();
}
