import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { cleanupNpmContinuation } from '../scripts/package/auth-npm-continuation.mjs';

// Synthetic build-control fixtures only: no service, credentials, RPC or chain.
const helper = new URL('../scripts/package/auth-npm-continuation.mjs', import.meta.url).href;
function fixture(t, mode = 'success', extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wallet auth continuation $literal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin); mkdirSync(join(root, 'outside'));
  const data = { source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40), indexTree: 'b'.repeat(40), dirty: false },
    runtime: { manifest: { name: 'synthetic-runtime', version: '1.0.0', dependencies: {} },
      lock: { name: 'synthetic-runtime', version: '1.0.0', lockfileVersion: 3, packages: {} } } };
  const input = join(root, 'input.json'), argsFile = join(root, 'args.json');
  writeFileSync(input, JSON.stringify(data)); writeFileSync(argsFile, JSON.stringify(['--offline']));
  writeFileSync(join(bin, 'timeout'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "timeout (GNU coreutils) synthetic"; exit 0; fi\nif [ "$SYNTHETIC_MODE" = "timeout" ]; then exit 124; fi\nshift 4\nexec "$@"\n');
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\n'
    + 'printf "invoked" > "$SYNTHETIC_INVOKED"\n'
    + 'if [ "$SYNTHETIC_MODE" = "failure" ]; then exit 7; fi\n'
    + 'if [ "$SYNTHETIC_MODE" = "source-change" ]; then printf "%s" "$SYNTHETIC_REPLACEMENT" > "$SYNTHETIC_INPUT"; fi\n'
    + 'if [ "$SYNTHETIC_MODE" = "args-change" ]; then printf "[\\"--release\\"]" > "$SYNTHETIC_ARGS"; fi\n'
    + 'if [ "$SYNTHETIC_MODE" = "lock-change" ]; then printf "{}" > package-lock.json; fi\n'
    + 'if [ "$SYNTHETIC_MODE" = "symlink" ]; then ln -s "$SYNTHETIC_OUTSIDE" node_modules; else mkdir node_modules; printf "synthetic npm completed" > node_modules/completed.txt; fi\n');
  chmodSync(join(bin, 'timeout'), 0o755); chmodSync(join(bin, 'npm'), 0o755);
  const script = join(root, 'entry.mjs');
  writeFileSync(script, `import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareOrRestoreNpmCLI, consumeNpmContinuation, cleanupNpmContinuation } from ${JSON.stringify(helper)};
const root=${JSON.stringify(root)}, entry=fileURLToPath(import.meta.url);
const capture=()=>JSON.parse(readFileSync(${JSON.stringify(input)},'utf8'));
const args=JSON.parse(readFileSync(${JSON.stringify(argsFile)},'utf8'));
  const state=prepareOrRestoreNpmCLI({root,entry,args,capture,verifyPrepared:()=>{
    if(process.env.SYNTHETIC_MODE==='artifact-reject')throw Error('SYNTHETIC_ARTIFACT_REFUSED');
  }});
if(!state){console.log('SYNTHETIC_FALLBACK');process.exit(0);}
assert.equal(Object.isFrozen(state),true);
assert.equal(Object.isFrozen(state.binding),true);
assert.equal(process.env.WALLET_AUTH_NPM_SNAPSHOT,undefined);
assert.equal(process.env.WALLET_AUTH_NPM_TOKEN,undefined);
const prepared=capture();
const destination=join(mkdtempSync(join(state.directory,'wallet-auth-package-')),'runtime');mkdirSync(destination);
consumeNpmContinuation(state,{root,source:prepared.source,runtime:prepared.runtime,destination});
assert.equal(readFileSync(join(destination,'node_modules/completed.txt'),'utf8'),'synthetic npm completed');
assert.throws(()=>consumeNpmContinuation(state,{root,source:prepared.source,runtime:prepared.runtime,destination}),/CONTINUATION_REFUSED/);
const directory=state.directory;cleanupNpmContinuation(state);assert.equal(existsSync(directory),false);
writeFileSync(join(root,'completed.json'),JSON.stringify({complete:true}));console.log('SYNTHETIC_COMPLETE');
`);
  const replacement = { ...data, source: { ...data.source, tree: 'c'.repeat(40) } };
  const env = { ...process.env, PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter),
    SYNTHETIC_MODE: mode, SYNTHETIC_INPUT: input, SYNTHETIC_ARGS: argsFile,
    SYNTHETIC_REPLACEMENT: JSON.stringify(replacement), SYNTHETIC_OUTSIDE: join(root, 'outside'),
    SYNTHETIC_INVOKED: join(root, 'npm-invoked'), ...extra };
  delete env.WALLET_AUTH_NPM_SNAPSHOT; delete env.WALLET_AUTH_NPM_TOKEN;
  return { root, script, env, run: (overrides, execArgs = []) => spawnSync(process.execPath, [...execArgs, script], {
    cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000,
  }) };
}
const posix = { skip: process.platform === 'win32' || typeof process.execve !== 'function' };
test('npm continuation releases the CLI and resumes a single source-bound installation', posix, t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /SYNTHETIC_COMPLETE/);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'completed.json'))).complete, true);
});
test('npm continuation preserves explicit Node execution flags', posix, t => {
  const f = fixture(t), result = f.run({}, ['--conditions=synthetic-auth-build']);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /SYNTHETIC_COMPLETE/);
});
for (const [mode, code] of [['failure', 7], ['timeout', 124]]) {
  test(`npm ${mode} cannot enter the continuation`, posix, t => {
    const f = fixture(t, mode), result = f.run();
    assert.equal(result.status, code, result.stderr); assert.doesNotMatch(result.stdout, /SYNTHETIC_COMPLETE/);
    assert.equal(existsSync(join(f.root, 'completed.json')), false);
  });
}
for (const mode of ['source-change', 'args-change', 'lock-change', 'symlink']) {
  test(`npm continuation refuses ${mode}`, posix, t => {
    const f = fixture(t, mode), result = f.run();
    assert.notEqual(result.status, 0); assert.match(result.stderr, /CONTINUATION_REFUSED/);
    assert.equal(existsSync(join(f.root, 'completed.json')), false);
  });
}
test('partial continuation environment is rejected instead of silently falling back', t => {
  const f = fixture(t), result = f.run({ WALLET_AUTH_NPM_TOKEN: 'a'.repeat(64) });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /CONTINUATION_REFUSED/);
});
test('public snapshot permissions are refused before JSON or source use', t => {
  const f = fixture(t), arena = mkdtempSync(join(tmpdir(), 'wallet-auth-npm-')), snapshot = join(arena, 'snapshot.json');
  t.after(() => rmSync(arena, { recursive: true, force: true }));
  writeFileSync(snapshot, '{}'); chmodSync(snapshot, 0o644);
  const result = f.run({ WALLET_AUTH_NPM_SNAPSHOT: snapshot, WALLET_AUTH_NPM_TOKEN: 'a'.repeat(64) });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /CONTINUATION_REFUSED/);
});
test('forged cleanup state cannot delete an arbitrary private directory', t => {
  const f = fixture(t), marker = join(f.root, 'preserve.txt'); writeFileSync(marker, 'preserve');
  assert.throws(() => cleanupNpmContinuation({ directory: f.root, consumed: true }), /CONTINUATION_REFUSED/);
  assert.equal(readFileSync(marker, 'utf8'), 'preserve');
});
test('artifact verification failure prevents npm from running', posix, t => {
  const f = fixture(t, 'artifact-reject'), result = f.run();
  assert.notEqual(result.status, 0); assert.match(result.stderr, /SYNTHETIC_ARTIFACT_REFUSED/);
  assert.equal(existsSync(join(f.root, 'completed.json')), false);
  assert.equal(existsSync(join(f.root, 'npm-invoked')), false);
});
test('absence of the optional GNU timeout capability preserves synchronous fallback', posix, t => {
  const f = fixture(t), result = f.run({ PATH: join(f.root, 'not-a-bin') });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /SYNTHETIC_FALLBACK/);
});

