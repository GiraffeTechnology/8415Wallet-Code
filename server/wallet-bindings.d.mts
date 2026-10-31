export type WalletBindingIdentity = { account: string; chainId: string };
export function walletBindingsFor(user: { wallets?: WalletBindingIdentity[] } | null | undefined, credential: unknown): WalletBindingIdentity[];
export function walletBoundFor(user: { wallets?: WalletBindingIdentity[] } | null | undefined, credential: unknown, identity: WalletBindingIdentity): boolean;
