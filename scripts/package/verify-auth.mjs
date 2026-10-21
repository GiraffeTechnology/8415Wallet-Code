/** Offline auth-package integrity checks. Uses only the externally supplied Node runtime. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { TASK_LISTING_PACKAGE_PIN } from '../../server/task-listing-package-pin.mjs';

export const LEGAL_FILES = Object.freeze(['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSES/CC0-1.0.txt']);
export const PUBLIC_LEGAL_FILES = Object.freeze(LEGAL_FILES.map(path => `web/legal/${path}`));

export const AUTH_SCHEMA = '8415wallet-auth-runtime/1';
export const AUTH_STATUS = 'NONPRODUCTION_PACKAGE_NOT_ACTIVATED';
// State meaning is versioned independently of the unchanged AES envelope format.
// Older code may discard factor fields or revive a superseded configured password
// even though it can decrypt the unchanged v1 envelope.
export const AUTH_STATE_SEMANTICS = '8415wallet-auth-state/4';
export const PASSWORD_AUTH_STATE_SEMANTICS = '8415wallet-auth-state/3';
export const REGISTRATION_AUTH_STATE_SEMANTICS = '8415wallet-auth-state/2';
export const LEGACY_AUTH_STATE_SEMANTICS = '8415wallet-auth-state/1';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const jsonBytes = object => `${JSON.stringify(object, null, 2)}\n`;
const objectHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const fail = (condition, code) => { if (!condition) throw new Error(`AUTH_PACKAGE_${code}`); };
const hashPattern = /^[0-9a-f]{64}$/;
const gitPattern = /^[0-9a-f]{40}$/;
/** Release pins are explicit caller inputs, never derived from the archive being checked.
 * Development integrity checking remains available without release mode. */
