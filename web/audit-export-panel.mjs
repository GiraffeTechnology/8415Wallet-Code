import { paint, presentation } from './i18n.mjs';
import { readOnlyPaint, readOnlyText } from './readonly-i18n.mjs';
import { readAuditDownload } from './audit-export.mjs';
/** Explicit authenticated reads and local download; no storage, upload or registry resolution. */
export function mountAuditExport({ root, login, getContext, document = globalThis.document, window = globalThis }) {
  const host = root?.querySelector('[data-page="native"]');
  if (!host) return;
  const panel = document.createElement('section'); panel.className = 'card';
  const heading = document.createElement('h2'); readOnlyPaint(heading, 'audit.title');
  const help = document.createElement('p');
  readOnlyPaint(help, 'audit.help');
  const read = document.createElement('button'); read.type = 'button'; readOnlyPaint(read, 'audit.read');
  const save = document.createElement('button'); save.type = 'button'; readOnlyPaint(save, 'audit.save'); save.disabled = true;
  const status = document.createElement('p'); status.setAttribute('role','status');
  const preview = document.createElement('pre');
  panel.append(heading, help, read, save, status, preview); host.append(panel);
  let epoch = 0, busy = false, result = null, selected = null, binding = null;
  function clear() {
    epoch++; busy = false; result = null; selected = null; binding = null;
    preview.textContent = ''; paint(status, ''); read.disabled = false; save.disabled = true;
  }
  function current(ticket) {
    if (ticket !== epoch || document.visibilityState === 'hidden' || host.hidden) throw new Error('AUDIT_VIEW_CHANGED');
    login.assert(binding);
    const next = getContext();
    if (next.wallet !== selected.wallet || next.tokenId !== selected.tokenId) throw new Error('AUDIT_SELECTION_CHANGED');
  }
  read.addEventListener('click', async () => {
    if (busy || host.hidden) return;
    clear(); const ticket = epoch; busy = true; read.disabled = true;
    try {
      await login.check(); if (ticket !== epoch) return;
      binding = login.capture(); selected = getContext(); current(ticket);
      const value = await readAuditDownload({ ...selected, guard: () => current(ticket) });
      await login.check(); current(ticket);
      result = value; preview.textContent = value.json;
      paint(status, presentation(language => readOnlyText('audit.ok', language) + (value.gapsAvailable ? '' : ' ' + readOnlyText('audit.gaps', language))));
      save.disabled = false;
    } catch {
      if (ticket === epoch) { result = null; preview.textContent = ''; save.disabled = true;
        readOnlyPaint(status, 'audit.error'); }
    } finally { if (ticket === epoch) { busy = false; read.disabled = false; } }
  });
  save.addEventListener('click', async () => {
    if (!result || busy) return;
    const ticket = epoch; busy = true; save.disabled = true;
    try {
      await login.check(); current(ticket);
      const blob = new window.Blob([result.json], { type: 'application/json;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.filename;
        panel.append(anchor); anchor.click(); anchor.remove();
        readOnlyPaint(status, 'audit.download');
      } finally { window.setTimeout(() => window.URL.revokeObjectURL(url), 1000); }
    } catch { if (ticket === epoch) clear(); }
    finally { if (ticket === epoch) { busy = false; save.disabled = !result; } }
  });
  document.getElementById('tokenId')?.addEventListener('input', clear);
  document.getElementById('tokenId')?.addEventListener('change', clear);
  document.addEventListener('wallet:page', event => { if (event.detail !== 'native') clear(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clear(); });
  window.addEventListener('pagehide', clear); login.subscribe(clear);
  return { clear };
}

