/** Offline package-boundary checks. No keys, signatures, RPC, or service startup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { TASK_EXACT_SIGNER_RUNTIME_FILES } from '../server/task-exact-signer-adapter.mjs';
import { TASK_RECEIPT_RUNTIME_FILES } from '../server/task-receipt-adapter.mjs';
import { TASK_RUNTIME_SOURCE_PATHS, runtimePackage, sourcePathAllowed } from '../scripts/package/verify-auth.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
function imports(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const result = [];
  const visit = node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier) || node.isTypeOnly) return;
      const clause = node.importClause;
      if (clause?.isTypeOnly || clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.name &&
        clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly)) return;
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly)) return;
      result.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      assert.equal(node.arguments.length, 1, `unsupported dynamic import options: ${path}`);
      assert.ok(ts.isStringLiteral(node.arguments[0]), `unbounded dynamic import: ${path}`);
      result.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
function closure(entries) {
  const paths = new Set(), dependencies = new Set();
  const visit = path => {
    if (paths.has(path)) return;
    paths.add(path);
    for (const dependency of imports(path)) {
      if (dependency.startsWith('node:')) continue;
      if (dependency.startsWith('.')) visit(resolve(dirname(path), dependency));
      else dependencies.add(dependency);
    }
  };
  for (const entry of entries) visit(resolve(root, entry));
  return { files: [...paths].map(path => relative(root, path)).sort(), dependencies: [...dependencies].sort() };
}
function run(directory, program) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: directory, encoding: 'utf8', timeout: 30000,
    // Prevent test-specific module loaders or global search paths from rescuing
    // an incomplete package. Native Node type stripping is the runtime contract.
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  });
}
const probe = `
import assert from 'node:assert/strict';
import { createTaskExactSignerAdapter, TASK_EXACT_SIGNER_RUNTIME_FILES } from './server/task-exact-signer-adapter.mjs';
assert.equal(typeof createTaskExactSignerAdapter, 'function');
assert.ok(TASK_EXACT_SIGNER_RUNTIME_FILES.includes('server/task-operation-encoding.mjs'));
const unused = async () => { throw new Error('CONSTRUCTOR_MUST_NOT_USE_EXTERNAL_CAPABILITIES'); };
const adapter = createTaskExactSignerAdapter({ provider: { request: unused }, externalSigner: { signExactTransaction: unused },
  signerIdentity: { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: '0x' + '1'.repeat(64) },
  store: { readMany: unused, transactionMany: unused, withReadSnapshot: unused }, maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1' });
assert.ok(Object.isFrozen(adapter.identity));
assert.match(adapter.identity.implementationDigest, /^0x[0-9a-f]{64}$/);
console.log(JSON.stringify({ node: process.version, signerRuntimeFiles: TASK_EXACT_SIGNER_RUNTIME_FILES.length, identity: adapter.identity }));
`;

test('signer runtime declaration exactly matches local executable imports and declares ethers separately', () => {
  const actual = closure(['server/task-exact-signer-adapter.mjs']);
  assert.deepEqual([...TASK_EXACT_SIGNER_RUNTIME_FILES].sort(), actual.files);
  assert.equal(TASK_EXACT_SIGNER_RUNTIME_FILES.length, new Set(TASK_EXACT_SIGNER_RUNTIME_FILES).size);
  assert.deepEqual(actual.dependencies, ['ethers']);
  assert.ok(TASK_EXACT_SIGNER_RUNTIME_FILES.includes('server/task-operation-encoding.mjs'));
  assert.ok(TASK_RECEIPT_RUNTIME_FILES.includes('server/task-operation-encoding.mjs'));
});

test('auth runtime and product source selection require the signer and shared encoder without adding dependency authority', () => {
  const policy = readJson('config/product-source-allowlist.json');
  for (const path of ['server/task-exact-signer-adapter.mjs', 'server/task-operation-encoding.mjs']) {
    assert.ok(TASK_RUNTIME_SOURCE_PATHS.includes(path), `auth runtime must require ${path}`);
    assert.ok(policy.mandatory.runtime_and_installers.includes(path), `product source must require ${path}`);
    const entries = policy.entries.filter(entry => entry.path === path);
    assert.equal(entries.length, 1);
    const bytes = readFileSync(join(root, path));
    assert.equal(entries[0].sha256, createHash('sha256').update(bytes).digest('hex'), path);
    assert.equal(entries[0].git_blob_sha1, createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), path);
  }
  for (const path of TASK_EXACT_SIGNER_RUNTIME_FILES) assert.ok(sourcePathAllowed(path), `auth closure excludes ${path}`);
  const sourcePackage = readJson('package.json'), sourceLock = readJson('package-lock.json');
  const { manifest, lock } = runtimePackage(sourcePackage, sourceLock);
  assert.deepEqual(manifest.dependencies, { ethers: sourceLock.packages['node_modules/ethers'].version });
  assert.equal(manifest.engines.node, '>=22.18.0');
  assert.ok(Object.values(lock.packages).every(entry => !entry.dev && !entry.hasInstallScript));
});

test('every selected current product source fingerprint matches the reviewed policy', () => {
  const policy = readJson('config/product-source-allowlist.json');
  const paths = policy.entries.map(entry => entry.path);
  assert.deepEqual(paths, Object.values(policy.mandatory).flat().sort());
  assert.equal(new Set(paths).size, paths.length);
  for (const entry of policy.entries) {
    const bytes = readFileSync(join(root, entry.path));
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'), entry.path);
    assert.equal(entry.git_blob_sha1, createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), entry.path);
  }
});

test('V2 and V3 SDK entry graphs exclude the server signer and remain runtime-dependency-free', () => {
  for (const config of ['tsconfig.package.json', 'tsconfig.package-v3.json']) {
    const graph = closure(readJson(config).include);
    assert.deepEqual(graph.dependencies, [], config);
    assert.ok(graph.files.every(path => path.startsWith('src/')), config);
    assert.equal(graph.files.some(path => TASK_EXACT_SIGNER_RUNTIME_FILES.includes(path) && path.startsWith('server/')), false);
  }
});

test('fresh offline production install imports isolated native signer closure and fails for every omitted source or external dependency', { timeout: 180000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'wallet-exact-signer-runtime-'));
  try {
    for (const path of TASK_EXACT_SIGNER_RUNTIME_FILES) {
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(join(root, path), destination);
    }
    const { manifest, lock } = runtimePackage(readJson('package.json'), readJson('package-lock.json'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    const installed = spawnSync('npm', ['ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--bin-links=false'], {
      cwd: directory, encoding: 'utf8', timeout: 90000, env: { ...process.env, npm_config_offline: 'true' },
    });
    assert.equal(installed.status, 0, `offline lockfile installation failed:\n${installed.stdout}\n${installed.stderr}`);
    const imported = run(directory, probe);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(JSON.parse(imported.stdout).signerRuntimeFiles, TASK_EXACT_SIGNER_RUNTIME_FILES.length);
    const ls = spawnSync('npm', ['ls', '--all', '--omit=dev', '--json', '--offline'], { cwd: directory, encoding: 'utf8' });
    assert.equal(ls.status, 0, ls.stderr);
    assert.equal(JSON.parse(ls.stdout).dependencies.ethers.version, manifest.dependencies.ethers);

    // Fresh processes eliminate the module cache. Every missing declared source
    // must fail, even when its bytes are present elsewhere in the repository.
    for (const path of TASK_EXACT_SIGNER_RUNTIME_FILES) {
      const original = join(directory, path), absent = `${original}.absent`;
      renameSync(original, absent);
      try {
        const missing = run(directory, probe);
        assert.notEqual(missing.status, 0, `missing source unexpectedly imported: ${path}`);
        assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND|ENOENT/, path);
      } finally { renameSync(absent, original); }
    }
    for (const dependency of ['ethers', '@noble/hashes']) {
      const original = join(directory, 'node_modules', dependency), absent = `${original}.absent`;
      renameSync(original, absent);
      try {
        const missing = run(directory, probe);
        assert.notEqual(missing.status, 0, `missing runtime dependency unexpectedly imported: ${dependency}`);
        assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/, dependency);
      } finally { renameSync(absent, original); }
    }
    // Exact source bytes, including the shared encoder, bind executor identity.
    // Equivalent-looking edits still require a new source-bound authorization.
    const encodedPath = join(directory, 'server/task-operation-encoding.mjs');
    const originalBytes = readFileSync(encodedPath);
    writeFileSync(encodedPath, Buffer.concat([originalBytes, Buffer.from('\n// Changed local fixture bytes.\n')]));
    const changed = run(directory, probe);
    assert.equal(changed.status, 0, changed.stderr);
    assert.notEqual(JSON.parse(changed.stdout).identity.implementationDigest, JSON.parse(imported.stdout).identity.implementationDigest);
    writeFileSync(encodedPath, originalBytes);
    const restored = run(directory, probe);
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout).identity, JSON.parse(imported.stdout).identity);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
