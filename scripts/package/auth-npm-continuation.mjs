/** CLI-only, source-bound npm installation without a resident packaging Node.
 * The synchronous library API remains available on unsupported platforms.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const SNAPSHOT = 'WALLET_AUTH_NPM_SNAPSHOT';
const TOKEN = 'WALLET_AUTH_NPM_TOKEN';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const refuse = () => { throw new Error('AUTH_PACKAGE_NPM_CONTINUATION_REFUSED'); };
const identity = source => hash(JSON.stringify(source));

function protectedFile(path, privateOnly = false) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & (privateOnly ? 0o077 : 0o022))
    || (process.getuid && stat.uid !== process.getuid())) refuse();
  return stat;
}
function protectedDirectory(path, privateOnly = false) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & (privateOnly ? 0o077 : 0o022))
    || (process.getuid && stat.uid !== process.getuid())) refuse();
}
function binding(root, entry, args, prepared) {
  return { root, entry, args, source: identity(prepared.source),
    manifest: hash(json(prepared.runtime.manifest)), lock: hash(json(prepared.runtime.lock)),
    node: process.execPath, nodeVersion: process.version };
}
function matchesRuntime(directory, prepared) {
  for (const [name, key] of [['package.json', 'manifest'], ['package-lock.json', 'lock']]) {
    const path = join(directory, name); protectedFile(path);
    if (!readFileSync(path).equals(json(prepared.runtime[key]))) refuse();
  }
}

export function prepareOrRestoreNpmCLI({ root, entry, args, capture }) {
  root = resolve(root); entry = resolve(entry);
  const previous = process.env[SNAPSHOT], suppliedToken = process.env[TOKEN];
  if (previous !== undefined || suppliedToken !== undefined) {
    if (!previous || !isAbsolute(previous) || resolve(previous) !== previous || !suppliedToken) refuse();
    if (protectedFile(previous, true).size > 16384) refuse();
    const directory = dirname(previous); protectedDirectory(directory, true);
    if (join(directory, 'snapshot.json') !== previous) refuse();
    const state = JSON.parse(readFileSync(previous, 'utf8'));
    if (state.schema !== 'wallet-auth-npm-continuation/1' || !/^[a-f0-9]{64}$/.test(state.token ?? '')
      || suppliedToken !== state.token) refuse();
    const prepared = capture();
    if (JSON.stringify(state.binding) !== JSON.stringify(binding(root, entry, args, prepared))) refuse();
    const runtime = join(directory, 'runtime'); protectedDirectory(runtime); matchesRuntime(runtime, prepared);
    protectedDirectory(join(runtime, 'node_modules'));
    delete process.env[SNAPSHOT]; delete process.env[TOKEN];
    writeFileSync(join(directory, 'npm-completed.json'), json({ npmExit: 0,
      source: state.binding.source, observedAt: new Date().toISOString(),
      evidence: 'Continuation reachable only after the bounded npm command exits zero' }), { mode: 0o600, flag: 'wx' });
    return { directory, runtime, binding: state.binding, consumed: false };
  }
  if (process.platform === 'win32' || typeof process.execve !== 'function') return null;
  // Do not introduce a new build-tool requirement where GNU timeout is absent.
  // That platform retains the original synchronous npm path and every check.
  try {
    if (!execFileSync('timeout', ['--version'], { encoding: 'utf8', timeout: 5000 }).startsWith('timeout (GNU coreutils)')) return null;
  } catch { return null; }
  const prepared = capture();
  const directory = mkdtempSync(join(tmpdir(), 'wallet-auth-npm-'));
  const runtime = join(directory, 'runtime'), logs = join(directory, 'npm-logs');
  mkdirSync(runtime, { mode: 0o755 }); mkdirSync(logs, { mode: 0o700 });
  for (const [name, key] of [['package.json', 'manifest'], ['package-lock.json', 'lock']])
    writeFileSync(join(runtime, name), json(prepared.runtime[key]), { mode: 0o644, flag: 'wx' });
  for (const value of Object.values(prepared.runtime.manifest.dependencies ?? {})) {
    if (typeof value !== 'string' || !value.startsWith('file:')) continue;
    const path = value.slice(5);
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) refuse();
    const destination = join(runtime, path); mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
    writeFileSync(destination, prepared.readSource(path), { mode: 0o644, flag: 'wx' });
  }
  const token = randomBytes(32).toString('hex'), snapshot = join(directory, 'snapshot.json');
  writeFileSync(snapshot, json({ schema: 'wallet-auth-npm-continuation/1', token,
    binding: binding(root, entry, args, prepared) }), { mode: 0o600, flag: 'wx' });
  // User-controlled data is positional, never interpolated into shell syntax.
  // --foreground keeps npm in this build's owned group. External supervision
  // still proves the entire descendant tree has ended before accepting a pack.
  const offline = args.includes('--offline') ? ' --offline' : '';
  const script = 'node=$1; entry=$2; root=$3; token=$4; shift 4; '
    + 'timeout --foreground --signal=TERM --kill-after=2s 180s npm ci --omit=dev --ignore-scripts --no-audit --no-fund --bin-links=false'
    + offline + '; code=$?; if [ "$code" -ne 0 ]; then exit "$code"; fi; '
    + 'export WALLET_AUTH_NPM_TOKEN="$token"; cd "$root" || exit 71; exec "$node" "$entry" "$@"';
  const env = Object.fromEntries(Object.entries({ ...process.env, [SNAPSHOT]: snapshot,
    npm_config_logs_dir: logs, NPM_CONFIG_LOGS_DIR: logs,
    npm_config_update_notifier: 'false', NPM_CONFIG_UPDATE_NOTIFIER: 'false' }).filter(([, value]) => typeof value === 'string'));
  process.chdir(runtime);
  process.execve('/bin/sh', ['sh', '-c', script, 'wallet-auth-npm', process.execPath, entry, root, token, ...args], env);
  throw new Error('AUTH_PACKAGE_NPM_EXECVE_RETURNED');
}

export function consumeNpmContinuation(state, { root, source, runtime, destination }) {
  if (!state || state.consumed || resolve(root) !== state.binding.root || identity(source) !== state.binding.source
    || hash(json(runtime.manifest)) !== state.binding.manifest || hash(json(runtime.lock)) !== state.binding.lock) refuse();
  protectedDirectory(state.directory, true); protectedDirectory(state.runtime);
  matchesRuntime(state.runtime, { runtime }); protectedDirectory(join(state.runtime, 'node_modules'));
  // The destination is an attempt directory beneath the same private arena,
  // so atomic promotion cannot cross filesystems or overwrite prior outputs.
  if (dirname(dirname(resolve(destination))) !== state.directory) refuse();
  try { lstatSync(join(destination, 'node_modules')); refuse(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  renameSync(join(state.runtime, 'node_modules'), join(destination, 'node_modules'));
  state.consumed = true;
}

export function cleanupNpmContinuation(state) {
  if (!state?.consumed) refuse();
  protectedDirectory(state.directory, true); rmSync(state.directory, { recursive: true });
}