export function authSourcePolicy({ release = false, expectedCommit, expectedTree } = {}) {
  fail(typeof release === 'boolean', 'RELEASE_MODE_REFUSED');
  if (expectedCommit !== undefined) fail(typeof expectedCommit === 'string' && gitPattern.test(expectedCommit), 'EXPECTED_SOURCE_COMMIT_REFUSED');
  if (expectedTree !== undefined) fail(typeof expectedTree === 'string' && gitPattern.test(expectedTree), 'EXPECTED_SOURCE_TREE_REFUSED');
  if (release) fail(gitPattern.test(expectedCommit ?? '') && gitPattern.test(expectedTree ?? ''), 'RELEASE_EXTERNAL_PINS_REQUIRED');
  return { release, expectedCommit, expectedTree };
}
export function verifyAuthSourcePolicy(source, options = {}) {
  const policy = authSourcePolicy(options);
  if (policy.expectedCommit !== undefined) fail(source?.commit === policy.expectedCommit, 'EXPECTED_SOURCE_COMMIT_MISMATCH');
  if (policy.expectedTree !== undefined) fail(source?.tree === policy.expectedTree, 'EXPECTED_SOURCE_TREE_MISMATCH');
  if (policy.release) fail(source?.dirty === false && source.commitTree === policy.expectedTree
    && source.indexTree === policy.expectedTree && source.tree === policy.expectedTree, 'RELEASE_CLEAN_SOURCE_REQUIRED');
  return policy;
}
export function parseAuthVerifyArguments(args) {
  const seen = new Set(), options = {}; let target;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    fail(['--release', '--expected-commit', '--expected-tree', '--directory', '--manifest'].includes(key) && !seen.has(key), 'ARGUMENT_REFUSED');
    seen.add(key);
    if (key === '--release') { options.release = true; continue; }
    const value = args[++index]; fail(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'ARGUMENT_REFUSED');
    if (key === '--expected-commit') options.expectedCommit = value;
    else if (key === '--expected-tree') options.expectedTree = value;
    else { fail(target === undefined, 'ARGUMENT_REFUSED'); target = { kind: key.slice(2), path: value }; }
  }
  return { target: target ?? { kind: 'manifest', path: 'dist/auth-package-manifest.json' }, policy: authSourcePolicy(options) };
}
export function authStateSemantics(release) {
  const value = release?.runtime?.authStateSemantics;
  // An absent declaration is the pre-registration/recovery generation only.
  fail(value === undefined || [LEGACY_AUTH_STATE_SEMANTICS, REGISTRATION_AUTH_STATE_SEMANTICS, PASSWORD_AUTH_STATE_SEMANTICS, AUTH_STATE_SEMANTICS].includes(value), 'STATE_SEMANTICS_REFUSED');
  return value ?? LEGACY_AUTH_STATE_SEMANTICS;
}
export function validateAuthStateTransition(current, candidate, { rollback = false } = {}) {
  const from = authStateSemantics(current), to = authStateSemantics(candidate);
  if (from === to) return;
  const generations = [LEGACY_AUTH_STATE_SEMANTICS, REGISTRATION_AUTH_STATE_SEMANTICS, PASSWORD_AUTH_STATE_SEMANTICS, AUTH_STATE_SEMANTICS];
  fail(generations.indexOf(to) > generations.indexOf(from), 'STATE_SEMANTICS_DOWNGRADE_REFUSED');
  // Only the enumerated, reviewed forward generations are accepted. A rollback
  // cannot silently perform a forward migration; unknown future versions fail.
  fail(!rollback, 'STATE_SEMANTICS_TRANSITION_REFUSED');
}
export const TASK_RUNTIME_SOURCE_PATHS = Object.freeze([
  'server/task-verification-execution.mjs', 'server/task-verification-state.mjs',
  'server/forward-progress-reader.mjs', 'src/controls/detachedHistoryLocator.ts', 'src/controls/historyView.ts',
  'src/controls/historyEntitlement.ts', 'src/controls/historyMilestone.ts', 'src/controls/historyDiscovery.ts', 'src/sdk/conformance.ts',
  'server/forward-progress-service.mjs', 'src/wallet/forwardProgress.ts', 'src/wallet/linkedChainView.ts', 'src/sdk/types.ts',
  // linkedChainView uses sdk/linked.ts only via import type; native type
  // stripping does not load it. Keep this list an exact executable closure.
  'server/task-runtime-import-probe.mjs', 'server/task-exact-runtime.mjs', 'server/task-runtime-composition.mjs',
  'server/task-test-nft721-binding.mjs', 'server/task-test-nft721-metadata.mjs',
  'server/task-exact-chain-state.mjs',
  'server/task-exact-bootstrap.mjs', 'server/task-exact-config.mjs', 'server/task-exact-sign-only.mjs', 'server/task-test-asset-authorization.mjs', 'server/task-test-mint-contract.mjs', 'server/task-test-nft721-contract.mjs',
  'server/task-listing-runtime.mjs', 'server/task-listing-bootstrap.mjs', 'server/task-listing-config.mjs',
  'server/task-listing-installed.mjs', 'server/task-listing-package-pin.mjs', 'server/task-listing-transport.mjs',
  'server/task-journal-capabilities.mjs', 'server/task-receipt-runtime.mjs',
  'server/task-listing-results.mjs', 'web/task-listing-results.mjs', 'web/task-observer-context.mjs',
  'server/task-observation-sources.mjs',
  'server/task-native-listing-composition.mjs', 'server/task-listing-observation-consumer.mjs',
  'server/task-exact-operation-planner.mjs', 'server/task-exact-signer-adapter.mjs', 'server/task-operation-encoding.mjs',
  'server/receipt-operation-encoding.mjs', 'server/receipt-provider-handler.mjs', 'src/agent/receiptTask.ts',
  'src/agent/receiptObservation.ts', 'src/agent/taskContract.ts', 'src/codec/abi.ts', 'src/codec/keccak.ts',
  'src/controls/accounts.ts', 'src/controls/authorization.ts', 'src/controls/client.ts', 'src/controls/execution.ts',
  'src/sdk/errors.ts', 'src/sdk/interfaceIds.ts', 'src/xiongan/address.ts', 'src/xiongan/externalAssets.ts',
]);
// Retained source contracts are packaged but never counted as executable imports.
export const TASK_TYPE_SOURCE_PATHS = Object.freeze(['src/sdk/linked.ts']);
export const sourcePathAllowed = path => path === TASK_LISTING_PACKAGE_PIN.artifactPath || TASK_RUNTIME_SOURCE_PATHS.includes(path) || TASK_TYPE_SOURCE_PATHS.includes(path) || LEGAL_FILES.includes(path) || /^(?:server\/[a-z][a-z0-9-]*\.mjs|web\/(?:login-core|wallet-entry)\.mjs|deploy\/auth-runtime\/(?:(?:install|migrate-legacy)\.mjs|8415wallet-auth\.service|auth-location\.nginx\.conf)|docs\/AUTH-INSTALL\.md|scripts\/package\/verify-auth\.mjs|LICENSE)$/.test(path);
export function safePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 240 && /^[A-Za-z0-9_@.+/=-]+$/.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..');
}
export function packagePathAllowed(path) {
  return safePath(path) && (sourcePathAllowed(path)
    || ['package.json', 'package-lock.json', 'AUTH-RELEASE.json', 'SHA256SUMS', 'provenance/package.source.json', 'provenance/package-lock.source.json'].includes(path)
    || (path.startsWith('node_modules/') && !path.split('/').some(part => part.startsWith('.') || /^(?:config|credentials|store-key)$/i.test(part))));
}
export function walkAuth(root, prefix = '') {
  const rootStat = lstatSync(join(root, prefix));
  fail(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'DIRECTORY_REFUSED');
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    const path = prefix ? `${prefix}/${name}` : name;
    fail(safePath(path), 'PATH_REFUSED');
    const stat = lstatSync(join(root, path));
    fail(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), 'LINK_OR_SPECIAL_FILE_REFUSED');
    fail(!(stat.mode & 0o7022), 'WRITABLE_OR_SPECIAL_MODE_REFUSED');
    if (stat.isDirectory()) return walkAuth(root, path);
    fail(!(stat.mode & 0o111) && stat.nlink === 1, 'EXECUTABLE_OR_HARDLINK_REFUSED');
    return [path];
  });
}

