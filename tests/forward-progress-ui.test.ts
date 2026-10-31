import {NFT_BROWSER_TEXT} from '../web/locales/nft-browser.mjs';
import {coordinationLines,appendCoordinationView,appendForwardTracks} from '../web/coordination-render.mjs';
/** Synthetic DOM/HTTP definitions only; no real provider or credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Node, fakeLogin } from './helpers/readonly-panel-harness.mjs';
import { FORWARD_PROGRESS_TEXT } from '../web/locales/forward-progress.mjs';
import { forwardProgressRequest, validateForwardProgress } from '../web/forward-progress-client.mjs';
import { AccountAuthClient } from '../web/account-auth.mjs';
const asset = { chainId: '560048', contract: '0x' + '1'.repeat(40), tokenId: '1' }, sequenceId = '0x' + '2'.repeat(64);
const input = { asset, sequenceId };
const progress = () => {
  const track = () => ({ state: 'observed', position: '1', changedThrough: '1', unchangedThrough: '2',
    untradedThrough: '3', ratio: { numerator: '1', denominator: '3' } });
  return { schema: '8415-forward-progress/1', asset, sequenceId, userPosition: '1', sourceRevision: '2',
    blockNumber: '3', blockHash: '0x' + '3'.repeat(64), knownEnd: '2', scaleEnd: '3', state: 'DONE',
    owner: track(), holder: track(), funds: { state: 'not-evaluated' }, rollback: { state: 'not-evaluated' },
    protocolFinality: false, commercialExecution: 'not-evaluated', canExecute: false, recordRevision: '1', frozen: true };
};
test('contract accepts only bound own-occurrence progress, rejecting extra identity fields', () => {
  assert.deepEqual(forwardProgressRequest(input, '560048'), input);
  assert.equal(validateForwardProgress(progress(), input).state, 'DONE');
  for (const mutate of [
    (p: any) => { p.adjacentAccount = 'private'; },
    (p: any) => { p.owner.account = 'private'; },
    (p: any) => { p.asset = { ...asset, tokenId: '2' }; },
    (p: any) => { p.sequenceId = '0x' + '4'.repeat(64); },
    (p: any) => { p.canExecute = true; },
    (p: any) => { p.holder.position = '2'; p.holder.changedThrough = '2'; p.holder.ratio.numerator = '2'; },
    (p: any) => { p.funds.state = 'paid'; },
  ]) { const value = progress(); mutate(value); assert.throws(() => validateForwardProgress(value, input), /RESPONSE_REFUSED/); }
  assert.throws(() => forwardProgressRequest(input, '1'), /RESPONSE_REFUSED/);
});
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function mount(available = true) {
  const root = new Node(), events = new Node(), window = new Node(), locale = new Node(), sequence = new Node();
  locale.value = 'en';
  const login = fakeLogin(), source = readFileSync(new URL('../web/forward-progress-panel.mjs', import.meta.url), 'utf8');
  const document = { documentElement: { lang: 'en' }, visibilityState: 'visible',
    querySelector: () => locale, getElementById: () => sequence, createElement: () => new Node(),
    addEventListener: events.addEventListener.bind(events) };
  let checks = 0, reads = 0, holdCheck: Promise<void> | null = null, holdRead: Promise<void> | null = null;
  login.check = async () => { checks++; if (holdCheck) await holdCheck; login.assert(); };
  const client = { async readForwardProgress() { reads++; if (holdRead) await holdRead; return progress(); } };
  const body = source.replace(/^import[^\n]*\n/gm, '').replace('export function mountForwardProgress', 'function mountForwardProgress');
  new Function('document','globalThis','FORWARD_PROGRESS_TEXT','NFT_BROWSER_TEXT','coordinationLines','appendCoordinationView','appendForwardTracks','config', body + '\nmountForwardProgress(config);')(
    document, { history: { state: { walletPage: 'linked' } }, addEventListener: window.addEventListener.bind(window) },
    FORWARD_PROGRESS_TEXT,NFT_BROWSER_TEXT,coordinationLines,appendCoordinationView,appendForwardTracks, { root, login, clientFor: () => client, available: () => available, selection: () => input });
  const nodes = root.descendants();
  return { root, events, window, locale, login, document,
    button: nodes.find((n: any) => n.type === 'button')!,
    output: nodes.find((n: any) => n.getAttribute('role') === 'status')!,
    counts: () => ({ checks, reads }), holdCheck(p: Promise<void> | null) { holdCheck = p; }, holdRead(p: Promise<void> | null) { holdRead = p; } };
}
test('unopened backend entry makes zero authentication and business requests', async () => {
  const f = mount(false); f.button.dispatchEvent({ type: 'click' }); await flush();
  assert.equal(f.button.disabled, true); assert.deepEqual(f.counts(), { checks: 0, reads: 0 });
});
test('double dispatch locks before first await and shows own progress without payment/finality completion', async () => {
  const f = mount(); let release!: () => void; f.holdCheck(new Promise(resolve => { release = resolve; }));
  f.button.click(); f.button.dispatchEvent({ type: 'click' }); await flush();
  assert.deepEqual(f.counts(), { checks: 1, reads: 0 });
  f.holdCheck(null); release(); await flush(); assert.equal(f.counts().reads, 1);
  assert.match(f.output.textContent, /DONE/); assert.match(f.output.textContent, /1\/3/);
  assert.match(f.output.textContent, /Funds not evaluated/); assert.match(f.output.textContent, /Protocol finality: No/);
  assert.equal(f.output.textContent.includes(asset.contract), false);
});
for (const kind of ['navigation','logout','pagehide'] as const) test(kind + ' discards late result', async () => {
  const f = mount(); let release!: () => void; f.holdRead(new Promise(resolve => { release = resolve; }));
  f.button.click(); await flush(); assert.equal(f.counts().reads, 1);
  if (kind === 'navigation') f.events.dispatchEvent({ type: 'wallet:page', detail: 'settings' });
  else if (kind === 'logout') f.login.logout();
  else f.window.dispatchEvent({ type: 'pagehide' });
  f.holdRead(null); release(); await flush(); assert.equal(f.output.textContent.includes('DONE'), false);
  f.button.dispatchEvent({ type: 'click' }); await flush(); assert.equal(f.counts().reads, 1);
});
test('all six actual menu locales have fixed copy; unsupported locale does not fall back to English', () => {
  assert.deepEqual(Object.keys(FORWARD_PROGRESS_TEXT).sort(), ['en','es','fr','ja','zh-Hans','zh-Hant'].sort());
  const f = mount();
  for (const locale of Object.keys(FORWARD_PROGRESS_TEXT)) {
    f.locale.value = locale; f.locale.dispatchEvent({ type: 'change' });
    assert.equal(f.output.textContent, FORWARD_PROGRESS_TEXT[locale as keyof typeof FORWARD_PROGRESS_TEXT][2]);
  }
  f.locale.value = 'unknown'; f.locale.dispatchEvent({ type: 'change' });
  assert.equal(f.output.textContent, ''); assert.equal(f.button.disabled, true);
});
test('account client reuses same-origin session CSRF and does not probe capabilities while reading', async () => {
  const calls: { path: string; options: any }[] = [], origin = 'https://wallet.example.invalid', tenant = 'synthetic';
  const client = new AccountAuthClient({ origin, tenant, fetcher: async (url: URL, options: any) => {
    const path = url.pathname.slice('/auth/'.length); calls.push({ path, options });
    const data = path === 'capabilities' ? { schema: '8415wallet-auth/1', origin, tenant, methods: ['password'] } :
      path === 'bootstrap' ? { csrf: 'synthetic-preauth' } :
      path === 'password' ? { origin, tenant, username: 'alice', account: '0x' + '5'.repeat(40), chainId: '560048', csrf: 'synthetic-csrf' } : progress();
    return { ok: true, text: async () => JSON.stringify(data) };
  } });
  await assert.rejects(client.readForwardProgress(input), /LOGIN_REQUIRED/); assert.equal(calls.length, 0);
  await client.adapter('password', { username: 'alice', password: 'synthetic' }).authenticate({ account: '0x' + '5'.repeat(40), chainId: '560048' }, null);
  calls.length = 0; await client.readForwardProgress(input);
  assert.equal(calls.length, 1); assert.equal(calls[0]!.path, 'assets/forward-progress');
  assert.equal(calls[0]!.options.headers['X-Wallet-CSRF'], 'synthetic-csrf');
  assert.equal(calls[0]!.options.credentials, 'same-origin'); assert.equal(calls[0]!.options.cache, 'no-store');
  assert.deepEqual(JSON.parse(calls[0]!.options.body), input);
});
