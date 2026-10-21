/** Run the pinned CLI without retaining a Node packaging parent on POSIX.
 * The continuation is private, exact-source-bound and reached only on CLI exit 0.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const SNAPSHOT = 'WALLET_DAPP_COMPILE_SNAPSHOT';
const TOKEN = 'WALLET_DAPP_COMPILE_TOKEN';
const hash = value => createHash('sha256').update(value).digest('hex');
const refuse = () => { throw new Error('DAPP_BROWSER_CONTINUATION_REFUSED'); };

function emitted(directory, log) {
  const files = log.split(/\r?\n/).filter(line => line.startsWith('TSFILE: ')).map(line => line.slice(8));
  if (!files.length) throw new Error('DAPP_BROWSER_EMIT_REQUIRED');
  for (const file of files) {
    const path = relative(directory, resolve(file));
    if (!path || path.startsWith('..') || isAbsolute(path) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) refuse();
  }
}

export function compileBrowser(root, { source, entry, args, configPath, profile }) {
  root = resolve(root); entry = resolve(entry);
  const binding = { root, entry, args, profile, configPath: resolve(configPath), configSha256: hash(readFileSync(configPath)),
    commit: source.commit, commitTree: source.commitTree, indexTree: source.indexTree, tree: source.tree };
  const previous = process.env[SNAPSHOT];
  if (previous !== undefined) {
    if (!isAbsolute(previous)) refuse();
    const stat = lstatSync(previous);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077)
      || (process.getuid && stat.uid !== process.getuid())) refuse();
    const snapshot = JSON.parse(readFileSync(previous, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(snapshot.token ?? '') || process.env[TOKEN] !== snapshot.token
      || JSON.stringify(snapshot.binding) !== JSON.stringify(binding)) refuse();
    const directory = resolve(previous, '..');
    emitted(join(directory, 'browser'), readFileSync(join(directory, 'compiler.stdout.raw'), 'utf8'));
    mkdirSync(join(root, 'dist'), { recursive: true });
    renameSync(join(directory, 'browser'), join(root, 'dist/browser'));
    delete process.env[SNAPSHOT]; delete process.env[TOKEN];
    return;
  }
  if (process.env[TOKEN] !== undefined) refuse();
  // Clear only this build's output before compilation, never in the continuation.
  rmSync(join(root, 'dist/browser'), { recursive: true, force: true });
  // Keep the private compiler stage on the output filesystem. TMPDIR may be
  // backed by another device; rename promotion must remain within dist.
  mkdirSync(join(root, 'dist'), { recursive: true });
  const directory = mkdtempSync(join(root, 'dist', '.wallet-browser-compile-'));
  const snapshot = join(directory, 'snapshot.json'), log = join(directory, 'compiler.stdout.raw'), outputDirectory = join(directory, 'browser');
  const token = randomBytes(32).toString('hex');
  writeFileSync(snapshot, JSON.stringify({ token, binding }) + '\n', { mode: 0o600, flag: 'wx' });
  const compiler = join(root, 'node_modules/typescript/bin/tsc');
  // Retain the original CLI's complete diagnostics and nonzero-error exit.
  // Partial output stays private on failure; only exit 0 may promote it.
  const compilerArgs = [compiler, '-p', join(root, 'tsconfig.browser.json'), '--outDir', outputDirectory, '--listEmittedFiles'];
  if (process.platform !== 'win32' && typeof process.execve === 'function') {
    // All variable data is positional, never interpolated into shell syntax.
    // execve releases the packaging Node heap before the CLI starts. The shell
    // keeps only a tiny supervisor and cannot continue after compiler failure.
    const script = 'node=$1; compiler=$2; project=$3; log=$4; entry=$5; token=$6; output=$7; shift 7; '
      + '"$node" "$compiler" -p "$project" --outDir "$output" --listEmittedFiles > "$log"; code=$?; '
      + 'cat "$log" >&2; if [ "$code" -ne 0 ]; then exit "$code"; fi; '
      + 'export WALLET_DAPP_COMPILE_TOKEN="$token"; exec "$node" "$entry" "$@"';
    const env = Object.fromEntries(Object.entries({ ...process.env, [SNAPSHOT]: snapshot }).filter(([, value]) => typeof value === 'string'));
    process.execve('/bin/sh', ['sh', '-c', script, 'wallet-browser-compile', process.execPath, compiler,
      join(root, 'tsconfig.browser.json'), log, entry, token, outputDirectory, ...args], env);
    throw new Error('DAPP_BROWSER_EXECVE_RETURNED');
  }
  // Preserve portability where process replacement is unavailable. No checks
  // are skipped; this path only retains the original higher-memory parent.
  const output = execFileSync(process.execPath, compilerArgs, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(log, output, { mode: 0o600, flag: 'wx' });
  emitted(outputDirectory, output);
  mkdirSync(join(root, 'dist'), { recursive: true });
  renameSync(outputDirectory, join(root, 'dist/browser'));
}
