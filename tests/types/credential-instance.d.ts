declare module '*server/credential-instance.mjs' {
  export function credentialInstanceBinding(value: unknown): Readonly<{
    name: string; tenant: string; credentialDirectory: string; configPath: string; migrationLockPath: string;
  }>;
}
