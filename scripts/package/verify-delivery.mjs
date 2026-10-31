/** Dependency-free, externally pinned verification of the complete reusable DApp kit. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, readdirSync, openSync, closeSync, readSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_FILES, PUBLIC_LEGAL_FILES, safePath, sha256, sourceTree, withArchiveTar, unpackAuthArchive, verifyAuthDirectory, walkAuth, authPathIdentity } from './verify-auth.mjs';
import { resolveReleaseProfile } from '../../web/release-profile.mjs';
import { validatePasswordRoutes } from '../../web/tenant-password-routing.mjs';
export { sha256 };
export const DELIVERY_SCHEMA = '8415wallet-dapp-delivery/1';
export const DELIVERY_FILES = ['deploy/dapp/install.mjs', 'scripts/controls/canonical-entry.cjs', 'scripts/package/verify-delivery.mjs', 'scripts/package/verify-auth.mjs',
  'server/task-listing-package-pin.mjs',
  'web/image-policy.mjs', 'web/release-profile.mjs', 'web/tenant-password-routing.mjs', 'web/wallet-entry.mjs','web/tenant-path.mjs', 'config/releases/v2.json', 'config/releases/v3.json', 'config/releases/xiongan-v2.json',
  'docs/WALLET-BINDING-LIFECYCLE.md', 'docs/AUTH-METHOD-CHANGES.md', 'docs/COORDINATED-PENDING-READ.md', 'docs/NFT-IMAGE-ORIGIN-POLICY.md', 'docs/FUNDS-READ-CONTRACT.md', 'docs/NFT-INVENTORY-READ-CONTRACT.md', 'docs/DAPP-INSTALL.md', 'docs/AUTH-INSTALL.md', ...LEGAL_FILES];
const fail = (condition, code) => { if (!condition) throw Error(`DAPP_DELIVERY_${code}`); };
const digestPattern = /^[0-9a-f]{64}$/;
const treePattern = /^[0-9a-f]{40}$/;
const parsed = bytes => JSON.parse(bytes.toString('utf8'));

/** Read the exact regular-file/directory GNU or USTAR subset emitted by our packers.
 * No extraction subprocess, PAX overrides, links, devices, duplicates or traversal.
 * Reject unsupported long-name records rather than silently interpreting them. */
