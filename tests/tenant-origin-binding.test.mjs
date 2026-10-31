import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTenantPathCandidate } from '../deploy/auth-runtime/tenant-path-candidate.mjs';
const html = readFileSync(new URL('../web/index-v3.html', import.meta.url), 'utf8');
function input(origin) {
  return { tenant: 'example-one', origin, html, socketPath: '/run/example-auth/auth.sock', staticRoot: '/opt/example-static',
    registry: { schema: '8415wallet-private-route-registry/1', origin, authoritativeAccountSnapshotSha256: 'a'.repeat(64),
      defaultWalletNames: [], routes: [{ owner: 'isolated-tenant', tenant: 'example-one', path: '/example-one' }] } };
}
test('renderer preserves an explicitly registered default or alternate HTTPS origin without choosing a listener', () => {
  for (const origin of ['https://8415wallet.com', 'https://8415wallet.com:8443']) {
    const result = renderTenantPathCandidate(input(origin));
    assert.equal(result.entryUrl, origin + '/example-one');
    assert.equal(result.authConfigPatch.origin, origin);
    assert.doesNotMatch(result.nginx, /^\s*(?:listen|ssl_certificate)\b/m);
  }
});
test('renderer refuses absent, mismatched and noncanonical registry origin instead of port fallback', () => {
  const value = input('https://8415wallet.com:8443');
  for (const origin of [undefined, null, 'https://8415wallet.com', 'https://8415wallet.com:8444', 'https://8415wallet.com:8443/']) {
    assert.throws(() => renderTenantPathCandidate({ ...value, registry: { ...value.registry, origin } }), /TENANT_ROUTE_REGISTRY_REQUIRED/);
  }
});
test('registry origin does not relax HTTPS, product host or collision checks', () => {
  for (const origin of ['http://8415wallet.com', 'https://other.example.invalid', 'https://user@8415wallet.com', 'https://8415wallet.com/path']) {
    assert.throws(() => renderTenantPathCandidate(input(origin)), /TENANT_ROUTE_REGISTRY_REQUIRED/);
  }
  const value = input('https://8415wallet.com');
  assert.throws(() => renderTenantPathCandidate({ ...value, registry: { ...value.registry, defaultWalletNames: ['example-one'] } }), /TENANT_ROUTE_REGISTRY_REQUIRED/);
});
