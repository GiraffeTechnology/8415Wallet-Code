/** Static test-fixture contract. No server or browser is started by this suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { enabledCompositionHtml, fixturePath, compositionEvidence, serveEnabledComposition } =
  createRequire(import.meta.url)('./helpers/enabled-composition.cjs');
const original = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const tag = (text: string, id: string) => text.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`))?.[0];
for (const name of ['assets','presentation','privacy','settlement','task']) {
  test(`explicit ${name} fixture preserves authentication/privacy and identifies its synthetic scope`, () => {
    const html = enabledCompositionHtml(original, name);
    assert.equal(tag(html, 'wallet-private'), tag(original, 'wallet-private'));
    assert.equal(tag(html, 'wallet-login'), tag(original, 'wallet-login'));
    assert.equal(tag(html, 'auth-password'), tag(original, 'auth-password'));
    assert.match(html, new RegExp(`data-test-composition="${name}"`));
    assert.equal(compositionEvidence(name).productionIntegrationAccepted, false);
    assert.equal(compositionEvidence(name).fixturePath, fixturePath(name));
    for (const module of compositionEvidence(name).extraModules) assert.equal(html.split(`src="${module}"`).length - 1, 1);
    // No auth implementation rewrite, fake session, credential or automatic API call.
    assert.equal(html.includes('<script>'), false);
    assert.equal(tag(html, 'foundation-policy-note'), tag(original, 'foundation-policy-note'));
  });
}
test('only selected task placeholders change; other services remain unopened in fixture markup', () => {
  const html = enabledCompositionHtml(original, 'task');
  assert.doesNotMatch(tag(html, 'task-authorize-form')!, /\binert\b|data-foundation-placeholder/);
  assert.equal(tag(html, 'asset-send'), tag(original, 'asset-send'));
  assert.equal(tag(html, 'settlement-send'), tag(original, 'settlement-send'));
  assert.equal(tag(html, 'tenant-avatar-file'), tag(original, 'tenant-avatar-file'));
  assert.match(original, /data-wallet-composition="foundation"/);
});
test('fixture handler never intercepts production index or auth endpoints and rejects non-loopback access', () => {
  const unexpected = () => { throw Error('RESPONSE_MUST_NOT_BE_TOUCHED'); };
  for (const url of ['/web/index.html','/','/auth/session',fixturePath('task')+'?enable=true'])
    assert.equal(serveEnabledComposition({ url }, { setHeader: unexpected, writeHead: unexpected, end: unexpected }, { composition: 'task' }), false);
  for (const request of [
    { method: 'GET', socket: { remoteAddress: '192.0.2.1' }, headers: { host: '127.0.0.1:18415' } },
    { method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:18415' } },
    { method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'wallet.example.invalid' } },
  ]) {
    let status = 0;
    assert.equal(serveEnabledComposition({ ...request, url: fixturePath('task') }, { writeHead(value: number) { status = value; }, end() {} }, { composition: 'task' }), true);
    assert.equal(status, 403);
  }
  assert.throws(() => fixturePath('../index'), /UNKNOWN_SYNTHETIC_COMPOSITION/);
  assert.throws(() => enabledCompositionHtml(original, 'arbitrary'), /UNKNOWN_SYNTHETIC_COMPOSITION/);
});
