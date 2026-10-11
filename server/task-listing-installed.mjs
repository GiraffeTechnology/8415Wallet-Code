/** Fixed installed package entry. No caller supplied import specifier or path. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { TASK_LISTING_ARTFI_INTERFACE } from './task-listing-runtime.mjs';
import { TASK_LISTING_PACKAGE_PIN } from './task-listing-package-pin.mjs';
const require = createRequire(import.meta.url);
export const TASK_LISTING_ARTFI_MANIFEST_SHA256 = TASK_LISTING_PACKAGE_PIN.manifestSha256;
export const TASK_LISTING_ARTFI_ARTIFACT = TASK_LISTING_PACKAGE_PIN.artifactPath;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (ok, code) => { if (!ok) throw Error(code); };
export async function loadInstalledTaskListingModules() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  check(major > 22 || major === 22 && minor >= 18, 'TASK_LISTING_NODE_22_18_REQUIRED');
  const root = dirname(require.resolve('@artfi/task-listing-runtime/package.json'));
  const bytes = await readFile(join(root, 'runtime-manifest.json'));
  check(hash(bytes) === TASK_LISTING_ARTFI_MANIFEST_SHA256, 'TASK_LISTING_ARTFI_MANIFEST_REFUSED');
  const manifest = JSON.parse(bytes.toString('utf8'));
  check(Object.entries(TASK_LISTING_ARTFI_INTERFACE).every(([key, value]) => manifest[key] === value) &&
    manifest.node?.minimumMajor === 22 && manifest.node.minimumVersion === '22.18.0' &&
    JSON.stringify(manifest.node.conditions) === JSON.stringify(['react-server']) &&
    manifest.files && Object.keys(manifest.files).length > 0, 'TASK_LISTING_ARTFI_INTERFACE_REFUSED');
  for (const [path, expected] of Object.entries(manifest.files)) {
    check(/^[A-Za-z0-9_@.+/-]+$/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..') && /^[a-f0-9]{64}$/.test(expected), 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
    const actual = join(root, path), stat = await lstat(actual);
    check(stat.isFile() && !stat.isSymbolicLink() && hash(await readFile(actual)) === expected, 'TASK_LISTING_ARTFI_SOURCE_REFUSED');
  }
  // Node resolves the real server-only package condition; never replace its marker.
  const modules = await import('@artfi/task-listing-runtime/server');
  check(hash(Buffer.from(JSON.stringify(modules.runtimeManifest))) === hash(Buffer.from(JSON.stringify(manifest))), 'TASK_LISTING_ARTFI_EXPORT_REFUSED');
  return modules;
}