function scanDeliveryTar(read, length, visit) {
  fail(length % 512 === 0, 'TAR_LENGTH_REFUSED');
  const zeroes = (start, end, code) => {
    for (let at = start; at < end; at += 65536) fail(read(at, Math.min(65536, end - at)).every(byte => byte === 0), code);
  };
  const entries = new Map(), seen = new Map(); let offset = 0, terminated = false;
  const string = buffer => {
    const end = buffer.indexOf(0); const value = end < 0 ? buffer : buffer.subarray(0, end);
    fail([...value].every(byte => byte >= 32 && byte <= 126), 'TAR_STRING_REFUSED');
    fail(end < 0 || buffer.subarray(end).every(byte => byte === 0), 'TAR_STRING_PADDING_REFUSED');
    return value.toString('ascii');
  };
  const octal = buffer => { const value = buffer.toString('ascii').replace(/[\0 ]+$/, '').trim(); fail(/^[0-7]+$/.test(value), 'TAR_NUMBER_REFUSED'); const n = parseInt(value, 8); fail(Number.isSafeInteger(n), 'TAR_NUMBER_REFUSED'); return n; };
  while (offset + 512 <= length) {
    const header = read(offset, 512); offset += 512;
    if (header.every(byte => byte === 0)) { fail(offset + 512 <= length, 'TAR_TRAILING_DATA_REFUSED'); zeroes(offset, length, 'TAR_TRAILING_DATA_REFUSED'); terminated = true; break; }
    fail(octal(header.subarray(148, 156)) === [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0), 'TAR_CHECKSUM_MISMATCH');
    const gnu = header.subarray(257, 265).equals(Buffer.from('ustar  \0'));
    const ustar = header.subarray(257, 265).equals(Buffer.from('ustar\0' + '00'));
    fail(gnu || ustar, 'TAR_FORMAT_REFUSED');
    fail([0, 48, 53].includes(header[156]) && header.subarray(157, 257).every(byte => byte === 0), 'TAR_LINK_OR_TYPE_REFUSED');
    const directory = header[156] === 53;
    const mode = octal(header.subarray(100, 108));
    fail((directory ? mode === 0o755 : [0o644, 0o755].includes(mode)) && octal(header.subarray(108, 116)) === 0 && octal(header.subarray(116, 124)) === 0 && octal(header.subarray(136, 148)) === 0, 'TAR_METADATA_REFUSED');
    const name = string(header.subarray(0, 100));
    const prefix = ustar ? string(header.subarray(345, 500)) : '';
    if (gnu) fail(header.subarray(345).every(byte => byte === 0), 'TAR_EXTENSION_REFUSED');
    let path = prefix ? `${prefix}/${name}` : name;
    if (path.startsWith('./')) path = path.slice(2);
    if (directory && path.endsWith('/')) path = path.slice(0, -1);
    fail((directory && path === '') || safePath(path), 'TAR_PATH_REFUSED');
    fail(!seen.has(path), 'TAR_DUPLICATE_REFUSED'); seen.set(path, directory);
    const size = octal(header.subarray(124, 136)), padded = Math.ceil(size / 512) * 512;
    fail(size <= 96 * 1024 * 1024 && (!directory || size === 0) && offset + padded <= length, 'TAR_ENTRY_SIZE_REFUSED');
    if (!directory) entries.set(path, visit ? visit(path, read, offset, size, mode) : { bytes: read(offset, size), mode });
    zeroes(offset + size, offset + padded, 'TAR_PADDING_REFUSED'); offset += padded;
    fail(seen.size <= 25000, 'TAR_ENTRY_COUNT_REFUSED');
  }
  fail(terminated && entries.size > 0, 'TAR_TERMINATOR_REQUIRED');
  for (const path of seen.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) fail(seen.get(parts.slice(0, i).join('/')) !== false, 'TAR_PATH_COLLISION_REFUSED');
  }
  return entries;
}
/** Keep only file payloads, never a second complete expanded TAR backing store. */
export function readDeliveryArchive(archive, expectedSha256) {
  fail(Buffer.isBuffer(archive) || typeof archive === 'string', 'ARCHIVE_SIZE_REFUSED');
  const size = Buffer.isBuffer(archive) ? archive.length : lstatSync(archive).size;
  fail(size <= 128 * 1024 * 1024, 'ARCHIVE_SIZE_REFUSED');
  return withArchiveTar(archive, scanDeliveryTar, expectedSha256 === undefined ? undefined : digest => fail(digest === expectedSha256, 'ARCHIVE_DIGEST_MISMATCH'));
}
const hashes = entries => Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, entry]) => [path, sha256(entry.bytes)]));
const get = (entries, path) => { fail(entries.has(path), `FILE_MISSING: ${path}`); return entries.get(path).bytes; };
const sums = entries => [...entries].filter(([path]) => path !== 'SHA256SUMS').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, entry]) => `${sha256(entry.bytes)}  ${path}`).join('\n') + '\n';
export function isPublicFile(path) {
  return PUBLIC_LEGAL_FILES.includes(path) || safePath(path) && /^(web\/|dist\/browser\/)/.test(path) && !path.split('/').some(part => part.startsWith('.'))
    && (/\.(?:html|mjs|js|css|json|svg|png|jpg|jpeg|webp|ico|woff|woff2|ttf)$/.test(path) || ['web/assets/license-dm-sans.txt', 'dist/browser/vendor/ETHERS-LICENSE.md'].includes(path));
}
export function verifyDappEntries(entries, manifest, source, profileId) {
  const release = parsed(get(entries, 'RELEASE.json'));
  const { artifact, sha256: digest, ...expected } = manifest;
  assert.deepEqual(release, expected, 'DAPP_DELIVERY_UI_MANIFEST_MISMATCH');
  fail(release.schema === '8415wallet-dapp-release/2' && release.profile === profileId && release.source?.tree === source.tree, 'UI_IDENTITY_REFUSED');
  const config = parsed(get(entries, 'web/release-config.json')), profile = resolveReleaseProfile(config);
  fail(profile.id === profileId && profile.version === release.version && profile.status === release.status, 'UI_PROFILE_MISMATCH');
  assert.deepEqual(profile.tenant, release.tenant); assert.deepEqual(profile.deployment, release.deployment); assert.deepEqual(profile.features, release.features);
  fail(release.build.configSha256 === sha256(get(entries, 'web/release-config.json')), 'UI_CONFIG_MISMATCH');
  fail(release.prd?.sha256 === sha256(get(entries, release.prd.file)), 'UI_PRD_MISMATCH');
  fail(get(entries, 'SHA256SUMS').toString() === sums(entries), 'UI_INVENTORY_MISMATCH');
  if (source.license === 'SEE LICENSE IN LICENSE') {
    for (const path of LEGAL_FILES) {
      fail(sha256(get(entries, path)) === source.files[path], 'UI_LEGAL_SOURCE_MISMATCH');
      fail(get(entries, `web/legal/${path}`).equals(get(entries, path)), 'UI_LEGAL_RUNTIME_MISMATCH');
    }
  }
  const runtime = new Map([...entries].filter(([path]) => /^(web\/|dist\/browser\/)/.test(path)));
  fail(runtime.size > 0 && [...runtime.keys()].every(isPublicFile) && runtime.has('web/index.html'), 'UI_PUBLIC_FILES_REFUSED');
  assert.deepEqual(hashes(runtime), release.runtimeFiles, 'DAPP_DELIVERY_UI_RUNTIME_MISMATCH');
  for (const path of ['web/tenant-password-routing.mjs', 'web/tenant-password-ui.mjs', 'web/tenant-password-routing.json'])
    fail(runtime.has(path), 'PASSWORD_ROUTING_RUNTIME_MISSING');
  const passwordRoutes = validatePasswordRoutes(parsed(get(entries, 'web/tenant-password-routing.json')));
  fail(passwordRoutes.length === 0, 'PASSWORD_ROUTING_EMPTY_TOMBSTONE_REQUIRED');
  assert.deepEqual(release.source.files, source.files, 'DAPP_DELIVERY_SOURCE_INVENTORY_MISMATCH');
  return { release, runtime };
}
/** Verify source payloads in bounded chunks; retain hashes, not the full source tree.
 * The same strict TAR scanner validates metadata, paths, padding and completeness. */
