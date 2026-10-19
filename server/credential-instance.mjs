/** Parse an existing systemd instance binding; no discovery or secret access. */
export function credentialInstanceBinding(value) {
  if (typeof value !== 'string') throw Error('AUTH_CREDENTIAL_DIRECTORY_REFUSED');
  const match = /^\/run\/credentials\/(8415wallet-auth-([a-z][a-z0-9-]{0,47}))\.service$/.exec(value);
  if (!match || match[0] !== value) throw Error('AUTH_CREDENTIAL_DIRECTORY_REFUSED');
  const name = match[1], tenant = match[2];
  return Object.freeze({ name, tenant, credentialDirectory: `/run/credentials/${name}.service`,
    configPath: `/etc/${name}/auth.json`, migrationLockPath: `/etc/${name}/migration-config.lock` });
}
