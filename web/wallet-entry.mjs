/** A public identifier is intent, not wallet membership or navigation authority. */
const reserved = new Set(['auth', 'api', 'web', 'assets', 'dist', 'docs', 'scripts', 'server', 'tests', 'config', 'login', 'logout', 'register', 'about', 'settings', 'default', '__proto__', 'constructor', 'prototype']);
export function walletName(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value) && !reserved.has(value);
}
export function walletPath(value) {
  return typeof value === 'string' && value.startsWith('/') && walletName(value.slice(1)) ? value : null;
}
export function loginIdentifier(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 254 && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}
export function authenticatedRoute(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'walletName,walletPath' ||
      !walletName(value.walletName) || value.walletPath !== `/${value.walletName}`) return null;
  return Object.freeze({ walletName: value.walletName, walletPath: value.walletPath });
}
export function requestedWalletPath(location) {
  if (!location || location.search || location.hash) return null;
  return walletPath(location.pathname);
}
