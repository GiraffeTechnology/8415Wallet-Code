declare module '*login-core.mjs' {
  export const LOGIN_LIFETIME_MS: number;
  export const CHALLENGE_LIFETIME_MS: number;
  export class WalletLoginError extends Error { code: string; }
  export function loginMessage(challenge: any): string;
  export function verifyLoginSignature(provider: any, challenge: any, signature: string, crypto: any): Promise<string>;
  export class WalletLogin {
    constructor(options: any);
    assert(binding?: any): any;
    capture(): any;
    check(): Promise<any>;
    signIn(provider: any, server?: any): Promise<any>;
    logout(reason?: string): void;
    provider(): { request(args: any): Promise<any> };
    subscribe(listener: (session: any, reason: string) => void): () => void;
  }
}

declare module '*tenant-password-routing.mjs' {
  export function isPlatformPasswordProfile(profile: any): boolean;
  export function passwordPanelAction(profile: any, location: any): string | null;
}

declare module '*wallet-entry.mjs' {
  export function walletName(value: unknown): boolean;
  export function walletPath(value: unknown): string | null;
  export function loginIdentifier(value: unknown): string | null;
  export function authenticatedRoute(value: unknown): Readonly<{ walletName: string; walletPath: string }> | null;
  export function requestedWalletPath(location: { pathname?: string; search?: string; hash?: string } | null | undefined): string | null;
}
