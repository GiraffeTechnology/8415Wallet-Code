/** Fixed installed package entry. No caller supplied import specifier or path. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { open, realpath, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { TASK_LISTING_ARTFI_INTERFACE } from '../task-listing-runtime.mjs';
// Only the approved manifest identity is public. The private dependency/file
// inventory is read from the separately installed provider, never shipped here.
const TASK_LISTING_MANIFEST_SHA256 = '7322af3b54aa068fd95ba1289be3b69a719dbf66d5b70d1ca3fbbf67a784ef0b';
const require = createRequire(import.meta.url);
export const TASK_LISTING_ARTFI_MANIFEST_SHA256 = TASK_LISTING_MANIFEST_SHA256;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (ok, code) => { if (!ok) throw Error(code); };
/** Read one pinned regular file without following a file or ancestor symlink.
 * Exported for focused filesystem boundary tests; not an HTTP/config port. */
export async function readInstalledListingFile(root, path) {
  check(typeof path === 'string' && /^[A-Za-z0-9_@.+/-]+$/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..'), 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
  const base = resolve(root), actual = join(base, path);
  check(await realpath(base) === base && await realpath(actual) === actual, 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
  const file = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.nlink === 1, 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
    return await file.readFile();
  } finally { await file.close(); }
}
/** Reject unpinned extra code and filesystem indirections before module import. */
export async function verifyInstalledListingInventory(root, files) {
  const expected = new Set([...Object.keys(files), 'runtime-manifest.json']), actual = new Set();
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path + '/');
      else {
        check(entry.isFile() && !entry.isSymbolicLink() && expected.has(path), 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
        actual.add(path);
      }
    }
  }
  await walk(root);
  check(actual.size === expected.size && [...expected].every(path => actual.has(path)), 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
}
export async function loadInstalledTaskListingModules() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  check(major > 22 || major === 22 && minor >= 18, 'TASK_LISTING_NODE_22_18_REQUIRED');
  const root = dirname(require.resolve('@artfi/task-listing-runtime/package.json'));
  const bytes = await readInstalledListingFile(root, 'runtime-manifest.json');
  check(hash(bytes) === TASK_LISTING_ARTFI_MANIFEST_SHA256, 'TASK_LISTING_ARTFI_MANIFEST_REFUSED');
  const manifest = JSON.parse(bytes.toString('utf8'));
  check(Object.entries(TASK_LISTING_ARTFI_INTERFACE).every(([key, value]) => manifest[key] === value) &&
    manifest.node?.minimumMajor === 22 && manifest.node.minimumVersion === '22.18.0' &&
    JSON.stringify(manifest.node.conditions) === JSON.stringify(['react-server']) &&
    manifest.files && Object.keys(manifest.files).length > 0, 'TASK_LISTING_ARTFI_INTERFACE_REFUSED');
  for (const [path, expected] of Object.entries(manifest.files)) {
    check(/^[A-Za-z0-9_@.+/-]+$/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..') && /^[a-f0-9]{64}$/.test(expected), 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
    check(hash(await readInstalledListingFile(root, path)) === expected, 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
  }
  await verifyInstalledListingInventory(root, manifest.files);
  // Node resolves the real server-only package condition; never replace its marker.
  const modules = await import('@artfi/task-listing-runtime/server');
  check(hash(Buffer.from(JSON.stringify(modules.runtimeManifest))) === hash(Buffer.from(JSON.stringify(manifest))), 'TASK_LISTING_ARTFI_EXPORT_REFUSED');
  return modules;
}