/** Reconstruct the recorded Git tree from blob identities, without requiring Git. */
export function sourceTree(entries) {
  fail(Array.isArray(entries) && entries.length > 0 && entries.length <= 20000, 'SOURCE_ENTRIES_REFUSED');
  const root = new Map();
  const seen = new Set();
  for (const entry of entries) {
    fail(entry && safePath(entry.path) && /^(100644|100755)$/.test(entry.mode) && gitPattern.test(entry.object), 'SOURCE_ENTRY_REFUSED');
    fail(!seen.has(entry.path), 'SOURCE_DUPLICATE_REFUSED'); seen.add(entry.path);
    const parts = entry.path.split('/'); let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.has(part)) node.set(part, new Map());
      fail(node.get(part) instanceof Map, 'SOURCE_COLLISION_REFUSED'); node = node.get(part);
    }
    fail(!node.has(parts.at(-1)), 'SOURCE_COLLISION_REFUSED'); node.set(parts.at(-1), entry);
  }
  const tree = node => {
    const entries = [...node].map(([name, value]) => ({ name, directory: value instanceof Map, value }));
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.name + (a.directory ? '/' : '')), Buffer.from(b.name + (b.directory ? '/' : ''))));
    return objectHash('tree', Buffer.concat(entries.map(({ name, directory, value }) => Buffer.concat([
      Buffer.from(`${directory ? '40000' : value.mode} ${name}\0`), Buffer.from(directory ? tree(value) : value.object, 'hex'),
    ]))));
  };
  return tree(root);
}

