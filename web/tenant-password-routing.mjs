/** No anonymous wallet directory or name-to-endpoint oracle. */
const fail = () => { throw Error('PASSWORD_ROUTING_UNAVAILABLE'); };
export const PASSWORD_PANELS = Object.freeze({ initial: '#auth-initial', manage: '#auth-manage' });
// Validate only an already configured wallet's own exact endpoint. This never
// derives a destination from a name typed at the public platform entry.
function tenantEndpoint(tenant, value) {
  if (typeof tenant !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(tenant) || typeof value !== 'string' || value.length > 2048) fail();
  let url; try { url = new URL(value); } catch { fail(); }
  const authority = value.match(/^https:\/\/([^/:?#]+)(?::([1-9][0-9]{0,4}))?(\/[^?#]*)$/);
  if (!authority || authority[1] !== tenant + '.8415wallet.com' ||
      (authority[2] && Number(authority[2]) > 65535) || url.protocol !== 'https:' ||
      url.hostname !== tenant + '.8415wallet.com' || url.username || url.password || url.search || url.hash ||
      /[\\\s%]/.test(value) || authority[3] !== url.pathname || !url.pathname.endsWith('/web/index.html') || url.pathname.includes('//')) fail();
  return url;
}
export function isPlatformPasswordProfile(profile) {
  return profile.tenant.id === 'default' && !!profile.deployment.url && new URL(profile.deployment.url).hostname === '8415wallet.com';
}
export function passwordPanelAction(profile, location) {
  const action = Object.keys(PASSWORD_PANELS).find(key => PASSWORD_PANELS[key] === location.hash);
  if (!action || profile.tenant.id === 'default' || !['v2', 'v3'].includes(profile.id)) return null;
  let actual, expected;
  try { actual = new URL(location.href); expected = tenantEndpoint(profile.tenant.id, profile.deployment.url); }
  catch { return null; }
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.search) return null;
  return action;
}
export function validatePasswordRoutes(value) {
  // Keep the historical packaged path as an empty tombstone. Reject even a
  // correctly formed legacy directory instead of republishing its existence.
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'entries,schema' || value.schema !== '8415wallet-password-routing/1' ||
      !Array.isArray(value.entries) || value.entries.length !== 0) fail();
  return Object.freeze([]);
}
export function passwordTenantDestination() { fail(); }
export async function loadPasswordRoutes() {
  // No network, credentials, redirects, fallback or per-name probing. A future
  // protected resolver needs its own authenticated principal-bound contract.
  return Object.freeze([]);
}