export function verifyDeliverySourceArchive(archive, expectedEntries, tools, expectedTree) {
  const expected = new Map(expectedEntries.map(entry => [entry.path, entry]));
  let license;
  const blockBuffer = Buffer.allocUnsafe(65536);
  return withArchiveTar(archive, (read, length) => {
    const entries = scanDeliveryTar(read, length, (path, read, offset, size, mode) => {
      const entry = expected.get(path);
      fail(entry && mode === (entry.mode === '100755' ? 0o755 : 0o644), 'SOURCE_BLOB_MISMATCH');
      const blob = createHash('sha1').update(`blob ${size}\0`), digest = createHash('sha256');
      const tool = DELIVERY_FILES.includes(path) ? get(tools, path) : undefined;
      if (tool) fail(tool.length === size, 'TOOL_SOURCE_MISMATCH');
      for (let at = 0; at < size; at += 65536) {
        const block = read(offset + at, Math.min(65536, size - at), blockBuffer);
        blob.update(block); digest.update(block);
        if (tool) fail(block.equals(tool.subarray(at, at + block.length)), 'TOOL_SOURCE_MISMATCH');
      }
      fail(blob.digest('hex') === entry.object, 'SOURCE_BLOB_MISMATCH');
      if (path === 'package.json') license = parsed(read(offset, size)).license;
      return { sha256: digest.digest('hex') };
    });
    assert.deepEqual([...entries.keys()].sort(), expectedEntries.map(entry => entry.path).sort(), 'DAPP_DELIVERY_SOURCE_COMPLETENESS');
    for (const path of DELIVERY_FILES) fail(entries.has(path), `FILE_MISSING: ${path}`);
    fail(entries.has('package.json'), 'FILE_MISSING: package.json');
    return { tree: expectedTree, files: Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, entry]) => [path, entry.sha256])), license };
  });
}
/** Optional synchronous stage events. A started stage is not acceptance evidence.
 * Never include paths, input bytes or caught exception text in progress events. */
