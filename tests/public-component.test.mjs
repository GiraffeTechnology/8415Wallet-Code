import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { LEGAL_FILES } from '../scripts/package/verify-auth.mjs';
import { deterministicArchive, sha256 } from '../scripts/package/dapp-release.mjs';
import { componentInventory, projectPublicComponent, verifyPublicComponent } from '../scripts/package/public-component.mjs';

function fixture(profile = 'v2') {
  const entries = new Map();
  const add = (path, text) => entries.set(path, { bytes: Buffer.from(text), mode: 0o644 });
  add('web/index.html', '<html>Beta</html>');
  add('web/release-config.json', '{"deployment":{"environment":"unconfigured","url":null}}');
  add('dist/browser/browser.js', 'export const version = 1;');
  for (const path of LEGAL_FILES) { add(path, 'license text'); add(`web/legal/${path}`, 'license text'); }
  add('docs/ERC-8415-Wallet-PRD.md', 'PRIVATE_PRD_SENTINEL');
  add('docs/APPROVED-UI-IMPLEMENTATION.md', 'PRIVATE_GOVERNANCE_SENTINEL');
  add('docs/deployment/SIN-private.md', 'PRIVATE_ENVIRONMENT_SENTINEL');
  const release = { schema: '8415wallet-dapp-release/2', profile, product: '8415wallet', version: '2.2.0-beta',
    status: 'BETA_FUNCTIONAL_TESTING_NOT_INDEPENDENTLY_AUDITED', entry: 'web/index.html',
    tenant: { id: 'default', label: '8415wallet' }, deployment: { environment: 'unconfigured', url: null },
    source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), commitTree: 'b'.repeat(40), dirty: false,
      files: { 'docs/deployment/SIN-private.md': 'c'.repeat(64) } },
    sourceArchive: { artifact: 'private-source.tar.gz', sha256: 'd'.repeat(64) },
    features: { standalone: true, linkedResponsibilities: profile === 'v3' },
    runtimeFiles: Object.fromEntries([...entries].filter(([path]) => /^(web\/|dist\/browser\/)/.test(path)).map(([path, entry]) => [path, sha256(entry.bytes)])) };
  add('RELEASE.json', JSON.stringify(release)); add('SHA256SUMS', 'private sums');
  return { entries, manifest: { artifact: 'private.tar.gz', sha256: 'e'.repeat(64), ...release } };
}
const project = f => projectPublicComponent(f.entries, f.manifest, Buffer.from('Product installation notes.\n'));
function archive(entries, run) {
  const root = mkdtempSync(join(tmpdir(), 'wallet-public-projection-test-'));
  try {
    const stage = join(root, 'stage'); mkdirSync(stage);
    for (const [path, entry] of entries) {
      const file = join(stage, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, entry.bytes); chmodSync(file, entry.mode);
    }
    const output = join(root, 'public.tar.gz'); deterministicArchive(stage, output); return run(readFileSync(output));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('public V2/V3 projections retain all runtime/legal bytes but exclude private source and governance', () => {
  for (const profile of ['v2', 'v3']) {
    const f = fixture(profile), result = project(f), text = JSON.stringify(result.release);
    assert.equal(result.release.profile, profile);
    assert.equal(result.release.source.commit, f.manifest.source.commit);
    assert.equal(result.release.source.tree, f.manifest.source.tree);
    assert.match(result.release.source.inventoryScope, /selected-install-component-only/);
    for (const path of ['docs/ERC-8415-Wallet-PRD.md', 'docs/APPROVED-UI-IMPLEMENTATION.md', 'docs/deployment/SIN-private.md']) assert.equal(result.entries.has(path), false);
    assert.doesNotMatch(text, /PRIVATE_|SIN-private|sourceArchive|private-source\.tar\.gz|commitTree/);
    assert.deepEqual(Object.keys(result.release.source).sort(), ['commit', 'inventoryScope', 'tree']);
    for (const [path, entry] of f.entries) if (/^(web\/|dist\/browser\/)/.test(path) || LEGAL_FILES.includes(path)) assert.deepEqual(result.entries.get(path), entry);
    archive(result.entries, bytes => {
      const manifest = { artifact: `8415wallet-install-${profile}-${result.release.version}.tar.gz`, sha256: sha256(bytes), bytes: bytes.length, members: componentInventory(result.entries), release: result.release };
      assert.equal(verifyPublicComponent(bytes, manifest, result).files, result.entries.size);
      assert.throws(() => verifyPublicComponent(bytes, { ...manifest, sha256: '0'.repeat(64) }, result), /ARCHIVE_DIGEST/);
      assert.throws(() => verifyPublicComponent(bytes, { ...manifest, bytes: bytes.length + 1 }, result), /ARCHIVE_SIZE/);
      assert.throws(() => verifyPublicComponent(bytes, { ...manifest, members: {} }, result), /MEMBER_INVENTORY/);
      assert.throws(() => verifyPublicComponent(bytes, { ...manifest, extra: true }, result), /MANIFEST_FIELDS/);
    });
  }
});
test('dirty, configured, tenant-specific or mismatched private identities are refused', () => {
  for (const mutate of [f => { f.manifest.source.dirty = true; }, f => { f.manifest.deployment.url = 'https://example.invalid'; },
    f => { f.manifest.tenant.id = 'private-tenant'; }, f => { f.manifest.source.commitTree = 'c'.repeat(40); }]) {
    const f = fixture(); mutate(f); f.entries.set('RELEASE.json', { bytes: Buffer.from(JSON.stringify((({ artifact, sha256, ...r }) => r)(f.manifest))), mode: 0o644 });
    assert.throws(() => project(f));
  }
  const f = fixture(); f.manifest.version = 'unexpected'; assert.throws(() => project(f), /PRIVATE_IDENTITY/);
});
test('extra private members, altered runtime bytes and mode changes fail exact correspondence even with recomputed checksums', () => {
  for (const mutate of [entries => entries.set('private.json', { bytes: Buffer.from('private'), mode: 0o644 }),
    entries => entries.set('dist/browser/browser.js', { bytes: Buffer.from('changed'), mode: 0o644 }),
    entries => entries.set('dist/browser/browser.js', { ...entries.get('dist/browser/browser.js'), mode: 0o755 })]) {
    const expected = project(fixture()), changed = new Map(expected.entries); mutate(changed);
    archive(changed, bytes => assert.throws(() => verifyPublicComponent(bytes,
      { artifact: `8415wallet-install-v2-${expected.release.version}.tar.gz`, sha256: sha256(bytes), bytes: bytes.length, members: componentInventory(changed), release: expected.release }, expected), /EXACT_PRIVATE_CORRESPONDENCE/));
  }
});
test('missing or altered runtime and license payloads are refused before projection', () => {
  const missing = fixture(); missing.entries.delete('dist/browser/browser.js'); assert.throws(() => project(missing), /RUNTIME_COMPLETE/);
  const legal = fixture(); legal.entries.get('LICENSE').bytes = Buffer.from('wrong license'); assert.throws(() => project(legal), /LEGAL/);
});
