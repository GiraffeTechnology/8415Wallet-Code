import { RpcWatchtowerReader, Eip1193ReadTransport, buildFreshnessView,
  renderFreshness, renderTemporalQuery } from '../dist/browser/browser.js';
import { readWatchtowerComparison } from './watchtower-read.mjs';

/** Explicit read through the selected provider only; no endpoint, auto-poll, signer or persistence. */
export function mountWatchtowerRead({ root, login, getContext, document = globalThis.document, window = globalThis }) {
  const host = root?.querySelector('[data-page="native"]'); if (!host) return;
  const panel = document.createElement('section'); panel.className = 'card';
  const heading = document.createElement('h2'); heading.textContent = 'Optional watchtower freshness';
  const help = document.createElement('p');
  help.textContent = 'Read the current asserted feed from an existing continuity declaration, through your selected provider. Feed pairing remains UNVERIFIED. Freshness is not projection finality; no watchtower is required for standalone use.';
  const fileLabel = document.createElement('label'); fileLabel.textContent = 'Existing feed declaration JSON (up to 16 KiB)';
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.json,application/json'; fileLabel.append(file);
  const instantLabel = document.createElement('label'); instantLabel.textContent = 'Projection query instant (Unix seconds)';
  const instant = document.createElement('input'); instant.type = 'text'; instant.inputMode = 'numeric'; instantLabel.append(instant);
  const read = document.createElement('button'); read.type = 'button'; read.textContent = 'Read projection and optional current feed';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const projection = document.createElement('pre'), feedOutput = document.createElement('pre');
  for (const output of [projection, feedOutput]) { output.style.whiteSpace = 'pre-wrap'; output.style.overflowWrap = 'anywhere'; }
  panel.append(heading, help, fileLabel, instantLabel, read, status, projection, feedOutput); host.append(panel);
  let epoch = 0, busy = false, binding = null, selected = null;
  function clear() {
    epoch++; busy = false; binding = null; selected = null;
    projection.textContent = ''; feedOutput.textContent = ''; status.textContent = ''; read.disabled = false;
  }
  function guard(ticket) {
    if (ticket !== epoch || host.hidden || document.visibilityState === 'hidden') throw new Error('WATCHTOWER_SELECTION_CHANGED');
    login.assert(binding);
    const now = getContext();
    if (now.wallet !== selected.wallet || now.tokenId !== selected.tokenId || now.provider !== selected.provider) throw new Error('WATCHTOWER_SELECTION_CHANGED');
  }
  read.addEventListener('click', async () => {
    if (busy || host.hidden) return;
    clear(); const ticket = epoch; busy = true; read.disabled = true;
    try {
      const chosen = file.files?.[0], queryInstant = instant.value;
      if (!chosen || chosen.size > 16384) throw new Error('WATCHTOWER_DECLARATION_REQUIRED');
      await login.check(); if (ticket !== epoch) return;
      binding = login.capture(); selected = getContext(); guard(ticket);
      const text = await chosen.text(); guard(ticket);
      // Guard every provider request, including the transport's chain checks.
      const provider = { request: async request => {
        guard(ticket);
        if (!['eth_chainId', 'eth_call'].includes(request.method)) throw new Error('WATCHTOWER_RPC_REFUSED');
        const result = await selected.provider.request(request); guard(ticket); return result;
      } };
      const value = await readWatchtowerComparison({ ...selected, text, instant: queryInstant, guard: () => guard(ticket),
        readFreshness: async (feed, registerId) => {
          guard(ticket);
          if (feed.chainId !== selected.wallet.reader.source.chainId.toString() || feed.chainId !== login.assert(binding).chainId) throw new Error('WATCHTOWER_CHAIN_REFUSED');
          const transport = new Eip1193ReadTransport(provider, BigInt(feed.chainId));
          const reader = new RpcWatchtowerReader(transport, BigInt(feed.chainId), feed.address);
          return buildFreshnessView({ reader, assetId: feed.assetId, provenance: 'configured', claimedRegisterId: registerId });
        } });
      await login.check(); guard(ticket);
      projection.textContent = renderTemporalQuery(value.temporal);
      feedOutput.textContent = [
        `Asserted feed: chain ${value.assertedCurrentFeed.chainId} / ${value.assertedCurrentFeed.address} / ${value.assertedCurrentFeed.assetId}`,
        'Register/feed pairing: UNVERIFIED_CONFIGURATION. Predecessor links: UNVERIFIED, not queried.',
        renderFreshness(value.freshness), ...value.notes,
      ].join('\n\n');
      status.textContent = 'Sequential current reads, not an atomic or historical-chain snapshot. No runtime configuration changed; no action is authorized.';
    } catch {
      if (ticket === epoch) { projection.textContent = ''; feedOutput.textContent = '';
        status.textContent = 'Observation unavailable. Check the selected projection, exact declaration and same-chain provider. No cached result or predecessor status substituted.'; }
    } finally { if (ticket === epoch) { busy = false; read.disabled = false; } }
  });
  file.addEventListener('change', clear); instant.addEventListener('input', clear);
  for (const event of ['input', 'change']) document.getElementById('tokenId')?.addEventListener(event, clear);
  document.addEventListener('wallet:summary-stale', clear);
  document.addEventListener('wallet:page', event => { if (event.detail !== 'native') { clear(); file.value = ''; instant.value = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clear(); file.value = ''; instant.value = ''; } });
  window.addEventListener('pagehide', () => { clear(); file.value = ''; instant.value = ''; });
  window.addEventListener('pageshow', clear);
  login.subscribe(() => { clear(); file.value = ''; instant.value = ''; });
  return { clear };
}
