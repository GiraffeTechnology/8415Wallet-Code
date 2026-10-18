// Candidate regression definitions only; no execution result is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
