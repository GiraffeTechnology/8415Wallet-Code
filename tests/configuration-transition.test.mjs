import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, lstat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertAuthConfigurationStable, AUTH_CONFIGURATION_FENCES } from '../server/configuration-transition.mjs';
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'wallet-transition-test-'));
  t.after(async () => { assert.ok(resolve(path).startsWith(resolve(tmpdir()) + '/wallet-transition-test-')); await rm(path, { recursive: true, force: false }); });
  return { path, config: join(path, 'auth.json') };
}
test('configuration stability does not read config or create any state', async t => {
  const f = await fixture(t); await assertAuthConfigurationStable(f.config);
  await assert.rejects(lstat(f.config), { code: 'ENOENT' });
});
test('all unresolved transition fences refuse and remain byte-identical', async t => {
  for (const name of AUTH_CONFIGURATION_FENCES) {
    const f = await fixture(t), lock = join(f.path, name); await writeFile(lock, 'unresolved writer evidence');
    await assert.rejects(assertAuthConfigurationStable(f.config), /AUTH_CONFIG_TRANSITION_IN_PROGRESS/);
    assert.equal(await readFile(lock, 'utf8'), 'unresolved writer evidence');
  }
});
test('directory and dangling symlink fences are not mistaken for absence', async t => {
  const f = await fixture(t); await mkdir(join(f.path, 'origin-migration.lock'));
  await assert.rejects(assertAuthConfigurationStable(f.config), /AUTH_CONFIG_TRANSITION_IN_PROGRESS/);
  const g = await fixture(t); await symlink(join(g.path, 'absent'), join(g.path, 'migration-config.lock'));
  await assert.rejects(assertAuthConfigurationStable(g.config), /AUTH_CONFIG_TRANSITION_IN_PROGRESS/);
  assert.ok((await lstat(join(g.path, 'migration-config.lock'))).isSymbolicLink());
});
