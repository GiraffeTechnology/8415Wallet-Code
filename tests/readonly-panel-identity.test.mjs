/** Regression definitions only. NOT_RUN in the audit environment.
 * Synthetic DOM/read seams; no provider, sockets, credentials or chain calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as i18n from '../web/i18n.mjs';
import { privateNativeUi } from '../web/wallet-identity-display.mjs';
import { readOnlyPaint, readOnlyLabel } from '../web/readonly-i18n.mjs';
import { harness, fakeLogin, declarationFile } from './helpers/readonly-panel-harness.mjs';

const self = '0x' + '11'.repeat(20), adjacent = '0x' + '22'.repeat(20), contract = '0x' + '33'.repeat(20);
const drain = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const render = view => JSON.stringify(view);
function fixture(kind) {
  const h = harness(), login = fakeLogin({ account: self, chainId: '1' });
  const raw = { identity: { address: contract }, holder: adjacent, owner: self,
    walletName: 'Private adjacent wallet', note: 'Holder ' + adjacent, amount: '9007199254740993' };
  const original = structuredClone(raw);
  let reject = false, reads = 0;
  const result = kind === 'kit' ? { asset: raw, temporal: raw, notes: ['Observed holder ' + adjacent] } :
    { temporal: raw, assertedCurrentFeed: { chainId: '1', address: contract, assetId: 'feed-id' },
      freshness: {}, notes: [], tradingObservation: { interpretation: 'insufficient-observation' } };
  const read = async () => { reads++; if (reject) throw Error('read refused'); return result; };
  const imports = { ...i18n, privateNativeUi, readOnlyPaint, readOnlyLabel,
    renderAssetView: render, renderTemporalQuery: render, renderFreshness: () => 'Freshness UNKNOWN',
    readKitDisplay: read, readWatchtowerComparison: read };
  const name = kind === 'kit' ? 'mountKitRead' : 'mountWatchtowerRead';
  const source = readFileSync(new URL(`../web/${kind === 'kit' ? 'kit-read' : 'watchtower-read'}-panel.mjs`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\n/gm, '').replace(`export function ${name}`, `function ${name}`);
  const mount = new Function(...Object.keys(imports), source + `\nreturn ${name};`)(...Object.values(imports));
  const handle = mount({ root: h.root, login, getContext: () => h.context, document: h.document, window: h.window });
  const panel = h.host.children[0], [ , , firstLabel, secondLabel, button, , output] = panel.children;
  if (kind === 'kit') firstLabel.children.at(-1).value = '/kit';
  else firstLabel.children.at(-1).files = [declarationFile()];
  secondLabel.children.at(-1).value = '100';
  return { h, login, handle, button, output, raw, original, reads: () => reads, reject() { reject = true; } };
}
for (const kind of ['kit', 'watchtower']) {
  test(`${kind}: actual successful mount privacy-filters output before locale binding`, async () => {
    i18n.setLocale('en', { persist: false });
    const f = fixture(kind);
    try {
      f.button.click(); await drain(); assert.equal(f.reads(), 1);
      for (const { id } of i18n.LOCALES) {
        i18n.setLocale(id, { persist: false });
        assert.ok(f.output.textContent.includes(contract));
        assert.ok(f.output.textContent.includes('9007199254740993'));
        for (const secret of [self, adjacent, 'Private adjacent wallet', '[wallet:']) assert.ok(!f.output.textContent.includes(secret));
      }
      assert.deepEqual(f.raw, f.original, 'canonical read facts must stay exact');
    } finally { f.handle.clear(); i18n.setLocale('en', { persist: false }); }
  });
  for (const event of ['selection', 'logout', 'navigation', 'pagehide', 'hidden']) {
    test(`${kind}: ${event} clears display binding, so locale changes cannot resurrect it`, async () => {
      const f = fixture(kind);
      try {
        f.button.click(); await drain(); assert.ok(f.output.textContent);
        if (event === 'selection') f.h.byId.get('tokenId').dispatchEvent({ type: 'input' });
        if (event === 'logout') f.login.logout();
        if (event === 'navigation') f.h.documentEvents.dispatchEvent({ type: 'wallet:page', detail: 'settings' });
        if (event === 'pagehide') f.h.windowEvents.dispatchEvent({ type: 'pagehide' });
        if (event === 'hidden') { f.h.document.visibilityState = 'hidden'; f.h.documentEvents.dispatchEvent({ type: 'visibilitychange' }); }
        for (const { id } of i18n.LOCALES) { i18n.setLocale(id, { persist: false }); assert.equal(f.output.textContent, ''); }
      } finally { f.handle.clear(); i18n.setLocale('en', { persist: false }); }
    });
  }
  test(`${kind}: failed refresh clears successful output and its cached locale binding`, async () => {
    const f = fixture(kind);
    try {
      f.button.click(); await drain(); assert.ok(f.output.textContent);
      f.reject(); f.button.click(); await drain(); assert.equal(f.reads(), 2);
      for (const { id } of i18n.LOCALES) { i18n.setLocale(id, { persist: false }); assert.equal(f.output.textContent, ''); }
    } finally { f.handle.clear(); i18n.setLocale('en', { persist: false }); }
  });
}
