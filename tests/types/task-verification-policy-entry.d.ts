declare module '*web/task-verification-policy-entry.mjs' {
  export interface PolicySettingsHost { hidden: boolean; }
  export interface PolicySettingsDocument {
    getElementById(id: string): PolicySettingsHost | null;
  }
  export interface PolicySettingsController {
    show(): void | Promise<void>;
    hide(): void;
    destroy(): void;
  }
  export interface PolicySettingsMountOptions {
    document: PolicySettingsDocument;
    window: unknown;
    walletLogin: unknown;
    host: PolicySettingsHost;
    getPolicyClient(): unknown;
  }
  export interface PolicySettingsEntryOptions {
    document: PolicySettingsDocument;
    window: unknown;
    walletLogin: unknown;
    currentAccountClient(): unknown;
    subscribeAccountSettings(listener: (open: boolean) => void): () => void;
    mountTaskVerificationPolicy(options: PolicySettingsMountOptions): PolicySettingsController;
    createTaskVerificationPolicyClient(options: {
      client: unknown; walletLogin: unknown; document: PolicySettingsDocument; window: unknown;
    }): unknown;
  }
  export function connectTaskVerificationPolicySettings(options: PolicySettingsEntryOptions): Readonly<{ destroy(): void }> | null;
}
