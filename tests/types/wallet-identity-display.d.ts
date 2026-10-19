declare module '*web/wallet-identity-display.mjs' {
  export function walletIdentityState(identity: unknown, account: unknown): 'own' | 'hidden' | 'unavailable';
  export function walletIdentityText(state: string, locale: string): string;
  export function walletIdentityDisplay(identity: unknown, account: unknown): any;
  export function walletIdentityStateDisplay(state: unknown): any;
  export function privateReadProjection(value: any, account: unknown): any;
  export function identityText(text: string, locale: string): string;
  export function privateNativeUi(renderer: any, view: any, account: unknown): any;
  export function privateReadDisplay(view: any, account: unknown, disclosure?: any): any;
  export function privateNativeSummary(view: any, account: unknown): any;
  export function privateAuditDownload(value: any, account: unknown): any;
}
