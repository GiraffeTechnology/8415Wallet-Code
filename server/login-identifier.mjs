/** Private account resolution. Never expose candidates before authentication. */
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const reserved = new Set(['auth', 'api', 'web', 'assets', 'dist', 'docs', 'scripts', 'server', 'tests', 'config', 'login', 'logout', 'register', 'about', 'settings', 'default', '__proto__', 'constructor', 'prototype']);

export function validWalletName(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value) && !reserved.has(value);
}

export function normalizeLoginIdentifier(value) {
  if (typeof value !== 'string') return null;
  const identifier = value.trim();
  return identifier.length > 0 && identifier.length <= 254 && !/[\u0000-\u001f\u007f]/.test(identifier) ? identifier : null;
}

/** Both identifier resolution and selected-wallet binding must succeed.
 * A provider connection supplies a requested identity, never authentication.
 * Ambiguous aliases are refused even when one candidate matches that identity.
 */
export function resolveLoginIdentifier({ identifier, users, emailAlias, selected }) {
  const value = normalizeLoginIdentifier(identifier);
  if (value === null || !(users instanceof Map) || !selected || !address(selected.account) || typeof selected.chainId !== 'string') return null;
  const candidates = new Map();
  const add = user => { if (user && typeof user.username === 'string') candidates.set(user.username, user); };
  add(users.get(value));
  let alias = null;
  try { alias = typeof emailAlias === 'function' ? emailAlias(value) : null; } catch { return null; }
  if (typeof alias === 'string') add(users.get(alias));
  for (const user of users.values()) {
    if (validWalletName(user.walletName) && user.walletName === value) add(user);
    if (address(value) && user.wallets?.some(wallet => address(wallet.account) && wallet.account.toLowerCase() === value.toLowerCase() && wallet.chainId === selected.chainId)) add(user);
  }
  if (candidates.size !== 1) return null;
  const user = candidates.values().next().value;
  return user.wallets?.some(wallet => address(wallet.account) && wallet.account.toLowerCase() === selected.account.toLowerCase() && wallet.chainId === selected.chainId) ? user : null;
}

/** Call only after credential/proof verification and current-session checks. */
export function authenticatedWalletRoute(user) {
  if (!user || !validWalletName(user.walletName)) return null;
  return Object.freeze({ walletName: user.walletName, walletPath: `/${user.walletName}` });
}