/** Derive only the exact, lockfile-pinned production graph; npm still validates its closure. */
export function runtimePackage(sourcePackage, sourceLock) {
  fail(sourcePackage?.name === '8415wallet' && sourceLock?.lockfileVersion === 3, 'SOURCE_PACKAGE_REFUSED');
  const deps = Object.keys(sourcePackage.dependencies ?? {}).sort();
  const listing = deps.join() === '@artfi/task-listing-runtime,ethers';
  fail(listing || deps.join() === 'ethers', 'DEPENDENCY_ALLOWLIST_REFUSED');
  if (listing) fail(sourcePackage.dependencies['@artfi/task-listing-runtime'] === `file:${TASK_LISTING_PACKAGE_PIN.artifactPath}`, 'LISTING_ARTIFACT_SOURCE_REFUSED');
  const bundlePins = new Map(TASK_LISTING_PACKAGE_PIN.packages.map(p => [`node_modules/@artfi/task-listing-runtime/${p.path}`, p]));
  assert.deepEqual(sourceLock.packages?.['']?.dependencies, sourcePackage.dependencies, 'AUTH_PACKAGE_SOURCE_LOCK_ROOT_MISMATCH');
  const entries = Object.entries(sourceLock.packages ?? {}).filter(([path, info]) => path && !info.dev);
  fail(entries.length > 0 && entries.length < 100, 'DEPENDENCY_GRAPH_REFUSED');
  for (const [path, info] of entries) {
    fail(safePath(path) && /^(?:node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)(?:\/node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+)*$/.test(path), 'DEPENDENCY_PATH_REFUSED');
    fail(!info.link && !info.hasInstallScript && !info.optional && typeof info.version === 'string', 'DEPENDENCY_METADATA_REFUSED');
    if (listing && path === 'node_modules/@artfi/task-listing-runtime') {
      fail(info.version === TASK_LISTING_PACKAGE_PIN.packageVersion && info.resolved === `file:${TASK_LISTING_PACKAGE_PIN.artifactPath}` &&
        info.integrity === TASK_LISTING_PACKAGE_PIN.artifactIntegrity, 'LISTING_ARTIFACT_LOCK_REFUSED');
    } else if (listing && bundlePins.has(path)) {
      const pin = bundlePins.get(path);
      fail(info.inBundle === true && info.version === pin.version && !info.resolved && !info.integrity, 'LISTING_BUNDLE_LOCK_REFUSED');
    } else fail(/^https:\/\/registry\.npmjs\.org\//.test(info.resolved ?? '') && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(info.integrity ?? '') && !info.inBundle, 'DEPENDENCY_METADATA_REFUSED');
  }
  const ethers = sourceLock.packages['node_modules/ethers'];
  fail(ethers && /^\d+\.\d+\.\d+$/.test(ethers.version), 'ETHERS_PIN_REQUIRED');
  const manifest = { name: '8415wallet-auth-runtime', version: sourcePackage.version, private: true, type: 'module',
    license: sourcePackage.license, engines: { node: '>=22.18.0' },
    scripts: { start: 'node server/runtime-entry.mjs', 'operator:initialize': 'node server/operator-init.mjs', 'operator:activate': 'node server/operator-activate.mjs' },
    dependencies: { ethers: ethers.version, ...(listing ? { '@artfi/task-listing-runtime': `file:${TASK_LISTING_PACKAGE_PIN.artifactPath}` } : {}) } };
  if (listing) fail([...bundlePins].every(([path,pin]) => sourceLock.packages[path]?.inBundle === true && sourceLock.packages[path]?.version === pin.version), 'LISTING_BUNDLE_INCOMPLETE');
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: { '': { name: manifest.name, version: manifest.version, license: manifest.license, dependencies: manifest.dependencies, engines: manifest.engines },
      ...Object.fromEntries(entries) } };
  return { manifest, lock };
}

