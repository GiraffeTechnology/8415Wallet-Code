/** Pure intake validation. Display labels are not account ownership or execution authority. */
export function validateWalletBindings(wallets) {
  if (!Array.isArray(wallets) || wallets.length !== 3) throw new Error('THREE_PUBLIC_WALLET_BINDINGS_REQUIRED');
  const names = new Set(), accounts = new Set();
  for (const item of wallets) {
    if (!item || typeof item.name !== 'string' || item.name.trim().length === 0 ||
      typeof item.address !== 'string' || !/^0x[0-9a-f]{40}$/.test(item.address) || /^0x0+$/.test(item.address)) {
      throw new Error('WALLET_BINDING_REFUSED');
    }
    // Keep the supplied label and address byte-for-byte; never remap a bound account.
    names.add(item.name); accounts.add(item.address);
  }
  if (names.size !== 3 || accounts.size !== 3) throw new Error('THREE_DISTINCT_WALLETS_REQUIRED');
}
