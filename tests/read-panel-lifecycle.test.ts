import * as identityProjection from '../web/wallet-identity-display.mjs';
import * as identityI18n from '../web/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Node, fakeLogin } from './helpers/readonly-panel-harness.mjs';

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function mountPanel(kind: 'workspace' | 'hoodi') {
  const path = kind === 'workspace' ? 'asset-workspace-panel.mjs' : 'hoodi-journey-panel.mjs';
  const source = readFileSync(new URL('../web/' + path, import.meta.url), 'utf8');
  const body = source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace('export function mountAssetWorkspace', 'function mountAssetWorkspace');
  const host = new Node(), events = new Node(), windowEvents = new Node(), token = new Node();
  const account = '0x' + 'ab'.repeat(20), session = { account, chainId: '560048', tenant: 'synthetic' };
  const login = fakeLogin(session), route = kind === 'workspace' ? 'native' : 'activity';
  let gate: Promise<void> | null = null, checks = 0, reads = 0;
  login.check = async () => { checks++; if (gate) await gate; login.assert(); };
  const document = { visibilityState: 'visible',
    getElementById: (id: string) => id === 'wallet-private' ? host : id === 'tokenId' ? token : undefined,
    createElement: () => new Node(), createTextNode: (text: string) => { const node = new Node(); node.textContent = text; return node; },
    addEventListener: events.addEventListener.bind(events) };
  const context = { wallet: { reader: { source: { chainId: 560048n } } }, tokenId: 1n };
  const sandbox = { ...identityProjection, ...identityI18n, readAssetWorkspace: async () => { reads++; return { registerHistory: { state: 'ready', value: { nextVersion: null } } }; },
    renderAssetWorkspace: () => 'rendered', openHoodiJourneyRead: async () => { reads++; return {}; },
    compareHoodiReleaseHistory: async () => ({}), renderHoodiReleaseHistory: () => 'rendered' };
  const globals = { history: { state: { walletPage: route } }, addEventListener: windowEvents.addEventListener.bind(windowEvents) };
  new Function('document', 'globalThis', 'login', 'walletLogin', 'getContext', ...Object.keys(sandbox),
    body + (kind === 'workspace' ? '\nmountAssetWorkspace({ root: document.getElementById("wallet-private"), login, getContext });' : ''))(
    document, globals, login, login, () => context, ...Object.values(sandbox));
  const nodes = host.descendants(), button = nodes.find((node: any) => node.type === 'button')!;
  const output = nodes.find((node: any) => node.getAttribute('aria-live') === 'polite')!;
  const instant = nodes.find((node: any) => node.type === 'text');
  if (kind === 'workspace') instant!.value = '1';
  const input = nodes.find((node: any) => node.type === 'file');
  if (input) input.files = [{ size: 100, text: async () => JSON.stringify({ original: { manifest: { wallets: [{ account, tenant: 'synthetic' }] } }, laterV3: {} }) }] as any;
  return { host, document, events, windowEvents, route, button, output, input,
    counts: () => ({ checks, reads }), hold(value: Promise<void> | null) { gate = value; } };
}
for (const kind of ['workspace', 'hoodi'] as const) {
  test(kind + ': pending is set before login.check, including programmatic repeated clicks', async () => {
    const panel = mountPanel(kind); let release!: () => void; panel.hold(new Promise(resolve => { release = resolve; }));
    panel.button.click(); panel.button.dispatchEvent({ type: 'click' }); await flush();
    assert.equal(panel.counts().checks, 1); assert.equal(panel.button.disabled, true); assert.equal(panel.counts().reads, 0);
    panel.hold(null); release(); await flush(); assert.equal(panel.counts().reads, 1);
    assert.equal(panel.button.disabled, false); assert.equal(panel.output.textContent, 'rendered');
  });
  test(kind + ': navigation during login check prevents the read and late rendering', async () => {
    const panel = mountPanel(kind); let release!: () => void; panel.hold(new Promise(resolve => { release = resolve; }));
    panel.button.click(); await flush();
    panel.events.dispatchEvent({ type: 'wallet:page', detail: 'settings' });
    panel.hold(null); release(); await flush();
    assert.equal(panel.counts().reads, 0); assert.equal(panel.output.textContent, ''); assert.equal(panel.host.children[0].hidden, true);
    panel.events.dispatchEvent({ type: 'wallet:page', detail: panel.route });
    assert.equal(panel.button.disabled, false);
  });
  test(kind + ': hidden document refuses dispatch without authenticating or reading', async () => {
    const panel = mountPanel(kind); panel.document.visibilityState = 'hidden';
    panel.events.dispatchEvent({ type: 'visibilitychange' }); panel.button.dispatchEvent({ type: 'click' }); await flush();
    assert.deepEqual(panel.counts(), { checks: 0, reads: 0 });
    panel.document.visibilityState = 'visible'; panel.events.dispatchEvent({ type: 'visibilitychange' });
    assert.equal(panel.button.disabled, false);
  });
  test(kind + ': pagehide invalidates pending work and pageshow refreshes controls', async () => {
    const panel = mountPanel(kind); let release!: () => void; panel.hold(new Promise(resolve => { release = resolve; }));
    panel.button.click(); await flush(); panel.windowEvents.dispatchEvent({ type: 'pagehide' });
    panel.hold(null); release(); await flush(); assert.equal(panel.counts().reads, 0);
    panel.windowEvents.dispatchEvent({ type: 'pageshow' }); assert.equal(panel.button.disabled, false);
    assert.equal(panel.output.textContent, '');
  });
}
test('Hoodi: new evidence selection releases pending UI but discards the earlier login continuation', async () => {
  const panel = mountPanel('hoodi'); let release!: () => void; panel.hold(new Promise(resolve => { release = resolve; }));
  panel.button.click(); await flush(); panel.input!.dispatchEvent({ type: 'change' }); panel.hold(null);
  assert.equal(panel.button.disabled, false); panel.button.click(); await flush();
  assert.equal(panel.counts().reads, 1); release(); await flush(); assert.equal(panel.counts().reads, 1);
  assert.equal(panel.output.textContent, 'rendered');
});