export function verifyTaskListingArtifact(directory) {
  const path = join(directory, TASK_LISTING_PACKAGE_PIN.artifactPath);
  fail(sha256(readFileSync(path)) === TASK_LISTING_PACKAGE_PIN.artifactSha256, 'LISTING_ARTIFACT_DIGEST_MISMATCH');
}
export function verifyInstalledTaskListingPackage(directory) {
  const root = join(directory, 'node_modules/@artfi/task-listing-runtime');
  const bytes = readFileSync(join(root, 'runtime-manifest.json'));
  fail(sha256(bytes) === TASK_LISTING_PACKAGE_PIN.manifestSha256, 'LISTING_MANIFEST_DIGEST_MISMATCH');
  const manifest = JSON.parse(bytes);
  fail(manifest.packageName === TASK_LISTING_PACKAGE_PIN.packageName && manifest.packageVersion === TASK_LISTING_PACKAGE_PIN.packageVersion &&
    manifest.source.fingerprint === TASK_LISTING_PACKAGE_PIN.sourceFingerprint, 'LISTING_SOURCE_IDENTITY_MISMATCH');
  assert.deepEqual(manifest.packages, TASK_LISTING_PACKAGE_PIN.packages, 'AUTH_PACKAGE_LISTING_PACKAGE_PINS_MISMATCH');
  assert.deepEqual(walkAuth(root).sort(), [...Object.keys(manifest.files), 'runtime-manifest.json'].sort(), 'AUTH_PACKAGE_LISTING_COMPLETE_INVENTORY');
  for (const [path, expected] of Object.entries(manifest.files)) {
    fail(safePath(path) && hashPattern.test(expected) && sha256(readFileSync(join(root, path))) === expected, 'LISTING_FILE_DIGEST_MISMATCH');
  }
  for (const pin of TASK_LISTING_PACKAGE_PIN.packages) {
    const bytes = readFileSync(join(root, pin.path, 'package.json')), pkg = JSON.parse(bytes);
    fail(sha256(bytes) === pin.normalizedPackageSha256 && pkg.name === pin.name && pkg.version === pin.version &&
      !['preinstall', 'install', 'postinstall', 'prepare'].some(key => Object.hasOwn(pkg.scripts ?? {}, key)), 'LISTING_DEPENDENCY_REFUSED');
  }
}
export function verifyAuthDirectory(directory, options = {}) {
  const policy = authSourcePolicy(options);
  const files = walkAuth(directory);
  fail(files.every(packagePathAllowed), 'PAYLOAD_ALLOWLIST_REFUSED');
  const release = JSON.parse(readFileSync(join(directory, 'AUTH-RELEASE.json'), 'utf8'));
  fail(release.schema === AUTH_SCHEMA && release.status === AUTH_STATUS, 'SCHEMA_OR_STATUS_REFUSED');
  fail(release.runtime?.node === '>=22.18.0' && release.runtime?.bundledNode === false && release.runtime?.bundledProductionDependencies === true, 'RUNTIME_DECLARATION_REFUSED');
  authStateSemantics(release);
  const source = release.source;
  fail(source && gitPattern.test(source.commit) && gitPattern.test(source.commitTree) && gitPattern.test(source.indexTree) && gitPattern.test(source.tree), 'SOURCE_IDENTITY_REFUSED');
  const commitBytes = Buffer.from(source.commitObject, 'base64');
  fail(objectHash('commit', commitBytes) === source.commit && commitBytes.toString().startsWith(`tree ${source.commitTree}\n`), 'COMMIT_IDENTITY_MISMATCH');
  fail(sourceTree(source.entries) === source.tree && source.dirty === (source.tree !== source.commitTree), 'SOURCE_TREE_MISMATCH');
  verifyAuthSourcePolicy(source, policy);
  const sourceEntries = new Map(source.entries.map(entry => [entry.path, entry]));
  const expectedFiles = files.filter(file => !['AUTH-RELEASE.json', 'SHA256SUMS'].includes(file));
  assert.deepEqual(expectedFiles.filter(sourcePathAllowed), source.entries.map(entry => entry.path).filter(sourcePathAllowed).sort(), 'AUTH_PACKAGE_SOURCE_PAYLOAD_COMPLETENESS');
  fail(release.files && typeof release.files === 'object' && !Array.isArray(release.files), 'INVENTORY_REQUIRED');
  assert.deepEqual(Object.keys(release.files).sort(), [...expectedFiles].sort(), 'AUTH_PACKAGE_COMPLETE_FILE_INVENTORY');
  for (const file of expectedFiles) {
    fail(hashPattern.test(release.files[file]) && sha256(readFileSync(join(directory, file))) === release.files[file], `FILE_DIGEST_MISMATCH: ${file}`);
    if (sourcePathAllowed(file)) fail(sourceEntries.has(file) && objectHash('blob', readFileSync(join(directory, file))) === sourceEntries.get(file).object, `SOURCE_BLOB_MISMATCH: ${file}`);
  }
  for (const [original, packaged] of [['package.json', 'provenance/package.source.json'], ['package-lock.json', 'provenance/package-lock.source.json']]) {
    fail(sourceEntries.has(original) && objectHash('blob', readFileSync(join(directory, packaged))) === sourceEntries.get(original).object, 'SOURCE_PACKAGE_BLOB_MISMATCH');
  }
  const required = ['server/main.mjs', 'server/service-entry.mjs', 'server/runtime-entry.mjs', 'server/auth-service.mjs', 'server/crypto.mjs', 'server/config-validation.mjs', 'server/ca-verifier.mjs', 'server/store.mjs', 'server/operator-init.mjs', 'server/operator-activate.mjs', 'web/login-core.mjs', 'deploy/auth-runtime/install.mjs', 'deploy/auth-runtime/8415wallet-auth.service', 'deploy/auth-runtime/auth-location.nginx.conf', 'docs/AUTH-INSTALL.md', 'scripts/package/verify-auth.mjs', 'LICENSE'];
  if (authStateSemantics(release) === AUTH_STATE_SEMANTICS) required.push('server/task-background-runner.mjs', 'server/task-authorization.mjs', 'server/task-receipt-adapter.mjs', 'server/method-change-service.mjs', ...TASK_RUNTIME_SOURCE_PATHS);
  // The parameterized compatibility entry must not ship without its parser.
  // Historical immutable packages without this import retain their exact
  // inventory contract; no source or checksum assertion is relaxed.
  if (expectedFiles.includes('server/service-entry.mjs') &&
      readFileSync(join(directory, 'server/service-entry.mjs'), 'utf8').includes("from './credential-instance.mjs'")) {
    required.push('server/credential-instance.mjs');
  }
  fail(required.every(file => expectedFiles.includes(file)), 'REQUIRED_FILE_MISSING');
  const sourcePackage = JSON.parse(readFileSync(join(directory, 'provenance/package.source.json'), 'utf8'));
  const sourceLock = JSON.parse(readFileSync(join(directory, 'provenance/package-lock.source.json'), 'utf8'));
  if (sourcePackage.license === 'SEE LICENSE IN LICENSE')
    fail(LEGAL_FILES.every(file => expectedFiles.includes(file)), 'REQUIRED_LEGAL_FILE_MISSING');
  const runtime = runtimePackage(sourcePackage, sourceLock);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')), runtime.manifest, 'AUTH_PACKAGE_RUNTIME_PACKAGE_MISMATCH');
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8')), runtime.lock, 'AUTH_PACKAGE_RUNTIME_LOCK_MISMATCH');
  if (runtime.manifest.dependencies['@artfi/task-listing-runtime']) { verifyTaskListingArtifact(directory); verifyInstalledTaskListingPackage(directory); }
  const dependencyRoots = Object.keys(runtime.lock.packages).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const path of dependencyRoots) {
    const installed = JSON.parse(readFileSync(join(directory, path, 'package.json'), 'utf8'));
    fail(installed.name === path.split('node_modules/').at(-1) && installed.version === runtime.lock.packages[path].version, 'DEPENDENCY_VERSION_MISMATCH');
    fail(!['preinstall', 'install', 'postinstall', 'prepare'].some(script => Object.hasOwn(installed.scripts ?? {}, script)), 'DEPENDENCY_INSTALL_SCRIPT_REFUSED');
  }
  for (const file of expectedFiles.filter(file => file.startsWith('node_modules/'))) {
    const owner = dependencyRoots.find(path => file.startsWith(`${path}/`));
    fail(owner && !file.slice(owner.length + 1).split('/').includes('node_modules'), 'UNLOCKED_DEPENDENCY_REFUSED');
  }
  const sums = files.filter(file => file !== 'SHA256SUMS').map(file => `${sha256(readFileSync(join(directory, file)))}  ${file}`).join('\n') + '\n';
  fail(readFileSync(join(directory, 'SHA256SUMS'), 'utf8') === sums, 'CHECKSUM_INVENTORY_MISMATCH');
  return release;
}

