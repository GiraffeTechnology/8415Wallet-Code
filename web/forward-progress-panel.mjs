import {NFT_BROWSER_TEXT} from './locales/nft-browser.mjs';
import {coordinationLines,appendCoordinationView,appendForwardTracks} from './coordination-render.mjs';
/** Human read-only UI. Agent execution remains API-only. */
import { FORWARD_PROGRESS_TEXT } from './locales/forward-progress.mjs';
export function mountForwardProgress({ root, login, clientFor, available, selection }) {
  if (!root) return;
  const section = document.createElement('section'); section.className = 'card';
  const title = document.createElement('h3'), load = document.createElement('button'), output = document.createElement('p'), note = document.createElement('p');
  load.type = 'button'; output.setAttribute('role', 'status'); output.setAttribute('aria-live', 'polite');
  const graphics=document.createElement('div');section.append(title, load, output, note,graphics); root.append(section);
  let epoch = 0, pending = false, result = null, active = true, page = globalThis.history?.state?.walletPage ?? 'overview';
  const words = () => FORWARD_PROGRESS_TEXT[document.querySelector('[data-ui-locale-select]')?.value ?? document.documentElement.lang] ?? null;
  const usable = () => {
    try { login.assert(); selection(); return active && page === 'linked' && document.visibilityState !== 'hidden' && available() === true && clientFor() !== null; }
    catch { return false; }
  };
  const draw = () => {
    graphics.replaceChildren();const text = words(); section.hidden = page !== 'linked' || text === null;
    load.disabled = pending || !usable() || text === null;
    if (!text) { title.textContent = ''; load.textContent = ''; note.textContent = ''; output.textContent = ''; return; }
    title.textContent = text[0]; load.textContent = text[1]; note.textContent = text[13];
    if (!result) { output.textContent = text[2]; return; }
    const track = value => value.position === null ? text[2] : value.position + '/' + result.scaleEnd;
    output.textContent = [
      result.state === 'DONE' ? text[5] : result.state === 'PENDING' ? text[6] : text[2],
      text[3] + ': ' + track(result.owner), text[4] + ': ' + track(result.holder),
      ...(result.schema==='8415-forward-progress/2'?coordinationLines(result,document.querySelector('[data-ui-locale-select]')?.value??document.documentElement.lang):[text[7],text[8]]), text[9] + ': ' + (result.protocolFinality === null ? text[10] : result.protocolFinality ? text[11] : text[12])
    ].join(' · ');
    const locale=document.querySelector('[data-ui-locale-select]')?.value??document.documentElement.lang,labels=NFT_BROWSER_TEXT[locale]??NFT_BROWSER_TEXT.en;
    appendForwardTracks(graphics,result,document,[text[3],text[4],labels[56],labels[57],labels[58]]);
    if(result.schema==='8415-forward-progress/2')appendCoordinationView(graphics,result,document,locale,false);
  };
  const clear = () => { epoch++; pending = false; result = null; draw(); };
  login.subscribe(clear);
  for (const event of ['wallet:summary-stale','wallet:authentication-settings','wallet:authentication-method','wallet:account-features','visibilitychange']) document.addEventListener(event, clear);
  document.addEventListener('wallet:page', event => { page = event.detail; clear(); });
  globalThis.addEventListener('pagehide', () => { active = false; clear(); });
  globalThis.addEventListener('pageshow', () => { active = true; clear(); });
  for (const id of ['sequenceId','tokenId','deployment']) for (const event of ['input','change'])
    document.getElementById(id)?.addEventListener(event, clear);
  document.querySelector('[data-ui-locale-select]')?.addEventListener('change', draw);
  load.addEventListener('click', async () => {
    if (pending || !usable()) return;
    const generation = ++epoch, client = clientFor(), binding = login.capture(), input = selection();
    pending = true; result = null; draw();
    try {
      await login.check(); login.assert(binding);
      if (generation !== epoch || !usable() || client !== clientFor() || JSON.stringify(input) !== JSON.stringify(selection())) return;
      const value = await client.readForwardProgress(input); login.assert(binding);
      if (generation !== epoch || !usable() || client !== clientFor() || JSON.stringify(input) !== JSON.stringify(selection())) return;
      result = value;
    } catch { if (generation === epoch) result = null; }
    finally { if (generation === epoch) { pending = false; draw(); } }
  });
  draw();
}
