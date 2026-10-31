/** Review-only candidate renderer. Does not install, start, reload or migrate. */
import { createRequire } from 'node:module';
import { walletName } from '../../web/wallet-entry.mjs';
import { tenantBasePath } from '../../web/tenant-path.mjs';
const { canonicalEntryHtml } = createRequire(import.meta.url)('../../scripts/controls/canonical-entry.cjs');
const refuse = () => { throw Error('TENANT_ROUTE_REGISTRY_REQUIRED'); };
export function renderTenantPathCandidate({ tenant, origin, socketPath, staticRoot, html, registry }) {
  const basePath = tenantBasePath(tenant, `/${tenant}`);
  const url = new URL(origin);
  // The trusted registry binds the exact existing origin, including its port.
  // Never choose/migrate an origin or port. Reserved-port policy is retained in
  // the reviewed deployment. No listener/cert/DNS directives are generated.
  if (url.origin !== origin || url.protocol !== 'https:' || url.hostname !== '8415wallet.com' ||
      url.username || url.password) refuse();
  if (!registry || registry.origin !== origin || registry.schema !== '8415wallet-private-route-registry/1' ||
      !Array.isArray(registry.defaultWalletNames) || !Array.isArray(registry.routes) ||
      !/^[a-f0-9]{64}$/.test(registry.authoritativeAccountSnapshotSha256 ?? '')) refuse();
  const names = new Set();
  for (const name of registry.defaultWalletNames) {
    if (!walletName(name) || names.has(name)) refuse(); names.add(name);
  }
  const seen = new Set(); let selected = false;
  for (const route of registry.routes) {
    if (!route || route.owner !== 'isolated-tenant' || route.path !== `/${route.tenant}` || tenantBasePath(route.tenant, route.path) !== route.path ||
        seen.has(route.path) || names.has(route.tenant)) refuse();
    seen.add(route.path); if (route.path === basePath && route.tenant === tenant) selected = true;
  }
  if (!selected) refuse();
  if (typeof staticRoot !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(staticRoot) ||
      typeof socketPath !== 'string' || !/^\/run\/[A-Za-z0-9_-]+\/auth\.sock$/.test(socketPath)) refuse();
  if (typeof html !== 'string' || !html.includes("base-uri 'none'")) refuse();
  const nginx = `# REVIEW ONLY: preserve existing TLS listener, host and original store.
# Unified trusted static code only. No tenant-authored HTML/JS. No generic fallback.
location = ${basePath} {
    if ($request_uri != "${basePath}") { return 404; }
    alias ${staticRoot}/tenant-entry.html;
    default_type text/html;
    add_header Cache-Control "no-store";
}
location ^~ ${basePath}/auth/ {
    if ($request_uri !~ "^${basePath}/auth/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$") { return 404; }
    proxy_pass http://unix:${socketPath}:;
    proxy_set_header Host $http_host;
    proxy_set_header X-Wallet-Tenant $http_x_wallet_tenant;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-Wallet-CSRF $http_x_wallet_csrf;
    proxy_set_header X-Authenticated-User "";
    proxy_set_header X-Verified-Wallet "";
    proxy_connect_timeout 3s;
    proxy_read_timeout 15s;
    proxy_send_timeout 15s;
    client_max_body_size 100k;
    proxy_buffering off;
    proxy_cache off;
    access_log off;
}
` + ['web', 'dist/browser'].map(directory => `location ^~ ${basePath}/${directory}/ {
    if ($request_uri !~ "^${basePath}/${directory}/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$") { return 404; }
    if ($request_uri ~ "\\.html$") { return 404; }
    alias ${staticRoot}/${directory}/;
    autoindex off;
}
`).join('');
  return Object.freeze({ basePath, entryUrl: origin + basePath,
    authConfigPatch: Object.freeze({ origin, tenant, basePath }),
    entryHtml: canonicalEntryHtml(html, `${basePath}/web/index.html`), nginx,
    status: 'REVIEW_ONLY_NOT_DEPLOYED_JOURNAL_MIGRATION_REQUIRED' });
}
