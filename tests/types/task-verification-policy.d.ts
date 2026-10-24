/** Test-facing policy outputs; unknown inputs keep negative runtime cases checked. */
declare module '*server/task-verification-policy.mjs' {
  interface Change {
    revision: string; previousRevision: string; mode: 'ON' | 'OFF'; changeId: string;
    changeDigest: string; scopeDigest: string; credentialRevision: number;
    verifiedFactors: string[]; changedAt: number;
  }
  interface State {
    schema: '8415-task-human-verification/1' | '8415-task-human-verification/2'; enforcedFromRevision?: string; scope: Readonly<Record<string, string>>;
    mode: 'ON' | 'OFF'; revision: string; changes: Change[];
  }
  interface Status extends State {
    label: string; appliesTo: string; grantsAuthority: false; factorsForOFF: string[]; factorsForEverySave: string[];
    changeProtocol?: string; pendingChange?: null | { changeId: string; changeDigest: string; expectedRevision: string;
      mode: 'ON' | 'OFF'; stage: string; issuedAt: number; expiresAt: number };
    reconciliation?: null | { changeId: string; changeDigest: string; expectedRevision: string; state: string;
      automaticRetryAllowed: false; committedChange: Change | null; reason: string | null };
  }
  interface Prepared {
    changeProtocol?: string;
    request: { mode: 'ON' | 'OFF'; changeId: string; nonce: string; expectedRevision: string; issuedAt: number; expiresAt: number };
    changeDigest: string; identityMethod: 'wallet' | 'password'; emailMasked: string; message?: string;
  }
  export function taskVerificationPolicyKey(scope: unknown): string;
  export function readTaskVerificationPolicy(value: unknown, scope: unknown): State;
  export function readCredentialTaskVerificationPolicy(value: unknown, scope: unknown): State;
  export function createTaskVerificationPolicyService(options: unknown): {
    status(session: unknown, body?: unknown): Promise<Status>;
    prepare(session: unknown, body: unknown): Promise<Prepared>;
    verify(session: unknown, body: unknown): Promise<unknown>;
    confirm(session: unknown, body: unknown): Promise<Status>;
    enable(session: unknown, body: unknown): Promise<Status>;
    cancel(session: unknown): void;
    cancelChange(session: unknown, body: unknown): Promise<{ changeProtocol: string; cancelled: boolean; reconciliation: Status['reconciliation'] }>;
    keyFor(session: unknown): string;
    readStored(value: unknown, session: unknown): State;
    readCredential(value: unknown, session: unknown): State;
  };
}
