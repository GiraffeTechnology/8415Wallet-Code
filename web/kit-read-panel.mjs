import { paint, presentation, renderUi } from './i18n.mjs';
import { privateNativeUi } from './wallet-identity-display.mjs';
import { readOnlyPaint, readOnlyLabel } from './readonly-i18n.mjs';
import { KitProjectionApi, KitErc8415Reader, WalletSession, renderAssetView, renderTemporalQuery } from '../dist/browser/browser.js';
import { readKitDisplay } from './kit-read.mjs';

/** Optional same-origin public Kit reads; authenticated/private Kit requires an existing reviewed server route. */
export function mountKitRead({ root, login, getContext, document = globalThis.document, window = globalThis }) {
  const host = root?.querySelector('[data-page="native"]'); if (!host) return;
  const panel = document.createElement('section'); panel.className = 'card';
  const heading = document.createElement('h2'); readOnlyPaint(heading, 'kit.title');
  const help = document.createElement('p');
  readOnlyPaint(help, 'kit.help');
  const pathLabel = document.createElement('label'); readOnlyLabel(pathLabel, 'kit.path', document);
  const basePath = document.createElement('input'); basePath.type = 'text'; basePath.autocomplete = 'off'; pathLabel.append(basePath);
  const instantLabel = document.createElement('label'); readOnlyLabel(instantLabel, 'instant', document);
  const instant = document.createElement('input'); instant.type = 'text'; instant.inputMode = 'numeric'; instantLabel.append(instant);
  const read = document.createElement('button'); read.type = 'button'; readOnlyPaint(read, 'kit.read');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const output = document.createElement('pre'); output.style.whiteSpace = 'pre-wrap'; output.style.overflowWrap = 'anywhere';
  panel.append(heading, help, pathLabel, instantLabel, read, status, output); host.append(panel);
  let epoch = 0, busy = false, binding = null, selected = null;
  function clear() { epoch++; busy = false; binding = null; selected = null; paint(status, ''); paint(output, ''); read.disabled = false; }
  function guard(ticket) {
    if (ticket !== epoch || host.hidden || document.visibilityState === 'hidden') throw new Error('KIT_SELECTION_CHANGED');
    login.assert(binding);
    const now = getContext();
    if (now.wallet !== selected.wallet || now.tokenId !== selected.tokenId) throw new Error('KIT_SELECTION_CHANGED');
  }
  read.addEventListener('click', async () => {
    if (busy || host.hidden) return;
    clear(); const ticket = epoch; busy = true; read.disabled = true;
    try {
      const requestedPath = basePath.value, queryInstant = instant.value, origin = window.location.origin;
      await login.check(); if (ticket !== epoch) return;
      binding = login.capture(); selected = getContext(); guard(ticket);
      if (selected.wallet.reader.source.chainId.toString() !== login.assert(binding).chainId) throw new Error('KIT_CHAIN_REFUSED');
      const value = await readKitDisplay({ ...selected, instant: queryInstant, basePath: requestedPath, origin, guard: () => guard(ticket),
        compose: ({ baseUrl, chain, source, account, guard: check }) => {
          const fetch = async (url, init = {}) => {
            check();
            // SDK-generated GET routes only, no key/header forwarding or endpoint redirects.
            if (!url.startsWith(baseUrl + '/projection/') || !/^\/projection\/[0-9]+(?:\/(?:entry\/(?:version|as-of)|holder\/as-of|finality\/as-of)\/[0-9]+)?$/.test(url.slice(baseUrl.length)) ||
              init.headers !== undefined || init.method && init.method !== 'GET') throw new Error('KIT_ROUTE_REFUSED');
            const response = await window.fetch(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: init.signal });
            check();
            return { status: response.status, json: async () => { check(); const body = await response.json(); check(); return body; } };
          };
          const api = new KitProjectionApi({ baseUrl, fetch });
          const reader = new KitErc8415Reader(api, chain, source, { crossCheckIdentity: true, chainIdentity: chain });
          return new WalletSession(reader, account === undefined ? {} : { account });
        } });
      await login.check(); guard(ticket);
      const account = login.assert(binding).account;
      const parts = [privateNativeUi(renderAssetView, value.asset, account),
        privateNativeUi(renderTemporalQuery, value.temporal, account),
        privateNativeUi((notes, translate) => notes.map(translate).join('\n\n'), value.notes, account)];
      // Bind reduced display copies only; locale repaint must never retain raw wallet identities.
      paint(output, presentation(locale => parts.map(part => renderUi(part, locale)).filter(Boolean).join('\n\n')));
      readOnlyPaint(status, 'kit.ok');
    } catch {
      if (ticket === epoch) { paint(output, ''); readOnlyPaint(status, 'kit.error'); }
    } finally { if (ticket === epoch) { busy = false; read.disabled = false; } }
  });
  basePath.addEventListener('input', clear); instant.addEventListener('input', clear);
  for (const event of ['input', 'change']) document.getElementById('tokenId')?.addEventListener(event, clear);
  document.addEventListener('wallet:summary-stale', clear);
  document.addEventListener('wallet:page', event => { if (event.detail !== 'native') { clear(); basePath.value = ''; instant.value = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clear(); basePath.value = ''; instant.value = ''; } });
  window.addEventListener('pagehide', () => { clear(); basePath.value = ''; instant.value = ''; });
  window.addEventListener('pageshow', clear);
  login.subscribe(() => { clear(); basePath.value = ''; instant.value = ''; });
  return { clear };
}

