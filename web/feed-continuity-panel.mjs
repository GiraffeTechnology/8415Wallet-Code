import { paint } from './i18n.mjs';
import { readOnlyPaint, readOnlyLabel } from './readonly-i18n.mjs';
import { readFeedContinuity } from './feed-continuity.mjs';
/** Local configuration review only. It cannot install a watchtower or probe an imported endpoint. */
export function mountFeedContinuity({ root, login, getContext, document = globalThis.document, window = globalThis }) {
  const host = root?.querySelector('[data-page="native"]'); if (!host) return;
  const panel = document.createElement('section'); panel.className = 'card';
  const heading = document.createElement('h2'); readOnlyPaint(heading, 'feed.title');
  const help = document.createElement('p');
  readOnlyPaint(help, 'feed.help');
  const label = document.createElement('label'); readOnlyLabel(label, 'feed.file', document);
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; label.append(file);
  const read = document.createElement('button'); read.type = 'button'; readOnlyPaint(read, 'feed.read');
  const save = document.createElement('button'); save.type = 'button'; readOnlyPaint(save, 'feed.save'); save.disabled = true;
  const status = document.createElement('p'); status.setAttribute('role','status');
  const preview = document.createElement('pre');
  panel.append(heading, help, label, read, save, status, preview); host.append(panel);
  let epoch = 0, busy = false, binding = null, selected = null, output = null;
  function clear() {
    epoch++; busy = false; binding = null; selected = null; output = null;
    preview.textContent = ''; paint(status, ''); save.disabled = true; read.disabled = false;
  }
  function guard(ticket) {
    if (ticket !== epoch || host.hidden || document.visibilityState === 'hidden') throw new Error('FEED_REVIEW_CHANGED');
    login.assert(binding);
    const now = getContext();
    if (now.wallet !== selected.wallet || now.tokenId !== selected.tokenId) throw new Error('FEED_REVIEW_SELECTION_CHANGED');
  }
  read.addEventListener('click', async () => {
    if (busy || host.hidden) return;
    clear(); const ticket = epoch; busy = true; read.disabled = true;
    try {
      const chosen = file.files?.[0];
      if (!chosen || chosen.size > 16384) throw new Error('FEED_REVIEW_SIZE_REFUSED');
      await login.check(); if (ticket !== epoch) return;
      binding = login.capture(); selected = getContext(); guard(ticket);
      const text = await chosen.text(); guard(ticket);
      const value = await readFeedContinuity({ ...selected, text, guard: () => guard(ticket) });
      await login.check(); guard(ticket);
      output = JSON.stringify(value, null, 2) + '\n'; preview.textContent = output;
      readOnlyPaint(status, 'feed.ok');
      save.disabled = false;
    } catch {
      if (ticket === epoch) { output = null; preview.textContent = ''; save.disabled = true;
        readOnlyPaint(status, 'feed.error'); }
    } finally { if (ticket === epoch) { busy = false; read.disabled = false; } }
  });
  save.addEventListener('click', async () => {
    if (!output || busy) return;
    const ticket = epoch; busy = true; save.disabled = true;
    try {
      await login.check(); guard(ticket);
      const url = window.URL.createObjectURL(new window.Blob([output], { type: 'application/json;charset=utf-8' }));
      try {
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'feed-continuity-unverified.json';
        panel.append(anchor); anchor.click(); anchor.remove();
        readOnlyPaint(status, 'feed.download');
      } finally { window.setTimeout(() => window.URL.revokeObjectURL(url), 1000); }
    } catch { if (ticket === epoch) clear(); }
    finally { if (ticket === epoch) { busy = false; save.disabled = !output; } }
  });
  file.addEventListener('change', clear);
  for (const name of ['input','change']) document.getElementById('tokenId')?.addEventListener(name, clear);
  document.addEventListener('wallet:page', event => { if (event.detail !== 'native') { clear(); file.value = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clear(); file.value = ''; } });
  window.addEventListener('pagehide', () => { clear(); file.value = ''; });
  login.subscribe(() => { clear(); file.value = ''; });
  return { clear };
}

