// Candidate regression definitions only; no execution result is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AUTH_STATE_SEMANTICS, verifyAuthDirectory, walkAuth, sha256 } from '../scripts/package/verify-auth.mjs';
import { LEGACY_FILES, migrateLegacy } from '../deploy/auth-runtime/migrate-legacy.mjs';
import { fixture } from './helpers/auth-legacy-host.mjs';
test('PR58 input identity retains the exact historical deployment paths and blob pins', () => {
  assert.equal(LEGACY_FILES['deploy/auth-xiongan/8415wallet-auth-xiongan.service'], '7c90aae57f8b14aa364b4969b0e65000a9eecddd');
  assert.equal(LEGACY_FILES['deploy/auth-xiongan/auth-location.nginx.conf'], 'c01d1eb3461c0e3a2145728435c4a903f47e0c79');
  assert.equal(Object.keys(LEGACY_FILES).some(path => path.startsWith('deploy/auth-runtime/')), false);
});
test('legacy import renders the current neutral template without unresolved tenant paths', async t => {
  const f = await fixture(t);
  const key = await readFile(f.options.legacyKey), state = await readFile(f.options.legacyState);
  await migrateLegacy(f.options); // Synthetic injected commands/probe from the fixture only.
  const unit = await readFile(f.target.unit, 'utf8');
  assert.equal(unit.includes('@TENANT@'), false);
  assert.ok(unit.includes(`ExecStart=${f.options.node} server/runtime-entry.mjs --tenant xiongan`));
  for (const line of ['WorkingDirectory=/opt/8415wallet-auth-xiongan/current',
    'StateDirectory=8415wallet-auth-xiongan', 'RuntimeDirectory=8415wallet-auth-xiongan',
    'ReadWritePaths=/var/lib/8415wallet-auth-xiongan /run/8415wallet-auth-xiongan',
    'RestrictAddressFamilies=AF_UNIX', 'IPAddressDeny=any', 'NoNewPrivileges=true'])
    assert.ok(unit.split(/\r?\n/).includes(line), line);
  assert.deepEqual(await readFile(f.options.legacyKey), key);
  assert.deepEqual(await readFile(f.options.legacyState), state);
});

test('legacy forward candidate retains current format and refuses a re-signed generation-format mismatch', async t => {
  const f = await fixture(t), directory = f.options.packageDirectory;
  const key = await readFile(f.options.legacyKey), state = await readFile(f.options.legacyState);
  const release = verifyAuthDirectory(directory);
  assert.equal(release.runtime.authStateSemantics, AUTH_STATE_SEMANTICS);
  assert.equal(release.runtime.credentialStoreFormat, 5);
  assert.equal(release.runtime.legacyImportProtocol, 1);
  release.runtime.credentialStoreFormat = 1;
  await writeFile(join(directory, 'AUTH-RELEASE.json'), JSON.stringify(release));
  const sums = [];
  for (const path of walkAuth(directory).filter(path => path !== 'SHA256SUMS')) {
    sums.push(`${sha256(await readFile(join(directory, path)))}  ${path}`);
  }
  await writeFile(join(directory, 'SHA256SUMS'), sums.join('\n') + '\n');
  assert.throws(() => verifyAuthDirectory(directory), /AUTH_PACKAGE_STATE_FORMAT_REFUSED/);
  assert.deepEqual(await readFile(f.options.legacyKey), key);
  assert.deepEqual(await readFile(f.options.legacyState), state);
  assert.equal(f.calls.length, 0);
});
