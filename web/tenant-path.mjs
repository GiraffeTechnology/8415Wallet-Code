/** Fixed deployment routing only. A path is neither tenant discovery nor authority. */
import { walletName } from './wallet-entry.mjs';
const refuse = () => { throw Error('TENANT_PATH_BINDING_REFUSED'); };
export function tenantBasePath(tenant, basePath = '') {
  if (basePath === '') return '';
  if (!walletName(tenant) || ['v2', 'v3'].includes(tenant) || basePath !== `/${tenant}`) refuse();
  return basePath;
}
export function authRequestPath(tenant, basePath, operation) {
  tenantBasePath(tenant, basePath);
  if (typeof operation !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(operation)) refuse();
  return `${basePath}/auth/${operation}`;
}
export function authOperation(tenant, basePath, rawPath) {
  tenantBasePath(tenant, basePath);
  const prefix = `${basePath}/auth/`;
  if (typeof rawPath !== 'string' || !rawPath.startsWith(prefix)) refuse();
  const operation = rawPath.slice(prefix.length);
  if (authRequestPath(tenant, basePath, operation) !== rawPath) refuse();
  return operation;
}
export function tenantClientOptions(profile, location = globalThis.location) {
  const configured = profile?.deployment?.url;
  if (!configured) return {};
  const expected = new URL(configured);
  if (expected.pathname.endsWith('/web/index.html')) return {};
  const basePath = tenantBasePath(profile.tenant.id, expected.pathname);
  const actual = new URL(location.href);
  if (expected.origin !== actual.origin || actual.pathname !== basePath || actual.search) refuse();
  return { basePath, origin: expected.origin };
}
/** Journal migration is deliberately not implemented by URL routing. Never open
 * a fresh empty journal that hides an existing UNKNOWN operation. */
export function requireLegacyJournalLocation(moduleUrl) {
  const url = new URL(moduleUrl);
  if (url.protocol === 'file:') return; // Offline source tests, not a served origin.
  const match = url.pathname.match(/^\/([a-z][a-z0-9-]{0,47})\/web\/browser-journal-store\.mjs$/);
  if (match && !['v2', 'v3'].includes(match[1]))
    throw Error('CONTROL_TENANT_JOURNAL_MIGRATION_REQUIRED');
}
