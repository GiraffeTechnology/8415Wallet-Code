declare module '*web/task-verification-policy-ui.mjs' {
  export interface PolicyView {
    mode: 'ON' | 'OFF'; revision: string;
    context: Readonly<{ origin: string; tenant: string; account: string; chainId: string }>;
    scopeKey: string; walletLabel: string; agentId: string; agentLabel: string; scopeLabel: string;
    permissions: ReadonlyArray<Readonly<{ id: string; label: string }>> | null;
    canChange: boolean; changeState: 'settled' | 'unknown';
  }
  export interface PolicySnapshot {
    phase: string; view: PolicyView | null; draftMode: 'ON' | 'OFF' | null;
    busy: boolean; notice: string | null;
  }
  export function validateTaskVerificationPolicyView(raw: unknown, session: unknown): PolicyView;
  export class TaskVerificationPolicyController {
    constructor(options: { walletLogin: unknown; getPolicyClient: () => unknown;
      onChange?: (state: PolicySnapshot) => void; isVisible?: () => boolean });
    snapshot(): PolicySnapshot;
    show(): Promise<void>; hide(): void; invalidate(): Promise<void>; refresh(): Promise<void>;
    choose(mode: string): void; save(): Promise<void>; cancel(): Promise<void>; destroy(): void;
  }
  export function mountTaskVerificationPolicy(options: unknown): {
    show(): Promise<void>; hide(): void; invalidate(): Promise<void>;
    snapshot(): PolicySnapshot; destroy(): void;
  } | null;
}
declare module '*locales/task-verification-policy.mjs' {
  export const POLICY_LOCALES: readonly string[];
  export const POLICY_CATALOGS: Readonly<Record<string, Readonly<Record<string, string>>>>;
  export function policyText(key: string, parameters?: Record<string, unknown>, locale?: string): string;
  export default POLICY_CATALOGS;
}
declare module '*web/task-verification-policy-ceremony.mjs' {
  export function runTaskVerificationPolicyChange(options: unknown): Promise<unknown>;
}
declare module '*web/task-verification-policy-client.mjs' {
  export function createTaskVerificationPolicyClient(options: unknown): {
    read(input: unknown): Promise<unknown>; change(input: unknown): Promise<unknown>;
  } | null;
}

declare module '*web/task-verification-policy-wire.mjs' {
  interface DecodedPolicyStatus {
    view: { mode: 'ON' | 'OFF'; revision: string; scopeKey: string; canChange: boolean;
      permissions: unknown[] | null; changeState: 'settled' | 'unknown' };
    lastChange: Readonly<Record<string, unknown>> | null;
    scope: Readonly<Record<string, string>>; scopeDigest: string; schema: string;
  }
  export function createTaskVerificationPolicyWire(options?: unknown): {
    status(raw: unknown, session: unknown, account: unknown): Promise<DecodedPolicyStatus>;
    prepared(raw: unknown, options: unknown): Promise<Readonly<Record<string, unknown>>>;
    verified(raw: unknown, prepared: unknown, now: unknown): Readonly<Record<string, unknown>>;
    committed(raw: unknown, prepared: unknown): Promise<unknown>;
  };
}
