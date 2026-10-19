/** Build an independent, dependency-complete auth runtime, never a public UI deployment. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, cpSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_SCHEMA, AUTH_STATUS, AUTH_STATE_SEMANTICS, authSourcePolicy, verifyAuthSourcePolicy, TASK_RUNTIME_SOURCE_PATHS, jsonBytes, packagePathAllowed, runtimePackage, safePath, sha256, sourcePathAllowed, sourceTree, verifyAuthDirectory, verifyTaskListingArtifact, verifyInstalledTaskListingPackage, walkAuth } from './verify-auth.mjs';

/** Private, per-attempt diagnostics, outside the runtime/archive allowlist.
 * Synchronous timeouts are signal requests, not a hard elapsed-time bound.
 * A start without an end is incomplete evidence, never a successful exit. */
export function createAuthBuildDiagnostics(directory, { emit = line => writeSync(2, line) } = {}) {
  const file = join(directory, 'build-events.jsonl');
  let sequence = 0;
  writeFileSync(file, '', { mode: 0o600, flag: 'wx' });
  const note = record => {
    const line = `${JSON.stringify({ schema: '8415wallet-auth-build-event/1', at: new Date().toISOString(), parentPid: process.pid, ...record })}\n`;
    appendFileSync(file, line);
    try { emit(`[auth-package] ${line}`); } catch { /* The private event file remains authoritative. */ }
  };
  const phase = (name, action, { child = false, ...details } = {}) => {
    const started = process.hrtime.bigint(), phaseId = ++sequence;
    note({ event: 'phase-start', phase: name, phaseId, ...details });
    let result;
    try { result = action(); }
    catch (error) {
      // Do not serialize Error, argv, environment, output or stack: they may contain secrets.
      const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code
        : /^AUTH_PACKAGE_[A-Z0-9_]+(?::|$)/.exec(typeof error?.message === 'string' ? error.message : '')?.[0].replace(/:$/, '') ?? null;
      try { note({ event: 'phase-end', phase: name, phaseId, outcome: 'failed', elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
        exitCode: Number.isInteger(error?.status) ? error.status : null,
        signal: typeof error?.signal === 'string' && /^SIG[A-Z0-9]+$/.test(error.signal) ? error.signal : null,
        childPid: Number.isInteger(error?.pid) && error.pid > 0 ? error.pid : null,
        errorCode, timeoutReported: error?.code === 'ETIMEDOUT' }); }
      catch { /* A diagnostic write failure must not replace the original failure. */ }
      throw error;
    }
    note({ event: 'phase-end', phase: name, phaseId, outcome: 'succeeded', elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      exitCode: child ? 0 : null, signal: null, errorCode: null, timeoutReported: false });
    return result;
  };
  return { file, note, phase };
}

