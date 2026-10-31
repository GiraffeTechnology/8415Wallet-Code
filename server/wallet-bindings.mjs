/** Authentication only: asset membership is immutable here. Empty overlay is a tombstone. */
export function walletBindingsFor(user, credential) {
  const present = credential != null && Object.hasOwn(credential, 'walletBindings');
  const overlay = credential?.walletBindings;
  if (present && (!overlay || typeof overlay !== 'object' || Array.isArray(overlay) ||
      Object.keys(overlay).length !== 2 || overlay.version !== 1 || !Object.hasOwn(overlay, 'identities')))
    throw new Error('AUTH_WALLET_STATE_REFUSED');
  const values = present ? overlay.identities : user?.wallets ?? [];
  if (!Array.isArray(values) || values.some(value => !value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 || typeof value.account !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value.account) ||
      typeof value.chainId !== 'string' || !/^[1-9][0-9]*$/.test(value.chainId) ||
      !user?.wallets?.some(wallet => wallet.account === value.account && wallet.chainId === value.chainId)) ||
      new Set(values.map(value => `${value.chainId}:${value.account.toLowerCase()}`)).size !== values.length)
    throw new Error('AUTH_WALLET_STATE_REFUSED');
  return values.map(value => ({ account: value.account, chainId: value.chainId }));
}
export function walletBoundFor(user, credential, identity) {
  return walletBindingsFor(user, credential).some(value => value.account === identity.account && value.chainId === identity.chainId);
}
