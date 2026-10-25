declare module '*web/foundation-policy-summary.mjs' {
  export interface SummaryNode {
    dataset: Record<string, string>;
    textContent: string;
    hidden: boolean;
    setAttribute(key: string, value: string): void;
    getAttribute(key: string): string | null;
    removeAttribute(key: string): void;
  }
  export interface SummaryDocument {
    getElementById(id: string): SummaryNode | null;
    addEventListener(type: string, handler: (event: { detail?: unknown }) => void): void;
    removeEventListener(type: string, handler: (event: { detail?: unknown }) => void): void;
  }
  export interface SummaryLogin {
    capture(): unknown;
    assert(binding: unknown): unknown;
    subscribe(handler: () => void): (() => void) | void;
  }
  export interface SummaryState {
    view?: { mode?: string; revision?: string } | null;
    busy?: boolean;
    draftMode?: string | null;
  }
  export function connectFoundationPolicySummary(options: {
    document: SummaryDocument; walletLogin: SummaryLogin; getPolicyClient(): unknown;
  }): Readonly<{ read(): Promise<void>; observe(state: SummaryState | null | undefined): void; destroy(): void }> | null;
}
