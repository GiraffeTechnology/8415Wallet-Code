/** Pure synthetic path fixtures; no service, credential file or network access. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { credentialInstanceBinding } from '../server/credential-instance.mjs';

for (const tenant of ['synthetic-alpha', 'synthetic-beta', 'sample-3', 'a'.repeat(48)]) {
  test(`existing explicit synthetic instance remains exact: ${tenant}`, () => {
    const name = `8415wallet-auth-${tenant}`, directory = `/run/credentials/${name}.service`;
    const binding = credentialInstanceBinding(directory);
    assert.deepEqual(binding, { name, tenant, credentialDirectory: directory,
      configPath: `/etc/${name}/auth.json`, migrationLockPath: `/etc/${name}/migration-config.lock` });
    assert.ok(Object.isFrozen(binding));
  });
}
test('no tenant or default path can be supplied by coercion or an arbitrary directory', () => {
  let coerced = false;
  for (const value of [undefined, null, false, {}, [], { toString() { coerced = true; return 'synthetic-alpha'; } },
    '', '/run/credentials/8415wallet-auth-.service', '/run/credentials/8415wallet-auth-Upper.service',
    '/run/credentials/8415wallet-auth-../other.service', '/run/credentials/8415wallet-auth-a.service/extra',
    '/tmp/8415wallet-auth-synthetic-alpha.service', '/run/credentials/8415wallet-auth-a.service\n',
    '/run/credentials/8415wallet-auth-' + 'a'.repeat(49) + '.service']) {
    assert.throws(() => credentialInstanceBinding(value), { message: 'AUTH_CREDENTIAL_DIRECTORY_REFUSED' });
  }
  assert.equal(coerced, false);
});
test('compatibility entry preserves filesystem, migration, credential and exact tenant guards', () => {
  const entry = readFileSync(new URL('../server/service-entry.mjs', import.meta.url), 'utf8');
  assert.match(entry, /credentialInstanceBinding\(process\.env\.CREDENTIALS_DIRECTORY\)/);
  assert.match(entry, /configuration\.tenant !== tenant/);
  for (const guard of ['process.platform', 'process.getuid', 'AUTH_AMBIENT_STORE_KEY_REFUSED',
    'migrationLockPath', 'AUTH_CONFIG_TRANSITION_IN_PROGRESS', 'isSymbolicLink', 'directory.uid !== 0',
    'O_NOFOLLOW', 'stat.nlink !== 1', 'stat.uid !== 0', 'AUTH_CREDENTIAL_FORMAT_REFUSED', 'key?.fill(0)']) {
    assert.ok(entry.includes(guard), `Retain ${guard}`);
  }
  assert.doesNotMatch(entry, /operator-init|initialize|generateKey|readFile\('[^']*store-key/);
  assert.ok(entry.includes('delete process.env.WALLET_AUTH_CONFIG'));
});
test('parameterized compatibility parser participates in exact package closure', () => {
  const verifier = readFileSync(new URL('../scripts/package/verify-auth.mjs', import.meta.url), 'utf8');
  assert.ok(verifier.includes("required.push('server/credential-instance.mjs')"));
  for (const guard of ['AUTH_PACKAGE_COMPLETE_FILE_INVENTORY', 'SOURCE_BLOB_MISMATCH', 'REQUIRED_FILE_MISSING']) {
    assert.ok(verifier.includes(guard));
  }
});