export function captureAuthSource(root) {
  const git = (args, options = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  if (resolve(git(['rev-parse', '--show-toplevel']).trim()) !== resolve(root)) throw new Error('AUTH_PACKAGE_SOURCE_REPOSITORY_REQUIRED');
  const commit = git(['rev-parse', 'HEAD']).trim(); const commitTree = git(['rev-parse', 'HEAD^{tree}']).trim(); const indexTree = git(['write-tree']).trim();
  const temporary = mkdtempSync(join(tmpdir(), 'wallet-auth-source-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') };
  try {
    git(['read-tree', indexTree], { env });
    git(['add', '--update', '--', '.'], { env });
    const tree = git(['write-tree'], { env }).trim();
    const entries = git(['ls-tree', '-rz', tree]).split('\0').filter(Boolean).map(line => {
      const match = line.match(/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/);
      if (!match || !safePath(match[3])) throw new Error('AUTH_PACKAGE_SOURCE_PATH_REFUSED');
      return { path: match[3], mode: match[1], object: match[2] };
    });
    if (sourceTree(entries) !== tree) throw new Error('AUTH_PACKAGE_SOURCE_TREE_MISMATCH');
    return { commit, commitTree, indexTree, tree, dirty: tree !== commitTree,
      identityVerification: 'local Git commit object and tracked/staged content snapshot; not a remote signature or CI attestation',
      commitObject: execFileSync('git', ['cat-file', 'commit', commit], { cwd: root }).toString('base64'), entries };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

/** A release build requires a matching clean checkout, not merely an internally
 * consistent dirty snapshot. Read bytes directly: Git index flags can hide edits. */
export function validateAuthReleaseCheckout(root, source, options = {}) {
  const policy = verifyAuthSourcePolicy(source, options);
  if (!policy.release) return;
  for (const entry of source.entries) {
    const file = join(root, entry.path), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
        || Boolean(stat.mode & 0o111) !== (entry.mode === '100755')) throw new Error('AUTH_PACKAGE_RELEASE_WORKTREE_MISMATCH');
    const bytes = readFileSync(file);
    const object = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (object !== entry.object) throw new Error('AUTH_PACKAGE_RELEASE_WORKTREE_MISMATCH');
  }
  if (execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }).length)
    throw new Error('AUTH_PACKAGE_RELEASE_UNTRACKED_SOURCE_REFUSED');
}
export function parseAuthBuildArguments(args) {
  const seen = new Set(), options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--offline', '--release', '--expected-commit', '--expected-tree'].includes(key) || seen.has(key))
      throw new Error('AUTH_PACKAGE_ARGUMENT_REFUSED');
    seen.add(key);
    if (key === '--offline') { options.offline = true; continue; }
    if (key === '--release') { options.release = true; continue; }
    const value = args[++index];
    if (typeof value !== 'string' || !value || value.startsWith('--')) throw new Error('AUTH_PACKAGE_ARGUMENT_REFUSED');
    options[key === '--expected-commit' ? 'expectedCommit' : 'expectedTree'] = value;
  }
  return { ...authSourcePolicy(options), offline: options.offline ?? false };
}

