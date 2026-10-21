import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as childProcess from 'node:child_process';
import { compileBrowser } from '../scripts/package/browser-compiler.mjs';

function fixture(t, text = 'export const value: number = 42;', patch = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wallet-browser-compiler-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.ts'), text);
  writeFileSync(join(root, 'tsconfig.browser.json'), JSON.stringify({
    compilerOptions: { target: 'ES2023', module: 'NodeNext', strict: true,
      noUnusedLocals: true, types: [], rootDir: './src', outDir: './out', ...patch },
    include: ['src/**/*.ts'],
  }));
  return root;
}

test('browser compilation emits checked JavaScript without a compiler child process', t => {
  const root = fixture(t);
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    t.mock.method(childProcess.default, name, () => { throw new Error('COMPILER_CHILD_FORBIDDEN'); });
  }
  const result = compileBrowser(root);
  assert.match(result.typescript, /^5\./);
  assert.equal(result.inputFiles, 1);
  assert.match(readFileSync(join(root, 'out/main.js'), 'utf8'), /value = 42/);
});

test('browser compilation retains semantic type errors and does not emit them', t => {
  const root = fixture(t, 'export const value: number = "wrong";');
  assert.throws(() => compileBrowser(root), /DAPP_BROWSER_COMPILE_FAILED[\s\S]*TS2322/);
  assert.equal(existsSync(join(root, 'out/main.js')), false);
});

test('browser compilation retains parser diagnostics', t => {
  const root = fixture(t, 'export const = ;');
  assert.throws(() => compileBrowser(root), /DAPP_BROWSER_COMPILE_FAILED[\s\S]*TS/);
});

test('browser compilation retains unresolved local imports', t => {
  const root = fixture(t, 'export { missing } from "./absent.js";');
  assert.throws(() => compileBrowser(root), /DAPP_BROWSER_COMPILE_FAILED[\s\S]*TS2307/);
});

test('browser compilation retains strictness and unused-local diagnostics', t => {
  const root = fixture(t, 'const unused = 1; export const value: number = null;');
  assert.throws(() => compileBrowser(root), error => /TS6133/.test(error.message) && /TS2322/.test(error.message));
});

test('browser compilation refuses absent project configuration', t => {
  const root = fixture(t); rmSync(join(root, 'tsconfig.browser.json'));
  assert.throws(() => compileBrowser(root), /DAPP_BROWSER_COMPILE_FAILED[\s\S]*TS5083/);
});

test('browser compilation refuses invalid compiler options', t => {
  const root = fixture(t, undefined, { unknownCompilerOption: true });
  assert.throws(() => compileBrowser(root), /DAPP_BROWSER_COMPILE_FAILED[\s\S]*TS5023/);
});

test('browser packaging cannot silently accept a no-emit project', t => {
  const root = fixture(t, undefined, { noEmit: true });
  assert.throws(() => compileBrowser(root), /DAPP_BROWSER_EMIT_REQUIRED/);
});
