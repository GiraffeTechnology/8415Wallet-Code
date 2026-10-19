import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as routing from '../web/tenant-password-routing.mjs';
import { resolveReleaseProfile, verifyReleaseLocation } from '../web/release-profile.mjs';
const file = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const defaults = () => JSON.parse(file('web/tenant-password-routing.json'));
const profile = (tenant = 'example', endpoint = 'https://example.8415wallet.com:18443/wallet/web/index.html') => resolveReleaseProfile({
  schema: '8415wallet-release/1', product: '8415wallet', platform: '8415wallet.com', profile: 'v3',
  tenant: { id: tenant, label: tenant }, deployment: { environment: 'other', url: endpoint }
});
test('packaged public path is an empty tombstone with no fixed wallet directory', () => {
  assert.deepEqual(defaults(), { schema: '8415wallet-password-routing/1', entries: [] });
  assert.deepEqual(routing.validatePasswordRoutes(defaults()), []);
  assert.equal(Object.hasOwn(routing, 'PASSWORD_TENANTS'), false);
  assert.doesNotMatch(file('web/tenant-password-routing.mjs'), /PASSWORD_TENANTS|new Set/);
});
for (const name of ['', 'example', 'unknown', 'default', 'constructor', '../wallet', 'wallet.example.invalid']) {
  test('name entry is uniformly unavailable: ' + name, () => {
    for (const action of ['initial', 'manage', 'constructor', 'other']) {
      assert.throws(() => routing.passwordTenantDestination([], name, action), { message: 'PASSWORD_ROUTING_UNAVAILABLE' });
    }
  });
}
test('legacy full directories and malformed tombstones are refused without distinguishing readiness', () => {
  for (const value of [null, {}, { ...defaults(), extra: true }, { ...defaults(), schema: 'other' },
    { ...defaults(), entries: [{ tenant: 'example', url: null, passwordManagementReady: false }] },
    { ...defaults(), entries: [{ tenant: 'example', url: 'https://example.8415wallet.com/web/index.html', passwordManagementReady: true }] }]) {
    assert.throws(() => routing.validatePasswordRoutes(value), { message: 'PASSWORD_ROUTING_UNAVAILABLE' });
  }
});
test('loading routes performs no request, fallback, redirect or existence probe', async () => {
  let calls = 0;
  const result = await routing.loadPasswordRoutes(() => { calls++; throw Error('Network must not run'); });
  assert.deepEqual(result, []); assert.equal(calls, 0); assert.ok(Object.isFrozen(result));
});
for (const endpoint of ['https://example.8415wallet.com/web/index.html',
  'https://example.8415wallet.com:443/release/web/index.html',
  'https://example.8415wallet.com:28443/nested/v3/web/index.html']) {
  test('existing wallet exact endpoint remains usable: ' + endpoint, () => {
    const own = profile('example', endpoint);
    for (const action of ['initial', 'manage']) {
      const location = new URL(endpoint + '#auth-' + action);
      assert.equal(routing.passwordPanelAction(own, location), action);
      assert.equal(verifyReleaseLocation(own, location), own);
      for (const change of [url => { url.port = '38443'; }, url => { url.pathname = '/wrong/web/index.html'; },
        url => { url.hostname = 'other.8415wallet.com'; }, url => { url.search = '?tenant=other'; }]) {
        const mismatch = new URL(location); change(mismatch);
        assert.equal(routing.passwordPanelAction(own, mismatch), null);
        assert.throws(() => verifyReleaseLocation(own, mismatch), /MISMATCH/);
      }
    }
  });
}
test('platform and unknown fragments never become local wallet management authority', () => {
  const own = profile(), platform = profile('default', 'https://8415wallet.com/platform/web/index.html');
  for (const location of ['https://example.8415wallet.com:18443/wallet/web/index.html#other',
    'https://example.8415wallet.com:18443/wallet/web/index.html#auth-initial?tenant=other']) {
    assert.equal(routing.passwordPanelAction(own, new URL(location)), null);
  }
  assert.equal(routing.passwordPanelAction(platform, new URL(platform.deployment.url + '#auth-initial')), null);
});
test('public markup uses an unpopulated name input and UI never resolves it', () => {
  const html = file('web/index.html'), ui = file('web/tenant-password-ui.mjs');
  assert.match(html, /<input id="password-tenant-select"[^>]+autocomplete="off"/);
  assert.doesNotMatch(html, /<select id="password-tenant-select"|<datalist/);
  assert.doesNotMatch(ui, /fetch|loadPasswordRoutes|passwordTenantDestination|localStorage|sessionStorage|postMessage/);
  assert.match(ui, /walletUiBusy\(\)/);
  assert.match(html, /referrerpolicy="no-referrer"/);
});