/** Fixed USTAR subset with only regular, non-executable files; no host metadata. */
export function deterministicAuthArchive(root) {
  // Keep only one input file in memory. The complete runtime can contain a
  // large, integrity-pinned listing bundle: retaining every file and then a
  // second concatenated tar image exhausts small approved build hosts.
  // Private spool files never enter the runtime/archive inventory. Failure
  // retains them as evidence; success removes only this fresh private spool.
  const temporary = mkdtempSync(join(tmpdir(), 'wallet-auth-archive-'));
  const tarPath = join(temporary, 'payload.tar'), gzipPath = join(temporary, 'payload.tar.gz');
  let tarFd, gzipFd, complete = false;
  try {
    tarFd = openSync(tarPath, 'wx', 0o600);
    const writeAll = bytes => {
      for (let offset = 0; offset < bytes.length;) {
        const written = writeSync(tarFd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error('AUTH_PACKAGE_ARCHIVE_WRITE_INCOMPLETE');
        offset += written;
      }
    };
    for (const path of walkAuth(root)) {
      if (!packagePathAllowed(path)) throw new Error(`AUTH_PACKAGE_PAYLOAD_ALLOWLIST_REFUSED: ${path}`);
      const bytes = readFileSync(join(root, path)); const header = Buffer.alloc(512);
      let name = path; let prefix = '';
      if (Buffer.byteLength(name) > 100) {
        const boundary = [...path.matchAll(/\//g)].map(match => match.index).find(index => Buffer.byteLength(path.slice(0, index)) <= 155 && Buffer.byteLength(path.slice(index + 1)) <= 100);
        if (boundary === undefined) throw new Error('AUTH_PACKAGE_TAR_PATH_TOO_LONG');
        prefix = path.slice(0, boundary); name = path.slice(boundary + 1);
      }
      const octal = (value, offset, length) => { const text = value.toString(8).padStart(length - 1, '0'); if (text.length >= length) throw new Error('AUTH_PACKAGE_TAR_NUMBER_REFUSED'); header.write(`${text}\0`, offset, length, 'ascii'); };
      header.write(name, 0, 100); octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12);
      header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257, 6); header.write('00', 263, 2); header.write(prefix, 345, 155);
      const sum = [...header].reduce((total, byte) => total + byte, 0); header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
      writeAll(header); writeAll(bytes); writeAll(Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    writeAll(Buffer.alloc(1024));
    closeSync(tarFd); tarFd = undefined;
    gzipFd = openSync(gzipPath, 'wx', 0o600);
    // The same Node/zlib encoder and level retain the canonical gzip format.
    // A separate streamed encoder avoids a full tar Buffer in either process.
    // Its stdout is a private file descriptor, not execFileSync's output buffer.
    execFileSync(process.execPath, ['--max-old-space-size=96', '--input-type=module', '-e',
      "import { createReadStream } from 'node:fs'; import { createGzip } from 'node:zlib'; import { pipeline } from 'node:stream/promises'; await pipeline(createReadStream(process.argv[1]), createGzip({ level: 9 }), process.stdout);",
      tarPath], { stdio: ['ignore', gzipFd, 'pipe'], timeout: 120000,
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    closeSync(gzipFd); gzipFd = undefined;
    const archive = readFileSync(gzipPath);
    complete = true;
    return archive;
  } finally {
    if (tarFd !== undefined) closeSync(tarFd);
    if (gzipFd !== undefined) closeSync(gzipFd);
    if (complete) rmSync(temporary, { recursive: true, force: true });
  }
}

function normalizeTree(root) {
  for (const name of readdirSync(root)) {
    const file = join(root, name); const stat = lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.isFile() && stat.nlink !== 1) throw new Error('AUTH_PACKAGE_UNSAFE_INSTALLED_FILE');
    chmodSync(file, stat.isDirectory() ? 0o755 : 0o644);
    if (stat.isDirectory()) normalizeTree(file);
  }
}

/** Import only inert task factories from the freshly installed runtime. The
 * repository's modules/loaders cannot repair a missing packaged dependency. */
export function verifyTaskRuntimeImports(directory) {
  execFileSync(process.execPath, ['--conditions=react-server', join(resolve(directory), 'server/task-runtime-import-probe.mjs')], {
    cwd: directory, stdio: 'pipe', timeout: 30000,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
}

export function buildAuthPackage({ root = process.cwd(), offline = false, output = join(root, 'dist'), release = false, expectedCommit, expectedTree } = {}) {
  const sourcePolicy = authSourcePolicy({ release, expectedCommit, expectedTree });
  root = resolve(root); output = resolve(output);
  const temporary = mkdtempSync(join(tmpdir(), 'wallet-auth-package-'));
  const diagnostics = createAuthBuildDiagnostics(temporary);
  let complete = false;
  try {
    diagnostics.note({ event: 'diagnostics-location', directory: temporary });
    const result = diagnostics.phase('build', () => {
      const source = diagnostics.phase('source-capture', () => captureAuthSource(root));
      diagnostics.phase('source-policy', () => validateAuthReleaseCheckout(root, source, sourcePolicy));
      diagnostics.note({ event: 'source-identity', commit: source.commit, tree: source.tree, dirty: source.dirty, node: process.version });
      const staged = new Map(source.entries.map(entry => [entry.path, entry]));
      const sourceBytes = path => {
        const entry = staged.get(path); if (!entry) throw new Error(`AUTH_PACKAGE_TRACKED_SOURCE_REQUIRED: ${path}`);
        return execFileSync('git', ['cat-file', 'blob', entry.object], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
      };
      diagnostics.phase('source-validation', () => {
        for (const folder of ['server', 'deploy/auth-runtime']) {
          for (const name of readdirSync(join(root, folder))) {
            const path = `${folder}/${name}`;
            if (sourcePathAllowed(path) && !staged.has(path)) throw new Error(`AUTH_PACKAGE_UNTRACKED_SOURCE_STAGE_REQUIRED: ${path}`);
          }
        }
        for (const path of TASK_RUNTIME_SOURCE_PATHS) if (!staged.has(path)) throw new Error(`AUTH_PACKAGE_TRACKED_SOURCE_REQUIRED: ${path}`);
        // Ensure the executing build/verification code is the recorded input, not an untracked local substitute.
        for (const path of ['scripts/package/build-auth.mjs', 'scripts/package/verify-auth.mjs']) {
          if (!sourceBytes(path).equals(readFileSync(join(root, path)))) throw new Error('AUTH_PACKAGE_BUILD_INPUT_MISMATCH');
        }
      });
      const [sourcePackageBytes, sourceLockBytes] = diagnostics.phase('package-inputs', () => [sourceBytes('package.json'), sourceBytes('package-lock.json')]);
      const runtime = diagnostics.phase('runtime-manifest', () => runtimePackage(JSON.parse(sourcePackageBytes), JSON.parse(sourceLockBytes)));
      diagnostics.phase('stage-source', () => {
        const stage = join(temporary, 'runtime'); mkdirSync(stage, { mode: 0o755 });
        for (const entry of source.entries.filter(entry => sourcePathAllowed(entry.path))) {
          mkdirSync(dirname(join(stage, entry.path)), { recursive: true, mode: 0o755 }); writeFileSync(join(stage, entry.path), sourceBytes(entry.path), { mode: 0o644 });
        }
        mkdirSync(join(stage, 'provenance'));
        writeFileSync(join(stage, 'provenance/package.source.json'), sourcePackageBytes);
        writeFileSync(join(stage, 'provenance/package-lock.source.json'), sourceLockBytes);
        writeFileSync(join(stage, 'package.json'), jsonBytes(runtime.manifest)); writeFileSync(join(stage, 'package-lock.json'), jsonBytes(runtime.lock));
      });
      const stage = join(temporary, 'runtime');
      if (runtime.manifest.dependencies['@artfi/task-listing-runtime']) diagnostics.phase('listing-artifact', () => verifyTaskListingArtifact(stage));
      const npmArgs = ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--bin-links=false', ...(offline ? ['--offline'] : [])];
      // npm owns lockfile integrity verification. Never copy a developer node_modules tree.
      // Keep npm's own logs private and outside the packaged runtime. Do not publish them.
      const npmLogs = join(temporary, 'npm-logs'); mkdirSync(npmLogs, { mode: 0o700 });
      diagnostics.phase('npm-ci', () => execFileSync('npm', npmArgs, { cwd: stage, stdio: 'inherit', timeout: 180000,
        env: { ...process.env, npm_config_logs_dir: npmLogs, NPM_CONFIG_LOGS_DIR: npmLogs } }),
        { child: true, timeoutMs: 180000, timeoutSignal: 'SIGTERM', hardDeadline: false, offline });
      diagnostics.phase('normalize-runtime', () => {
        rmSync(join(stage, 'node_modules/.package-lock.json'), { force: true }); normalizeTree(stage);
      });
      if (runtime.manifest.dependencies['@artfi/task-listing-runtime']) diagnostics.phase('listing-installed', () => verifyInstalledTaskListingPackage(stage));
      // Check syntax without executing service entry points, reading secrets, or opening listeners.
      const syntaxFiles = diagnostics.phase('syntax-inventory', () => walkAuth(stage).filter(file => sourcePathAllowed(file) && file.endsWith('.mjs')));
      for (const file of syntaxFiles) {
        diagnostics.phase('syntax-check', () => execFileSync(process.execPath, ['--check', join(stage, file)], { stdio: 'pipe' }), { child: true, sourcePath: file });
      }
      diagnostics.phase('runtime-imports', () => verifyTaskRuntimeImports(stage), { child: true, timeoutMs: 30000, timeoutSignal: 'SIGTERM', hardDeadline: false });
      const files = diagnostics.phase('runtime-inventory', () => Object.fromEntries(walkAuth(stage).map(file => [file, sha256(readFileSync(join(stage, file)))])));
      const npmVersion = diagnostics.phase('npm-version', () => execFileSync('npm', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(), { child: true });
      const release = { schema: AUTH_SCHEMA, name: '8415wallet-auth-runtime', version: runtime.manifest.version, status: AUTH_STATUS,
        source, runtime: { node: '>=22.18.0', bundledNode: false, bundledProductionDependencies: true, entry: 'server/runtime-entry.mjs', tenantArgumentRequired: true, credentialStoreFormat: 1, legacyImportProtocol: 1, authStateSemantics: AUTH_STATE_SEMANTICS, openssl: 'External OpenSSL 3 required only for configured hardware CA verification' },
        build: { node: process.version, npm: npmVersion,
          sourcePolicy: { mode: sourcePolicy.release ? 'release-clean-pinned' : 'development-snapshot',
            ...(sourcePolicy.expectedCommit === undefined ? {} : { expectedCommit: sourcePolicy.expectedCommit }),
            ...(sourcePolicy.expectedTree === undefined ? {} : { expectedTree: sourcePolicy.expectedTree }) },
          command: 'node scripts/package/build-auth.mjs', dependencyCommand: ['npm', ...npmArgs].join(' '), sourceLockSha256: sha256(sourceLockBytes),
          installScripts: 'Disabled; package verification rejects any production install/prepare lifecycle script and lockfile hasInstallScript marker',
          archiveFormat: 'Sorted regular-file-only USTAR, epoch mtime, uid/gid 0, mode 0644; gzip level 9 with zero timestamp' },
        evidence: { integrity: 'Exact payload inventory, source blob/tree identities, lockfile-pinned production dependency installation and isolated native task-runtime imports; not publisher authentication',
          deployment: 'Not installed or activated; no credential, binding, listener, proxy or account created',
          acceptance: 'No production, genuine-wallet, hardware-device, independent audit or external CI acceptance inferred' }, files };
      diagnostics.phase('write-release', () => {
        writeFileSync(join(stage, 'AUTH-RELEASE.json'), jsonBytes(release));
        writeFileSync(join(stage, 'SHA256SUMS'), walkAuth(stage).map(file => `${sha256(readFileSync(join(stage, file)))}  ${file}`).join('\n') + '\n');
      });
      diagnostics.phase('verify-runtime', () => verifyAuthDirectory(stage, sourcePolicy));
      diagnostics.phase('source-recheck', () => {
        const finalSource = captureAuthSource(root);
        if (finalSource.tree !== source.tree || finalSource.commit !== source.commit || finalSource.indexTree !== source.indexTree) throw new Error('AUTH_PACKAGE_SOURCE_CHANGED_DURING_BUILD');
        validateAuthReleaseCheckout(root, finalSource, sourcePolicy);
      });
      const artifact = `8415wallet-auth-runtime-${source.tree}.tar.gz`;
      const archive = diagnostics.phase('archive', () => deterministicAuthArchive(stage));
      return diagnostics.phase('write-output', () => {
        mkdirSync(output, { recursive: true });
        const temporaryArchive = join(output, `${artifact}.tmp-${process.pid}`); writeFileSync(temporaryArchive, archive); renameSync(temporaryArchive, join(output, artifact));
        const manifest = { artifact, sha256: sha256(archive), ...release };
        writeFileSync(join(output, 'auth-package-manifest.json'), jsonBytes(manifest));
        const extracted = join(output, 'package-auth'); rmSync(extracted, { recursive: true, force: true }); cpSync(stage, extracted, { recursive: true });
        return manifest;
      });
    });
    complete = true;
    return result;
  } catch (error) {
    try { diagnostics.note({ event: 'diagnostics-retained', directory: temporary }); } catch { /* Preserve original failure. */ }
    throw error;
  } finally {
    // No cleanup on failure/interruption: the partial runtime and npm logs are evidence.
    if (complete) rmSync(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildAuthPackage(parseAuthBuildArguments(process.argv.slice(2)));
  console.log(`${result.artifact}\nsha256 ${result.sha256}\nsource tree ${result.source.tree}${result.source.dirty ? ' (uncommitted tracked/staged changes included)' : ''}\n${result.status}`);
}