/** Strict bounded USTAR reader: validate every header before writing any file. */
function scanAuthTar(read, length) {
  fail(length <= 256 * 1024 * 1024 && length % 512 === 0, 'TAR_LENGTH_REFUSED');
  const entries = []; const seen = new Set(); let offset = 0; let terminated = false;
  const string = buffer => buffer.subarray(0, buffer.indexOf(0) < 0 ? buffer.length : buffer.indexOf(0)).toString('utf8');
  const octal = buffer => { const value = string(buffer).trim(); fail(/^[0-7]+$/.test(value), 'TAR_NUMBER_REFUSED'); return parseInt(value, 8); };
  const zeroes = (start, end, code) => {
    for (let at = start; at < end; at += 65536) fail(read(at, Math.min(65536, end - at)).every(byte => byte === 0), code);
  };
  while (offset + 512 <= length) {
    const header = read(offset, 512); offset += 512;
    if (header.every(byte => byte === 0)) { fail(offset + 512 <= length, 'TAR_TRAILING_DATA_REFUSED'); zeroes(offset, length, 'TAR_TRAILING_DATA_REFUSED'); terminated = true; break; }
    const checksum = octal(header.subarray(148, 156));
    fail(checksum === [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0), 'TAR_CHECKSUM_MISMATCH');
    fail(string(header.subarray(257, 263)) === 'ustar' && header.subarray(263, 265).toString() === '00', 'TAR_FORMAT_REFUSED');
    fail(header[156] === 48 && header.subarray(157, 257).every(byte => byte === 0), 'TAR_LINK_OR_TYPE_REFUSED');
    fail(octal(header.subarray(100, 108)) === 0o644 && octal(header.subarray(108, 116)) === 0 && octal(header.subarray(116, 124)) === 0 && octal(header.subarray(136, 148)) === 0, 'TAR_METADATA_REFUSED');
    const name = string(header.subarray(0, 100)); const prefix = string(header.subarray(345, 500));
    const path = prefix ? `${prefix}/${name}` : name;
    fail(packagePathAllowed(path) && !seen.has(path), 'TAR_PATH_OR_DUPLICATE_REFUSED'); seen.add(path);
    const size = octal(header.subarray(124, 136)); fail(size <= 32 * 1024 * 1024 && offset + size <= length, 'TAR_ENTRY_SIZE_REFUSED');
    entries.push({ path, offset, size });
    fail(entries.length <= 20000, 'TAR_ENTRY_COUNT_REFUSED');
    const padded = Math.ceil(size / 512) * 512;
    fail(offset + padded <= length, 'TAR_ENTRY_SIZE_REFUSED');
    zeroes(offset + size, offset + padded, 'TAR_PADDING_REFUSED'); offset += padded;
  }
  fail(terminated && entries.length > 0, 'TAR_TERMINATOR_REQUIRED');
  return entries;
}
export function readAuthArchive(bytes) {
  fail(bytes.length <= 128 * 1024 * 1024, 'ARCHIVE_TOO_LARGE');
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  return scanAuthTar((offset, size) => tar.subarray(offset, offset + size), tar.length)
    .map(({ path, offset, size }) => ({ path, bytes: tar.subarray(offset, offset + size) }));
}
export function unpackAuthArchive(archive) {
  fail(lstatSync(archive).size <= 128 * 1024 * 1024, 'ARCHIVE_TOO_LARGE');
  const spool = mkdtempSync(join(tmpdir(), 'wallet-auth-verify-spool-'));
  const tarPath = join(spool, 'payload.tar');
  let descriptor, directory;
  try {
    const output = openSync(tarPath, 'wx', 0o600);
    try {
      // Bounded streaming expansion avoids retaining the entire tar and all
      // payload subarrays during the independent directory verification.
      // Only inherited descriptors and this private spool are used by the child.
      const script = `const {createReadStream,createWriteStream}=require('node:fs');const {createGunzip}=require('node:zlib');const {Transform}=require('node:stream');const {pipeline}=require('node:stream/promises');let n=0;pipeline(createReadStream(process.argv[1]),createGunzip(),new Transform({transform(b,e,c){n+=b.length;c(n>268435456?Error('AUTH_PACKAGE_TAR_LENGTH_REFUSED'):null,b)}}),createWriteStream(null,{fd:1,autoClose:false})).catch(e=>{console.error(e.message);process.exitCode=1});`;
      const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=96' }; delete env.NODE_PATH;
      execFileSync(process.execPath, ['-e', script, resolve(archive)], { env, stdio: ['ignore', output, 'pipe'], timeout: 60000, maxBuffer: 65536 });
    } finally { closeSync(output); }
    descriptor = openSync(tarPath, 'r');
    const read = (offset, size) => {
      const bytes = Buffer.allocUnsafe(size); let received = 0;
      while (received < size) { const n = readSync(descriptor, bytes, received, size - received, offset + received); fail(n > 0, 'TAR_LENGTH_REFUSED'); received += n; }
      return bytes;
    };
    // Validate every header, duplicate, padding and terminator before writing
    // any extracted file. No external tar parser replaces these strict checks.
    const entries = scanAuthTar(read, fstatSync(descriptor).size);
    directory = mkdtempSync(join(tmpdir(), 'wallet-auth-verify-'));
    for (const { path, offset, size } of entries) { mkdirSync(dirname(join(directory, path)), { recursive: true, mode: 0o755 }); writeFileSync(join(directory, path), read(offset, size), { flag: 'wx', mode: 0o644 }); }
    return directory;
  } catch (error) { if (directory) rmSync(directory, { recursive: true, force: true }); throw error; }
  finally { if (descriptor !== undefined) closeSync(descriptor); rmSync(spool, { recursive: true, force: true }); }
}