export function writeVerificationProgress(event, write = writeSync) {
  const bytes = Buffer.from(JSON.stringify({ schema: '8415wallet-verification-progress/1', ...event }) + '\n');
  for (let offset = 0; offset < bytes.length;) {
    const written = write(2, bytes, offset, bytes.length - offset);
    fail(Number.isInteger(written) && written > 0 && written <= bytes.length - offset, 'PROGRESS_WRITE_FAILED');
    offset += written;
  }
}
export function verificationStage(onProgress, stage, operation) {
  fail(onProgress === undefined || typeof onProgress === 'function', 'PROGRESS_CALLBACK_REFUSED');
  const started = performance.now();
  // Progress is best-effort only: a broken diagnostic sink must neither skip
  // validation nor change resource ownership after an operation succeeds.
  const emit = state => {
    try { onProgress?.({ stage, state, elapsedMs: Math.max(0, performance.now() - started) }); } catch { /* Diagnostics are not the result channel. */ }
  };
  emit('started');
  try {
    const result = operation();
    emit('completed');
    return result;
  } catch (error) {
    emit('failed');
    throw error;
  }
}
export function finalizeVerificationResources({ originalError, cleanupAuth, cleanupTemporary, rollback }) {
  const errors=[];
  for(const cleanup of [cleanupAuth,cleanupTemporary]) {try{cleanup();}catch(error){errors.push(error);}}
  if(errors.length) {
    try{rollback?.();}catch(error){errors.push(error);}
    throw new AggregateError(originalError?[originalError,...errors]:errors,'DAPP_DELIVERY_VERIFICATION_CLEANUP_NOT_CONFIRMED');
  }
}
const boundedCleanup = Symbol('bounded target cleanup');
/** CLI-only consumer. Assumes private, controlled ancestors, as the original
 * extractor does. Path checks detect drift; they are not openat2 isolation from
 * a hostile process running as the same uid/root. No retained auth payload Map. */
