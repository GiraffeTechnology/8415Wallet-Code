/** Unit-only virtual host: invokes the unchanged original entry module. No real
 * credential files, user identity changes, service starts or auth grants. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { validateAuthConfig } from '../../server/config-validation.mjs';

const source = readFileSync(new URL('../../server/runtime-entry-core.mjs', import.meta.url), 'utf8');
async function invoke(options, uid = 0, transitioning = false) {
  const tenant = 'fixture', name = '8415wallet-auth-' + tenant;
  const configDirectory = '/etc/' + name, credentialDirectory = '/run/credentials/' + name + '.service';
  const config = { tenant, origin: 'https://wallet.example.invalid',
    statePath: '/var/lib/' + name + '/credentials.enc', socketPath: '/run/' + name + '/auth.sock',
    accounts: [{ username: 'owner', wallets: [{ account: '0x' + '1'.repeat(40), chainId: '31337' }] }] };
  const env = { CREDENTIALS_DIRECTORY: credentialDirectory };
  let reads = 0, starts = 0, forwarded; const events = [];
  const simulated = { argv: ['node', 'fixed-entry.mjs', '--tenant', tenant], platform: 'linux',
    getuid: () => uid, geteuid: () => uid, env };
  const context = createContext({ process: simulated, Buffer });
  const bytesFor = path => {
    if (path === configDirectory + '/auth.json') return Buffer.from(JSON.stringify(config));
    if (path === credentialDirectory + '/store-key') return Buffer.from('52'.repeat(32) + '\n');
    throw Error('UNEXPECTED_VIRTUAL_FILE');
  };
  const dependencies = {
    'node:fs/promises': {
      async open(path) { const bytes = bytesFor(path); reads++; events.push(path === configDirectory + '/auth.json' ? 'config-read' : 'key-read');
        return { async stat() { return { isFile: () => true, nlink: 1, uid: 0, gid: 0,
          mode: 0o600, size: bytes.length }; }, async readFile() { return Buffer.from(bytes); }, async close() {} }; },
      async lstat(path) { return { isDirectory: () => true, isSymbolicLink: () => false,
        uid: 0, gid: 0, mode: [credentialDirectory, configDirectory, '/var/lib/' + name].includes(path) ? 0o700 : 0o755 }; },
      async realpath(path) { return path; },
    },
    'node:fs': { constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 } },
    'node:path': { dirname },
    './socket-path.mjs': { async protectSocketDirectory(path, owner) {
      assert.equal(path, config.socketPath); assert.equal(owner, 0); } },
    './config-validation.mjs': { validateAuthConfig(value) {
      return validateAuthConfig(JSON.parse(JSON.stringify(value))); } },
    './mail-config.mjs': { async installedMailEnvironment() { return {}; } },
    './configuration-transition.mjs': { async assertAuthConfigurationStable(path) {
      assert.equal(path, configDirectory + '/auth.json'); events.push('fence');
      if (transitioning) throw Error('AUTH_CONFIG_TRANSITION_IN_PROGRESS'); } },
  };
  const module = new SourceTextModule(source, { context });
  await module.link(async specifier => {
    const exports = dependencies[specifier]; assert.ok(exports, specifier);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const action = module.namespace.runCredentialEntry({ ...options,
    async ensureRuntimeCondition(value) { assert.equal(value, undefined); },
    async startAuthFromEnvironment(value) { events.push('start'); starts++; forwarded = value; } });
  if (uid !== 0) {
    await assert.rejects(action, /AUTH_SERVICE_IDENTITY_REQUIRED/);
    assert.equal(reads, 0); assert.equal(starts, 0); return;
  }
  if (transitioning) {
    await assert.rejects(action, /AUTH_CONFIG_TRANSITION_IN_PROGRESS/);
    assert.equal(reads, 0); assert.equal(starts, 0); assert.deepEqual(events, ['fence']);
    assert.equal(env.WALLET_AUTH_STORE_KEY, undefined); assert.equal(env.WALLET_AUTH_CONFIG, undefined); return;
  }
  await action; assert.equal(starts, 1); assert.equal(reads, 2);
  assert.deepEqual(events, ['fence', 'config-read', 'key-read', 'start']);
  assert.strictEqual(forwarded.readSources, options.readSources ?? null);
  assert.strictEqual(forwarded.wholeReceipt, options.wholeReceipt ?? null);
  assert.equal(env.WALLET_AUTH_STORE_KEY, undefined); assert.equal(env.WALLET_AUTH_CONFIG, undefined);
}
await invoke({});
await invoke({ readSources: Object.freeze({ opaqueReadCapability: true }),
  wholeReceipt: Object.freeze({ opaqueReceiptCapability: true }) });
await invoke({ wholeReceipt: Object.freeze({ opaqueReceiptCapability: true }) }, 1000);
await invoke({ wholeReceipt: Object.freeze({ opaqueReceiptCapability: true }) }, 0, true);
console.log('CREDENTIAL_ENTRY_WHOLE_RECEIPT_PASS');