export function verifyAuthArchive(manifestPath, options = {}) {
  const policy = authSourcePolicy(options);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  fail(/^8415wallet-auth-runtime-[0-9a-f]{40}\.tar\.gz$/.test(manifest.artifact) && hashPattern.test(manifest.sha256), 'MANIFEST_ARTIFACT_REFUSED');
  const archive = join(dirname(resolve(manifestPath)), manifest.artifact);
  fail(sha256(readFileSync(archive)) === manifest.sha256, 'ARCHIVE_DIGEST_MISMATCH');
  const directory = unpackAuthArchive(archive);
  try {
    const release = verifyAuthDirectory(directory, policy);
    const { artifact: _artifact, sha256: _sha256, ...expectedRelease } = manifest;
    assert.deepEqual(release, expectedRelease, 'AUTH_PACKAGE_MANIFEST_RELEASE_MISMATCH');
    return release;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { target, policy } = parseAuthVerifyArguments(process.argv.slice(2));
  const release = target.kind === 'directory' ? verifyAuthDirectory(resolve(target.path), policy) : verifyAuthArchive(resolve(target.path), policy);
  console.log(`Auth package integrity verified; source ${release.source.tree}; ${release.status}. Checksums establish integrity, not publisher authenticity or deployment acceptance.`);
}

