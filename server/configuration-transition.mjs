/** Fail closed during an interrupted configuration transition, including callers
 * entering main directly rather than through the systemd credential wrapper.
 * This only observes fences. It never removes a lock or infers a stale writer. */
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export const AUTH_CONFIGURATION_FENCES = Object.freeze(['mail-config.lock', 'migration-config.lock', 'origin-migration.lock']);
export async function assertAuthConfigurationStable(configPath) {
  if (typeof configPath !== 'string' || !configPath) throw Error('WALLET_AUTH_CONFIG_REQUIRED');
  for (const name of AUTH_CONFIGURATION_FENCES) {
    try { await lstat(join(dirname(configPath), name)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    // Any directory, file or symlink is an unresolved transition, not permission
    // to inspect its contents or unlink it. Only its owning recovery can clear it.
    throw Error('AUTH_CONFIG_TRANSITION_IN_PROGRESS');
  }
}