export function consumeVerifiedAuth(directory, snapshot, { entries = new Map(), destination } = {}) {
  const identity = stat => authPathIdentity(stat);
  const same = (actual, expected, code) => fail(JSON.stringify(actual) === JSON.stringify(expected), code);
  const anchor = path => {
    const st = lstatSync(path, { bigint: true });
    fail(st.isDirectory() && !st.isSymbolicLink() && realpathSync(path) === resolve(path), 'PHYSICAL_DIRECTORY_REQUIRED');
    return Object.fromEntries(['dev','ino','uid','gid','mode'].map(k => [k, st[k].toString()]));
  };
  const chain = path => { const paths=[]; for (;;) { paths.push(path); if(dirname(path)===path)break;path=dirname(path); } return new Map(paths.map(p=>[p,anchor(p)])); };
  const checkChain = saved => { for(const [p,id] of saved) same(anchor(p),id,'PARENT_IDENTITY_CHANGED'); };
  fail(snapshot?.files instanceof Map && snapshot?.directories instanceof Map, 'AUTH_SNAPSHOT_REQUIRED');
  const sourceParents = chain(dirname(resolve(directory)));
  const checkSource = () => {
    checkChain(sourceParents);
    const actualFiles = walkAuth(directory).sort(), actualDirs = [];
    const visit = rel => { const p=join(directory,rel); same(identity(lstatSync(p,{bigint:true})),snapshot.directories.get(rel),'AUTH_DIRECTORY_CHANGED'); actualDirs.push(rel); for(const n of readdirSync(p)) { const child=rel?`${rel}/${n}`:n;if(lstatSync(join(directory,child)).isDirectory())visit(child); } };
    visit('');
    assert.deepEqual(actualFiles,[...snapshot.files.keys()].sort(),'AUTH_SNAPSHOT_INVENTORY_CHANGED');
    assert.deepEqual(actualDirs.sort(),[...snapshot.directories.keys()].sort(),'AUTH_SNAPSHOT_DIRECTORIES_CHANGED');
  };
  checkSource();
  const block=Buffer.allocUnsafe(65536); let target, targetParents, targetIdentity;
  const expectedTargets=[];
  const checkTarget = () => { checkChain(targetParents); same(anchor(target),targetIdentity,'EXTRACT_TARGET_IDENTITY_CHANGED'); };
  const writeEntry = (path, producer) => {
    fail(safePath(path),'EXTRACT_PATH_REFUSED'); checkTarget();
    const output=join(target,path); mkdirSync(dirname(output),{recursive:true,mode:0o755});
    const parents=chain(dirname(output)); checkTarget();
    let fd;
    try {
      fd=openSync(output,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o644);
      const before=fstatSync(fd,{bigint:true});
      fail(before.isFile() && before.nlink===1n && !(before.mode&0o7022n),'EXTRACT_FILE_REFUSED');
      let writtenTotal=0;
      producer(bytes=>{for(let offset=0;offset<bytes.length;) { const n=writeSync(fd,bytes,offset,bytes.length-offset);fail(n>0,'EXTRACT_SHORT_WRITE');offset+=n;writtenTotal+=n; }});
      const after=fstatSync(fd,{bigint:true});same(identity(lstatSync(output,{bigint:true})),identity(after),'EXTRACT_FILE_REPLACED');
      fail(after.dev===before.dev&&after.ino===before.ino&&after.uid===before.uid&&after.gid===before.gid&&after.mode===before.mode&&after.size===BigInt(writtenTotal)&&after.nlink===1n&&!(after.mode&0o7022n),'EXTRACT_FILE_CHANGED');
      checkChain(parents);checkTarget();expectedTargets.push(path);
    } finally { if(fd!==undefined)closeSync(fd); }
  };
  try {
    if(destination!==undefined) {
      target=resolve(destination);targetParents=chain(dirname(target));
      for(const [path] of targetParents) {const st=lstatSync(path),uid=process.getuid?.();fail((uid===undefined||st.uid===uid||st.uid===0)&&(!(st.mode&0o022)||(st.uid===0&&(st.mode&0o1000))),'EXTRACT_PARENT_REFUSED');}
      mkdirSync(target,{mode:0o700});targetIdentity=anchor(target);checkTarget();
      for(const [path,entry] of entries)writeEntry(path,write=>write(entry.bytes));
    }
    for(const [path,expected] of snapshot.files) {
      const input=join(directory,path);const parents=chain(dirname(input));let fd;
      const readContent = write => {
        try {
          fd=openSync(input,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
          const before=fstatSync(fd,{bigint:true});
          same(identity(before),expected.identity,'AUTH_FILE_IDENTITY_CHANGED');
          fail(before.isFile()&&before.nlink===1n&&!(before.mode&0o7133n),'AUTH_FILE_MODE_REFUSED');
          same(identity(lstatSync(input,{bigint:true})),expected.identity,'AUTH_FILE_REPLACED');
          const hash=createHash('sha256');let total=0;
          for(let n;(n=readSync(fd,block,0,Math.min(block.length,expected.size-total+1),null))>0;) {
            total+=n;fail(total<=expected.size,'AUTH_FILE_SIZE_CHANGED');const part=block.subarray(0,n);hash.update(part);if(write)write(part);
          }
          fail(total===expected.size&&hash.digest('hex')===expected.sha256,'AUTH_FILE_DIGEST_CHANGED');
          same(identity(fstatSync(fd,{bigint:true})),expected.identity,'AUTH_FILE_CHANGED');
          same(identity(lstatSync(input,{bigint:true})),expected.identity,'AUTH_FILE_REPLACED');checkChain(parents);
        } finally { if(fd!==undefined)closeSync(fd); }
      };
      if(target)writeEntry(`runtime/auth/${path}`,readContent);else readContent();
    }
    checkSource();
    if(target) {checkTarget();assert.deepEqual(walkAuth(target).sort(),expectedTargets.sort(),'EXTRACT_INVENTORY_CHANGED');checkTarget();}
    return { [boundedCleanup]: () => { if(targetIdentity) {checkTarget();rmSync(target,{recursive:true,force:true});} }, files:snapshot.files.size, bytes:[...snapshot.files.values()].reduce((n,v)=>n+v.size,0), bufferBytes:block.length, extracted:target!==undefined };
  } catch(error) {
    if(targetIdentity) {
      try {checkTarget();rmSync(target,{recursive:true,force:true});}
      catch(cleanupError) { throw new AggregateError([error,cleanupError],'DAPP_DELIVERY_EXTRACTION_FAILED_CLEANUP_NOT_CONFIRMED'); }
    }
    throw error;
  }
}
export function verifyDeliveryArchiveBounded(archive, { destination, ...options } = {}) {
  return verifyDeliveryArchive(archive,{...options,[boundedCLI]:{destination}});
}

const boundedCLI = Symbol('bounded CLI');
export function verifyDeliveryArchive(archive, { expectedSha256, expectedTree, onProgress, [boundedCLI]: bounded } = {}) {
  fail(digestPattern.test(expectedSha256 ?? '') && treePattern.test(expectedTree ?? ''), 'EXTERNAL_PINS_REQUIRED');
  const stage = (name, operation) => verificationStage(onProgress, name, operation);
  const entries = stage('outer-archive', () => readDeliveryArchive(archive, expectedSha256)), release = parsed(get(entries, 'DELIVERY.json'));
  stage('outer-inventory', () => {
  fail(release.schema === DELIVERY_SCHEMA && release.source?.tree === expectedTree && release.status === 'BETA_FUNCTIONAL_TESTING_NOT_INDEPENDENTLY_AUDITED', 'IDENTITY_REFUSED');
  fail(get(entries, 'SHA256SUMS').toString() === sums(entries), 'CHECKSUM_INVENTORY_MISMATCH');
  assert.deepEqual(hashes(new Map([...entries].filter(([path]) => !['SHA256SUMS', 'DELIVERY.json'].includes(path)))), release.files, 'DAPP_DELIVERY_COMPLETE_INVENTORY_MISMATCH');
  const allowed = new Set([...DELIVERY_FILES, 'DELIVERY.json', 'SHA256SUMS', 'artifacts/dapp-v2-package-manifest.json', 'artifacts/dapp-v3-package-manifest.json', 'artifacts/auth-package-manifest.json']);
  fail(release.artifacts && Object.keys(release.artifacts).sort().join() === 'auth,source,v2,v3', 'ARTIFACTS_REFUSED');
  for (const item of Object.values(release.artifacts)) {
    fail(item && safePath(item.artifact) && !item.artifact.includes('/') && item.artifact.endsWith('.tar.gz') && digestPattern.test(item.sha256), 'ARTIFACT_REFUSED');
    const path = `artifacts/${item.artifact}`; allowed.add(path); fail(sha256(get(entries, path)) === item.sha256, 'NESTED_ARCHIVE_DIGEST_MISMATCH');
  }
  assert.deepEqual([...entries.keys()].sort(), [...allowed].sort(), 'DAPP_DELIVERY_PAYLOAD_ALLOWLIST_MISMATCH');
  });
  const authManifest = parsed(get(entries, 'artifacts/auth-package-manifest.json'));
  fail(authManifest.artifact === release.artifacts.auth.artifact && authManifest.sha256 === release.artifacts.auth.sha256, 'AUTH_REFERENCE_MISMATCH');
  // Auth package validation deliberately remains owned by its existing strict verifier.
  const temporary = mkdtempSync(join(tmpdir(), 'wallet-delivery-verify-')); let authDirectory, authSnapshot, originalError, boundedOutcome;
  try {
    const authPath = join(temporary, 'auth.tar.gz'); writeFileSync(authPath, get(entries, `artifacts/${authManifest.artifact}`));
    const snapshot = bounded ? { files: new Map(), directories: new Map() } : undefined;
    authDirectory = stage('auth-unpack', () => unpackAuthArchive(authPath, bounded ? { snapshot, expectedSha256: authManifest.sha256 } : {}));
    authSnapshot = snapshot;
    const auth = stage('auth-integrity', () => verifyAuthDirectory(authDirectory, { expectedTree }));
    assert.deepEqual(release.source, { commit: auth.source.commit, tree: auth.source.tree, dirty: auth.source.dirty }, 'DAPP_DELIVERY_SOURCE_IDENTITY_MISMATCH');
    const { artifact: _artifact, sha256: _sha, ...authExpected } = authManifest; assert.deepEqual(auth, authExpected);
    fail(sourceTree(auth.source.entries) === expectedTree, 'SOURCE_TREE_MISMATCH');
    const source = stage('source-integrity', () => verifyDeliverySourceArchive(get(entries, `artifacts/${release.artifacts.source.artifact}`), auth.source.entries, entries, expectedTree)), dapps = {};
    for (const id of ['v2', 'v3']) {
      const manifest = parsed(get(entries, `artifacts/dapp-${id}-package-manifest.json`));
      for (const key of ['commit', 'commitTree', 'indexTree', 'tree', 'dirty']) assert.deepEqual(manifest.source?.[key], auth.source[key], 'DAPP_DELIVERY_UI_SOURCE_IDENTITY_MISMATCH');
      fail(manifest.artifact === release.artifacts[id].artifact && manifest.sha256 === release.artifacts[id].sha256, 'UI_REFERENCE_MISMATCH');
      assert.deepEqual(manifest.sourceArchive, release.artifacts.source, 'DAPP_DELIVERY_SOURCE_REFERENCE_MISMATCH');
      dapps[id] = stage(`${id}-integrity`, () => verifyDappEntries(readDeliveryArchive(get(entries, `artifacts/${manifest.artifact}`)), manifest, source, id));
    }
    if (bounded) {
      boundedOutcome = stage('auth-runtime-stream', () => consumeVerifiedAuth(authDirectory, snapshot, { entries, destination: bounded.destination }));
      return { release, sha256: expectedSha256, boundedCLI: true, extracted: bounded.destination !== undefined };
    }
    const authRuntime = stage('auth-runtime-materialization', () => new Map(walkAuth(authDirectory).map(path => [path, { bytes: readFileSync(join(authDirectory, path)), mode: 0o644 }])));
    return { release, entries, dapps, auth: authManifest, authRuntime, sha256: expectedSha256 };
  } catch(error) { originalError=error;throw error; }
  finally {
    finalizeVerificationResources({ originalError,
      cleanupAuth: () => {
        if(authDirectory) {
          if(authSnapshot) {
            const st=lstatSync(authDirectory,{bigint:true}), saved=authSnapshot.directories.get('');
            fail(st.isDirectory()&&!st.isSymbolicLink()&&st.dev.toString()===saved.dev&&st.ino.toString()===saved.ino,'AUTH_CLEANUP_OWNERSHIP_LOST');
          }
          rmSync(authDirectory,{recursive:true,force:true});
        }
      },
      cleanupTemporary: () => rmSync(temporary,{recursive:true,force:true}),
      rollback: () => boundedOutcome?.[boundedCleanup](),
    });
  }
}
export function extractDelivery(result, destination) {
  fail(!result.boundedCLI && result.authRuntime instanceof Map, 'MATERIALIZED_RESULT_REQUIRED');
  destination = resolve(destination);
  let parent = dirname(destination);
  while (true) {
    const stat = lstatSync(parent), uid = process.getuid?.();
    fail(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(parent) === parent
      && (uid === undefined || stat.uid === uid || stat.uid === 0)
      && (!(stat.mode & 0o022) || (stat.uid === 0 && (stat.mode & 0o1000))), 'EXTRACT_PARENT_REFUSED');
    if (dirname(parent) === parent) break; parent = dirname(parent);
  }
  mkdirSync(destination, { mode: 0o700 }); // An existing target is deliberately refused.
  try {
    for (const [path, entry] of [...result.entries, ...[...result.authRuntime].map(([path, entry]) => [`runtime/auth/${path}`, entry])]) {
      mkdirSync(dirname(join(destination, path)), { recursive: true, mode: 0o755 });
      writeFileSync(join(destination, path), entry.bytes, { flag: 'wx', mode: 0o644 });
    }
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
  return destination;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) { const key = process.argv[i]; fail(['--archive', '--sha256', '--tree', '--extract', '--manifest', '--progress'].includes(key) && process.argv[i + 1] && !options[key], 'ARGUMENT_REFUSED'); options[key] = process.argv[i + 1]; }
  fail(options['--progress'] === undefined || options['--progress'] === 'true', 'PROGRESS_ARGUMENT_REFUSED');
  const onProgress = options['--progress'] === 'true' ? writeVerificationProgress : undefined;
  delete options['--progress'];
  if (options['--manifest']) {
    fail(Object.keys(options).length === 1, 'MANIFEST_ARGUMENT_SCOPE_REFUSED');
    const manifestPath = resolve(options['--manifest']); const manifest = parsed(readFileSync(manifestPath));
    fail(/^8415wallet-dapp-delivery-[0-9a-f]{40}\.tar\.gz$/.test(manifest.artifact ?? ''), 'MANIFEST_ARTIFACT_REFUSED');
    options['--archive'] = join(dirname(manifestPath), manifest.artifact); options['--sha256'] = manifest.sha256; options['--tree'] = manifest.source?.tree;
  }
  fail(options['--archive'], 'ARCHIVE_REQUIRED');
  const result = verificationStage(onProgress, 'verification', () => verifyDeliveryArchiveBounded(resolve(options['--archive']), { expectedSha256: options['--sha256'], expectedTree: options['--tree'], onProgress, destination: options['--extract'] }));
  console.log(`Complete DApp kit verified: ${result.release.source.tree}. V2, V3, dependency-complete auth and exact source checked. External pins must come from a trusted channel; this is not deployment or audit acceptance.`);
}
