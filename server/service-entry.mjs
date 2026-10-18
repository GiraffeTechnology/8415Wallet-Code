/** Existing systemd credential entry; do not invoke until operator activation. */
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { validateAuthConfig } from './config-validation.mjs';
import { credentialInstanceBinding } from './credential-instance.mjs';
import { ensureTaskListingServerCondition } from './task-listing-bootstrap.mjs';
if (process.platform !== 'linux' || process.getuid?.() !== 0) throw Error('AUTH_SERVICE_IDENTITY_REQUIRED');
if (process.env.WALLET_AUTH_STORE_KEY) throw Error('AUTH_AMBIENT_STORE_KEY_REFUSED');
// Compatibility units already receive a systemd-owned credential directory.
// Derive only its strict instance identifier; never use a shipped deployment
// name, an HTTP tenant, a guessed config path, or a default wallet.
const { tenant, credentialDirectory, configPath, migrationLockPath } = credentialInstanceBinding(process.env.CREDENTIALS_DIRECTORY);
// A legacy unit may still point at this entry during an interrupted code switch.
try { await lstat(migrationLockPath); throw Error('AUTH_CONFIG_TRANSITION_IN_PROGRESS'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (process.env.CREDENTIALS_DIRECTORY !== credentialDirectory) throw Error('AUTH_CREDENTIAL_DIRECTORY_REFUSED');
const directory = await lstat(credentialDirectory);
if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o077)) throw Error('AUTH_CREDENTIAL_DIRECTORY_REFUSED');
// Relaunch with the fixed server condition before putting any credential into
// the environment. The legacy entry rejects an ambient store key on startup.
const configFile = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
let configuration;
try {
  const stat = await configFile.stat();
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || (stat.mode & 0o077) || stat.size > 1_000_000) throw Error('AUTH_CREDENTIAL_FILE_REFUSED');
  configuration = JSON.parse(await configFile.readFile('utf8')); validateAuthConfig(configuration);
  if (configuration.tenant !== tenant) throw Error('AUTH_SERVICE_CONFIG_BINDING_REFUSED');
} finally { await configFile.close(); }
await ensureTaskListingServerCondition(configuration.listing);
const file = await open(`${credentialDirectory}/store-key`, constants.O_RDONLY | constants.O_NOFOLLOW);
let key;
try {
  const stat = await file.stat();
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || (stat.mode & 0o077) || stat.size > 66) throw Error('AUTH_CREDENTIAL_FILE_REFUSED');
  key = await file.readFile();
  const text = key.toString('utf8').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(text)) throw Error('AUTH_CREDENTIAL_FORMAT_REFUSED');
  process.env.WALLET_AUTH_STORE_KEY = text;
  process.env.WALLET_AUTH_CONFIG = configPath;
  await (await import('./main.mjs')).startAuthFromEnvironment();
} finally { key?.fill(0); delete process.env.WALLET_AUTH_STORE_KEY; delete process.env.WALLET_AUTH_CONFIG; await file.close(); }
