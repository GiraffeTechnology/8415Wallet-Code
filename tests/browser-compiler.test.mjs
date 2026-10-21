import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const compilerPackage = dirname(require.resolve('typescript/package.json'));
const helper = new URL('../scripts/package/browser-compiler.mjs', import.meta.url).href;

function fixture(t, text = 'export const value: number = 42;', patch = {}) {
  // Spaces and shell metacharacters must remain positional data.
  const root = mkdtempSync(join(tmpdir(), 'wallet compile $case; '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'node_modules'));
  symlinkSync(compilerPackage, join(root, 'node_modules/typescript'), 'dir');
  writeFileSync(join(root, 'src/main.ts'), text);
  writeFileSync(join(root, 'tsconfig.browser.json'), JSON.stringify({
    compilerOptions: { target: 'ES2023', lib: ['ES2023'], module: 'NodeNext', strict: true,
      noUnusedLocals: true, types: [], rootDir: './src', outDir: './dist/browser', ...patch },
    include: ['src/**/*.ts'],
  }));
  const entry = join(root, 'driver.mjs');
  writeFileSync(entry, "import { compileBrowser } from " + JSON.stringify(helper) + ";\n"
    + "import { readFileSync, writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto';\n"
    + "const root=process.cwd(); const tree=createHash('sha256').update(readFileSync(root+'/src/main.ts')).digest('hex');\n"
    + "compileBrowser(root,{source:{commit:'fixture',commitTree:tree,indexTree:tree,tree},entry:process.argv[1],args:[],configPath:root+'/tsconfig.browser.json',profile:'fixture'});\n"
    + "writeFileSync(root+'/completed','checked');\n");
  const run = (extra = {}) => spawnSync(process.execPath, [entry], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, WALLET_DAPP_COMPILE_SNAPSHOT: undefined, WALLET_DAPP_COMPILE_TOKEN: undefined, TMPDIR: root, ...extra },
  });
  return { root, run };
}
function failed(result, pattern) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, pattern);
}

test('browser compilation hands off to the pinned CLI and resumes exact input with positional paths', t => {
  const { root, run } = fixture(t); const result = run();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(root, 'completed'), 'utf8'), 'checked');
  assert.match(readFileSync(join(root, 'dist/browser/main.js'), 'utf8'), /value = 42/);
});
test('browser compilation retains semantic errors and cannot continue or emit on error', t => {
  const { root, run } = fixture(t, 'export const value: number = "wrong";');
  failed(run(), /TS2322/);
  assert.equal(existsSync(join(root, 'completed')), false);
  assert.equal(existsSync(join(root, 'dist/browser/main.js')), false);
});
test('browser compilation retains parser diagnostics', t => {
  failed(fixture(t, 'export const = ;').run(), /TS1[0-9]+/);
});
test('browser compilation retains unresolved local imports', t => {
  failed(fixture(t, 'export { missing } from "./absent.js";').run(), /TS2307/);
});
test('browser compilation retains strictness and unused-local diagnostics', t => {
  const result = fixture(t, 'const unused = 1; export const value: number = null;').run();
  failed(result, /TS6133/); assert.match(result.stdout + result.stderr, /TS2322/);
});
test('browser compilation refuses absent project configuration', t => {
  const { root, run } = fixture(t); rmSync(join(root, 'tsconfig.browser.json'));
  failed(run(), /ENOENT/);
});
test('browser compilation refuses invalid compiler options', t => {
  failed(fixture(t, undefined, { unknownCompilerOption: true }).run(), /TS5023/);
});
test('browser compilation cannot silently accept a no-emit project', t => {
  failed(fixture(t, undefined, { noEmit: true }).run(), /DAPP_BROWSER_EMIT_REQUIRED/);
});
test('browser compilation refuses an unbound continuation token', t => {
  const { root, run } = fixture(t);
  failed(run({ WALLET_DAPP_COMPILE_TOKEN: '0'.repeat(64) }), /DAPP_BROWSER_CONTINUATION_REFUSED/);
  assert.equal(existsSync(join(root, 'completed')), false);
});
test('browser compilation refuses source changed during compiler handoff', t => {
  const { root, run } = fixture(t);
  unlinkSync(join(root, 'node_modules/typescript'));
  mkdirSync(join(root, 'node_modules/typescript/bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules/typescript/bin/tsc'),
    "const fs=require('node:fs'),p=require('node:path'),root=process.cwd();"
    + "fs.writeFileSync(p.join(root,'src/main.ts'),'export const changed=1;');"
    + "fs.mkdirSync(p.join(root,'dist/browser'),{recursive:true});"
    + "const file=p.join(root,'dist/browser/main.js');fs.writeFileSync(file,'exports.changed=1;');console.log('TSFILE: '+file);");
  failed(run(), /DAPP_BROWSER_CONTINUATION_REFUSED/);
  assert.equal(existsSync(join(root, 'completed')), false);
});

test('browser compilation stages on the output filesystem without requiring ambient temporary storage', t => {
  const { root, run } = fixture(t);
  const externalTemporary = join(root, 'external temporary location does not exist');
  assert.equal(existsSync(externalTemporary), false);
  const result = run({ TMPDIR: externalTemporary, TMP: externalTemporary, TEMP: externalTemporary });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(externalTemporary), false);
  assert.equal(readFileSync(join(root, 'completed'), 'utf8'), 'checked');
  assert.match(readFileSync(join(root, 'dist/browser/main.js'), 'utf8'), /value = 42/);
});
