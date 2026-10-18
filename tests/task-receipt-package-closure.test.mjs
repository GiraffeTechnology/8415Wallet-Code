import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { TASK_RECEIPT_RUNTIME_FILES, createTaskReceiptAdapter } from '../server/task-receipt-adapter.mjs';
import { runtimePackage } from '../scripts/package/verify-auth.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
function imports(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  return source.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) return [];
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || statement.isTypeOnly) return [];
    const clause = statement.importClause;
    if (clause?.isTypeOnly || clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.name &&
      clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly)) return [];
    return [statement.moduleSpecifier.text];
  });
}
function closure(entry) {
  const paths = new Set(), visit = path => {
    if (paths.has(path)) return; paths.add(path);
    for (const dependency of imports(path)) {
      if (dependency.startsWith('node:')) continue;
      if (!dependency.startsWith('.')) { assert.equal(dependency, 'ethers'); continue; }
      visit(resolve(dirname(path), dependency));
    }
  }; visit(resolve(root, entry)); return [...paths].map(path => relative(root, path)).sort();
}
// These trusted verification inputs affect approval selection even though the
// read-only adapter does not import them. Keep this independent inventory: do
// not derive expected identity inputs from TASK_RECEIPT_RUNTIME_FILES itself.
const trustedVerificationInputs = [
  'server/task-operation-verification.mjs',
  'server/task-verification-execution.mjs',
  'server/task-verification-state.mjs',
];
test('declared receipt identity closure equals its import graph and exact trusted runtime inputs', () => {
  assert.deepEqual([...TASK_RECEIPT_RUNTIME_FILES].sort(), [...new Set([...closure('server/task-receipt-adapter.mjs'), ...trustedVerificationInputs, ...['server/task-authorization.mjs', 'server/task-observation-sources.mjs', 'web/task-observer-context.mjs', 'server/task-runtime-composition.mjs', 'server/task-exact-runtime.mjs', 'server/task-exact-bootstrap.mjs', 'server/task-exact-config.mjs', 'server/task-exact-sign-only.mjs', 'server/task-listing-transport.mjs']])].sort());
  assert.equal(TASK_RECEIPT_RUNTIME_FILES.length, new Set(TASK_RECEIPT_RUNTIME_FILES).size);
});
test('exact native-TS runtime closure loads alone, missing dependencies refuse, source changes change identity', () => {
  const directory = mkdtempSync(join(tmpdir(), 'receipt-runtime-'));
  try {
    for (const path of TASK_RECEIPT_RUNTIME_FILES) { const destination = join(directory, path); mkdirSync(dirname(destination), { recursive: true }); cpSync(join(root, path), destination); }
    const tarball = 'vendor/artfi-task-listing-runtime-1.0.0.tgz';
    mkdirSync(dirname(join(directory, tarball)), { recursive: true }); cpSync(join(root, tarball), join(directory, tarball));
    const { manifest, lock } = runtimePackage(JSON.parse(readFileSync(join(root, 'package.json'))), JSON.parse(readFileSync(join(root, 'package-lock.json'))));
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest)); writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    const installed = spawnSync('npm', ['ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--bin-links=false'],
      { cwd: directory, encoding: 'utf8', timeout: 90000, env: { ...process.env, npm_config_offline: 'true' } });
    assert.equal(installed.status, 0, installed.stdout + '\n' + installed.stderr);
    const program = "import {createTaskReceiptAdapter} from './server/task-receipt-adapter.mjs'; console.log(createTaskReceiptAdapter({provider:{async request(){}},observationPolicy:{minimumConfirmations:'2'}}).identity.verifierImplementationDigest)";
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: directory, encoding: 'utf8' });
    const original = run(); assert.equal(original.status, 0, original.stderr);
    const expected = createTaskReceiptAdapter({ provider: { async request() {} }, observationPolicy: { minimumConfirmations: '2' } }).identity.verifierImplementationDigest;
    assert.equal(original.stdout.trim(), expected);
    for (const relativePath of ['src/codec/keccak.ts', ...trustedVerificationInputs]) {
      const path = join(directory, relativePath), originalBytes = readFileSync(path);
      writeFileSync(path, Buffer.concat([originalBytes, Buffer.from('\n// Changed fixture bytes.\n')]));
      const changed = run(); assert.equal(changed.status, 0, changed.stderr);
      assert.notEqual(changed.stdout.trim(), expected, relativePath);
      writeFileSync(path, originalBytes);
    }
    rmSync(join(directory, 'src/sdk/errors.ts')); const missing = run(); assert.notEqual(missing.status, 0); assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
