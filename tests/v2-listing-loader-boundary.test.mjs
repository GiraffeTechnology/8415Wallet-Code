import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstalledListingFile, verifyInstalledListingInventory } from '../server/v2/task-listing-installed.mjs';
test('optional provider reader rejects traversal and file/ancestor symlink escapes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'actual')); await writeFile(join(root, 'actual', 'module.mjs'), 'synthetic-only');
  assert.equal((await readInstalledListingFile(root, 'actual/module.mjs')).toString(), 'synthetic-only');
  for (const path of ['../module.mjs', '/absolute', 'actual/../actual/module.mjs', 'actual//module.mjs'])
    await assert.rejects(readInstalledListingFile(root, path), /TASK_LISTING_ARTFI_SOURCE_REFUSED/);
  await symlink('actual/module.mjs', join(root, 'linked.mjs'));
  await symlink('actual', join(root, 'alias'));
  await assert.rejects(readInstalledListingFile(root, 'linked.mjs'), /TASK_LISTING_ARTFI_SOURCE_REFUSED/);
  await assert.rejects(readInstalledListingFile(root, 'alias/module.mjs'), /TASK_LISTING_ARTFI_SOURCE_REFUSED/);
});

test('optional provider inventory refuses extra unpinned code before import', async t => {
 const root = await mkdtemp(join(tmpdir(), 'synthetic-v2-inventory-'));
 t.after(() => rm(root, { recursive: true, force: true }));
 await writeFile(join(root, 'runtime-manifest.json'), '{}');
 await writeFile(join(root, 'server.mjs'), 'synthetic-only');
 await verifyInstalledListingInventory(root, { 'server.mjs': 'synthetic-placeholder' });
 await writeFile(join(root, 'unapproved.mjs'), 'synthetic-extra');
 await assert.rejects(verifyInstalledListingInventory(root, { 'server.mjs': 'synthetic-placeholder' }), /TASK_LISTING_ARTFI_SOURCE_REFUSED/);
});
