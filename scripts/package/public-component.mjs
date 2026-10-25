/** Public installation projection. Full source proof remains in private QA artifacts. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGAL_FILES } from './verify-auth.mjs';
import { isPublicFile, readDeliveryArchive, sha256 } from './verify-delivery.mjs';

export const PUBLIC_COMPONENT_SCHEMA = '8415wallet-public-install-component/1';
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sorted = entries => [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
export const componentInventory = entries => Object.fromEntries(sorted(entries).map(([path, { bytes, mode }]) =>
  [path, { bytes: bytes.length, mode, sha256: sha256(bytes) }]));
const sums = entries => sorted(entries).filter(([path]) => path !== 'SHA256SUMS').map(([path, { bytes }]) => `${sha256(bytes)}  ${path}`).join('\n') + '\n';
const get = (entries, path) => { assert.ok(entries.has(path), `PUBLIC_COMPONENT_MISSING: ${path}`); return entries.get(path).bytes; };

/** This function is not a substitute for verify-dapp's private full-source verification. */
export function projectPublicComponent(privateEntries, privateManifest, installNotes) {
  const release = JSON.parse(get(privateEntries, 'RELEASE.json'));
  const { artifact, sha256: digest, ...expected } = privateManifest;
  assert.deepEqual(release, expected, 'PUBLIC_COMPONENT_PRIVATE_IDENTITY');
  assert.equal(release.schema, '8415wallet-dapp-release/2');
  assert.ok(['v2', 'v3'].includes(release.profile), 'PUBLIC_COMPONENT_PROFILE');
  assert.match(release.source.commit, /^[0-9a-f]{40}$/);
  assert.match(release.source.tree, /^[0-9a-f]{40}$/);
  assert.equal(release.source.dirty, false, 'PUBLIC_COMPONENT_CLEAN_SOURCE_REQUIRED');
  assert.equal(release.source.commitTree, release.source.tree, 'PUBLIC_COMPONENT_COMMIT_TREE');
  assert.deepEqual(release.tenant, { id: 'default', label: '8415wallet' }, 'PUBLIC_COMPONENT_GENERIC_TENANT');
  assert.deepEqual(release.deployment, { environment: 'unconfigured', url: null }, 'PUBLIC_COMPONENT_UNCONFIGURED');
  assert.ok(Buffer.isBuffer(installNotes) && installNotes.length > 0, 'PUBLIC_COMPONENT_INSTALL_NOTES');
  const entries = new Map();
  for (const [path, entry] of privateEntries) {
    if (LEGAL_FILES.includes(path) || /^(web\/|dist\/browser\/)/.test(path) && isPublicFile(path)) {
      assert.ok([0o644, 0o755].includes(entry.mode), 'PUBLIC_COMPONENT_MODE');
      entries.set(path, { bytes: Buffer.from(entry.bytes), mode: entry.mode });
    }
  }
  assert.ok(entries.has('web/index.html'), 'PUBLIC_COMPONENT_ENTRY');
  for (const path of LEGAL_FILES) {
    assert.deepEqual(get(entries, path), get(entries, `web/legal/${path}`), 'PUBLIC_COMPONENT_LEGAL');
  }
  const runtime = new Map([...entries].filter(([path]) => /^(web\/|dist\/browser\/)/.test(path)));
  assert.deepEqual(Object.fromEntries(sorted(runtime).map(([path, entry]) => [path, sha256(entry.bytes)])), release.runtimeFiles, 'PUBLIC_COMPONENT_RUNTIME_COMPLETE');
  entries.set('INSTALL.md', { bytes: Buffer.from(installNotes), mode: 0o644 });
  const publicRelease = {
    schema: PUBLIC_COMPONENT_SCHEMA, product: release.product, profile: release.profile,
    version: release.version, status: release.status, entry: release.entry,
    features: release.features,
    source: { commit: release.source.commit, tree: release.source.tree,
      inventoryScope: 'selected-install-component-only; not a full development source inventory' },
    verificationScope: 'Installation component integrity and private-source correspondence; not independent audit or deployed acceptance.',
    members: componentInventory(entries),
  };
  entries.set('RELEASE.json', { bytes: jsonBytes(publicRelease), mode: 0o644 });
  entries.set('SHA256SUMS', { bytes: Buffer.from(sums(entries)), mode: 0o644 });
  return { entries, release: publicRelease };
}

export function verifyPublicComponent(bytes, manifest, expectedProjection) {
  assert.deepEqual(Object.keys(manifest).sort(), ['artifact', 'bytes', 'members', 'release', 'sha256'], 'PUBLIC_COMPONENT_MANIFEST_FIELDS');
  assert.equal(manifest.artifact, `8415wallet-install-${expectedProjection.release.profile}-${expectedProjection.release.version}.tar.gz`, 'PUBLIC_COMPONENT_ARTIFACT_NAME');
  assert.equal(sha256(bytes), manifest.sha256, 'PUBLIC_COMPONENT_ARCHIVE_DIGEST');
  assert.equal(bytes.length, manifest.bytes, 'PUBLIC_COMPONENT_ARCHIVE_SIZE');
  const entries = readDeliveryArchive(bytes);
  assert.deepEqual(componentInventory(entries), componentInventory(expectedProjection.entries), 'PUBLIC_COMPONENT_EXACT_PRIVATE_CORRESPONDENCE');
  assert.deepEqual(manifest.members, componentInventory(entries), 'PUBLIC_COMPONENT_FULL_MEMBER_INVENTORY');
  assert.deepEqual(JSON.parse(get(entries, 'RELEASE.json')), expectedProjection.release, 'PUBLIC_COMPONENT_RELEASE');
  assert.deepEqual(manifest.release, expectedProjection.release, 'PUBLIC_COMPONENT_EXTERNAL_RELEASE');
  assert.equal(get(entries, 'SHA256SUMS').toString(), sums(entries), 'PUBLIC_COMPONENT_CHECKSUMS');
  return { files: entries.size, source: expectedProjection.release.source };
}

export function loadPrivateProjection(root, profile) {
  assert.ok(['v2', 'v3'].includes(profile), 'PUBLIC_COMPONENT_PROFILE');
  const manifest = JSON.parse(readFileSync(join(root, 'dist', `dapp-${profile}-package-manifest.json`)));
  assert.match(manifest.artifact, /^8415wallet-dapp-v[23]-[a-zA-Z0-9.-]+\.tar\.gz$/);
  const bytes = readFileSync(join(root, 'dist', manifest.artifact));
  assert.equal(sha256(bytes), manifest.sha256, 'PUBLIC_COMPONENT_PRIVATE_ARCHIVE_DIGEST');
  const installNotes = readFileSync(join(root, 'docs/PUBLIC-INSTALL.md'));
  assert.equal(sha256(installNotes), manifest.source.files['docs/PUBLIC-INSTALL.md'], 'PUBLIC_COMPONENT_TRACKED_INSTALL_NOTES');
  return projectPublicComponent(readDeliveryArchive(bytes), manifest, installNotes);
}
