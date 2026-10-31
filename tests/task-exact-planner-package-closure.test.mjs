/** Offline planner/package boundaries only. No signer calls, RPC, or listeners. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { TASK_EXACT_PLANNER_RUNTIME_FILES } from '../server/task-exact-operation-planner.mjs';
import { TASK_EXACT_SIGNER_RUNTIME_FILES } from '../server/task-exact-signer-adapter.mjs';
import { TASK_RECEIPT_RUNTIME_FILES } from '../server/task-receipt-adapter.mjs';
import { captureAuthSource, verifyTaskRuntimeImports } from '../scripts/package/build-auth.mjs';
import { computeToolingPin, inspectSource } from '../scripts/package/verify-product-origin.mjs';
import { TASK_RUNTIME_SOURCE_PATHS, packagePathAllowed, runtimePackage, sourcePathAllowed } from '../scripts/package/verify-auth.mjs';

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

const plannerEntry = 'server/task-exact-operation-planner.mjs';
const signerEntry = 'server/task-exact-signer-adapter.mjs';
const encoderEntry = 'server/task-operation-encoding.mjs';
const probeEntry = 'server/task-runtime-import-probe.mjs';
const listingEntries = ['server/task-native-listing-composition.mjs', 'server/task-listing-observation-consumer.mjs'];

test('actual checked-in source inspection resolves the installed runtime import probe', () => {
  const source = captureAuthSource(root);
  const allowlistPath = join(root, 'config/product-source-allowlist.json');
  const plan = inspectSource({ sourceRoot: root, allowlistPath,
    expectedAllowlistSha256: createHash('sha256').update(readFileSync(allowlistPath)).digest('hex'),
    expectedUpstreamCommit: source.commit, expectedUpstreamTree: source.tree,
    expectedToolingSha256: computeToolingPin(root), requireClean: false });
  assert.equal(plan.upstreamIdentity.snapshotTree, source.tree);
  const graph = closure([probeEntry]);
  // Source packages retain this type contract, but native type stripping does
  // not load it. Keep an exact, independently checked distinction from imports.
  const typeOnlyInputs = ['src/sdk/linked.ts'];
  for (const path of typeOnlyInputs) {
    assert.equal(TASK_RUNTIME_SOURCE_PATHS.includes(path), false, 'type-only input is not executable runtime closure');
    assert.ok(sourcePathAllowed(path), 'type contract stays eligible for source packaging');
    assert.ok(plan.blobs.has(path), 'type contract must remain packaged');
    const file = ts.createSourceFile(path, readFileSync(join(root, path), 'utf8'), ts.ScriptTarget.Latest, true);
    assert.ok(file.statements.every(node => ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ||
      (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)), 'excluded input must contain types only');
    assert.equal(graph.files.includes(path), false);
  }
  assert.deepEqual(graph.files, [...new Set([...TASK_RUNTIME_SOURCE_PATHS.filter(path => !typeOnlyInputs.includes(path)), ...TASK_RECEIPT_RUNTIME_FILES,
    ...['account-directory', 'auth-service', 'auth-service-core', 'ca-bindings', 'ca-verifier', 'config-validation', 'configuration-transition',
      'crypto', 'erc721-log-discovery', 'login-identifier', 'mail-config', 'mail-otp', 'main', 'native-wallet-login',
      'origin-continuation-context', 'origin-realm-router', 'origin-transition-state', 'rpc-funds-reader', 'store-state-generation',
      'task-asset-control-catalog', 'task-asset-control-policy', 'task-asset-control-state', 'task-listing-bootstrap-core', 'wallet-read-runtime',
      'method-change-service', 'recovery-service', 'registration-service', 'socket-path', 'store',
      'task-authorization', 'task-background-runner', 'task-verification-policy'].map(name => `server/${name}.mjs`), 'web/login-core.mjs', 'web/tenant-path.mjs', 'web/wallet-entry.mjs'])].sort());
  assert.deepEqual(graph.dependencies, ['@artfi/task-listing-runtime/server', 'ethers']);
});

test('planner runtime declaration exactly matches executable imports and the existing pinned ethers dependency', () => {
  const actual = closure([plannerEntry]);
  assert.deepEqual([...TASK_EXACT_PLANNER_RUNTIME_FILES].sort(), actual.files);
  assert.equal(TASK_EXACT_PLANNER_RUNTIME_FILES.length, new Set(TASK_EXACT_PLANNER_RUNTIME_FILES).size);
  assert.deepEqual(actual.dependencies, ['ethers']);
  assert.ok(TASK_EXACT_PLANNER_RUNTIME_FILES.includes(encoderEntry));
  assert.equal(TASK_EXACT_PLANNER_RUNTIME_FILES.includes(signerEntry), false);
});

test('signer composition includes the complete planner graph and receipt keeps only the shared encoder', () => {
  const actual = closure([signerEntry]);
  assert.deepEqual([...TASK_EXACT_SIGNER_RUNTIME_FILES].sort(), [...new Set([...actual.files, ...['server/task-business-fence-fd.mjs', 'server/task-authorization.mjs', 'server/task-observation-sources.mjs', 'web/task-observer-context.mjs', 'server/task-runtime-composition.mjs', 'server/task-exact-runtime.mjs', 'server/task-exact-bootstrap.mjs', 'server/task-exact-config.mjs', 'server/task-exact-sign-only.mjs', 'server/task-listing-transport.mjs']])].sort());
  assert.deepEqual(actual.dependencies, ['ethers']);
  for (const path of TASK_EXACT_PLANNER_RUNTIME_FILES) assert.ok(TASK_EXACT_SIGNER_RUNTIME_FILES.includes(path), path);
  assert.equal(TASK_RECEIPT_RUNTIME_FILES.includes(plannerEntry), false);
  assert.ok(TASK_RECEIPT_RUNTIME_FILES.includes(encoderEntry));
});

test('auth and public-source packages require exact planner, signer and encoding source bytes', () => {
  const policy = readJson('config/product-source-allowlist.json');
  for (const path of [plannerEntry, signerEntry, encoderEntry, probeEntry]) {
    assert.ok(TASK_RUNTIME_SOURCE_PATHS.includes(path), path);
    assert.ok(policy.mandatory.runtime_and_installers.includes(path), path);
    const entries = policy.entries.filter(entry => entry.path === path);
    assert.equal(entries.length, 1, path);
    const bytes = readFileSync(join(root, path));
    assert.equal(entries[0].sha256, createHash('sha256').update(bytes).digest('hex'), path);
    assert.equal(entries[0].git_blob_sha1, createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), path);
  }
  for (const path of [...TASK_EXACT_PLANNER_RUNTIME_FILES, ...TASK_EXACT_SIGNER_RUNTIME_FILES])
    assert.ok(sourcePathAllowed(path), path);
});

test('planner package checks run in the normal suite while test fixtures remain outside product payloads', () => {
  const script = readJson('package.json').scripts.test.split(' ');
  for (const path of ['tests/task-exact-operation-planner.test.mjs', 'tests/task-exact-planner-background.test.mjs',
    'tests/task-exact-planner-package-closure.test.mjs', 'tests/task-exact-signer-adapter.test.mjs',
    'tests/task-exact-signer-package-closure.test.mjs', 'tests/task-receipt-package-closure.test.mjs']) {
    assert.equal(script.filter(part => part === path).length, 1, path);
    assert.equal(sourcePathAllowed(path), false);
    assert.equal(packagePathAllowed(path), false);
  }
  const policy = readJson('config/product-source-allowlist.json');
  for (const path of [...policy.entries.map(entry => entry.path), ...Object.values(policy.mandatory).flat()])
    assert.equal(/^(?:tests|test-evm|node_modules|dist)\//.test(path), false, path);
});

test('V2 and V3 SDK graphs remain independent of server planning, signing and ethers', () => {
  for (const config of ['tsconfig.package.json', 'tsconfig.package-v3.json']) {
    const graph = closure(readJson(config).include);
    assert.deepEqual(graph.dependencies, [], config);
    assert.ok(graph.files.every(path => path.startsWith('src/')), config);
    for (const path of [plannerEntry, signerEntry, encoderEntry]) assert.equal(graph.files.includes(path), false, path);
  }
});

function installRuntimeDependencies(directory) {
  const tarball = 'vendor/artfi-task-listing-runtime-1.0.0.tgz';
  mkdirSync(dirname(join(directory, tarball)), { recursive: true }); cpSync(join(root, tarball), join(directory, tarball));
  const { manifest, lock } = runtimePackage(readJson('package.json'), readJson('package-lock.json'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
  const result = spawnSync('npm', ['ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--bin-links=false'],
    { cwd: directory, encoding: 'utf8', timeout: 90000, env: { ...process.env, npm_config_offline: 'true' } });
  assert.equal(result.status, 0, result.stdout + '\\n' + result.stderr);
}

function copyRuntime(directory, paths) {
  for (const path of paths) {
    const destination = join(directory, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, path), destination);
  }
}
const importProbe = `
import assert from 'node:assert/strict';
import * as planner from './server/task-exact-operation-planner.mjs';
assert.ok(Object.isFrozen(planner.TASK_EXACT_PLANNER_RUNTIME_FILES));
console.log(JSON.stringify({ node: process.version, plannerRuntimeFiles: planner.TASK_EXACT_PLANNER_RUNTIME_FILES.length }));
`;
const identityProbe = `
import assert from 'node:assert/strict';
import { createTaskExactOperationPlanner } from './server/task-exact-operation-planner.mjs';
import { createTaskExactSignerAdapter } from './server/task-exact-signer-adapter.mjs';
const unused = () => { throw new Error('CONSTRUCTOR_MUST_NOT_USE_EXTERNAL_CAPABILITIES'); };
const provider = { request: unused };
const feeRule = { schema: '8415-task-exact-fee-rule/1', ruleId: 'synthetic:package', ruleVersion: '1',
  sampleBlock: 'latest', simulationBlock: 'pending', gasPaddingBps: '12000', gasLimitCeiling: '100000',
  baseFeeMultiplierBps: '20000', maxPriorityFeePerGasWei: '1', maxFeePerGasWeiCeiling: '100', maxChildLifetimeSeconds: '60' };
const config = { provider, externalSigner: { signExactTransaction: unused },
  signerIdentity: { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: '0x' + '1'.repeat(64) },
  store: { readMany: unused, transactionMany: unused, withReadSnapshot: unused },
  maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1' };
const planner = createTaskExactOperationPlanner({ provider, feeRule });
const enabled = createTaskExactSignerAdapter({ ...config, plannerFeeRule: feeRule });
const disabled = createTaskExactSignerAdapter(config);
assert.equal(typeof planner.plan, 'function');
assert.equal(typeof enabled.plan, 'function');
assert.equal('plan' in disabled, false);
assert.equal(enabled.identity.adapterVersion, '2');
assert.equal(disabled.identity.adapterVersion, '2');
assert.ok(Object.isFrozen(planner) && Object.isFrozen(planner.identity));
assert.ok(Object.isFrozen(enabled) && Object.isFrozen(enabled.identity));
assert.notEqual(enabled.identity.implementationDigest, disabled.identity.implementationDigest);
const changedRule = { ...feeRule, gasPaddingBps: '13000' };
assert.notEqual(createTaskExactOperationPlanner({ provider, feeRule: changedRule }).identity.implementationDigest, planner.identity.implementationDigest);
assert.notEqual(createTaskExactSignerAdapter({ ...config, plannerFeeRule: changedRule }).identity.implementationDigest, enabled.identity.implementationDigest);
console.log(JSON.stringify({ planner: planner.identity, enabled: enabled.identity, disabled: disabled.identity }));
`;

test('isolated planner imports with native Node type stripping and pinned offline runtime dependencies', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wallet-exact-planner-runtime-'));
  try {
    copyRuntime(directory, TASK_EXACT_PLANNER_RUNTIME_FILES);
    installRuntimeDependencies(directory);
    const imported = run(directory, importProbe);
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(JSON.parse(imported.stdout).plannerRuntimeFiles, TASK_EXACT_PLANNER_RUNTIME_FILES.length);
    // New processes ensure no module cache can hide an omitted source.
    for (const path of TASK_EXACT_PLANNER_RUNTIME_FILES) {
      const original = join(directory, path), absent = `${original}.absent`;
      renameSync(original, absent);
      try {
        const missing = run(directory, importProbe);
        assert.notEqual(missing.status, 0, `missing planner source unexpectedly imported: ${path}`);
        assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND|ENOENT/, path);
      } finally { renameSync(absent, original); }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('fresh offline auth dependency installation passes the build import probe and refuses missing planner or ethers', { timeout: 180000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'wallet-exact-planner-auth-'));
  try {
    copyRuntime(directory, [...new Set([probeEntry, ...listingEntries, ...TASK_RUNTIME_SOURCE_PATHS, ...readdirSync(join(root, 'server')).filter(name => name.endsWith('.mjs')).map(name => `server/${name}`), 'web/login-core.mjs', 'web/wallet-entry.mjs', 'web/tenant-path.mjs', 'server/store.mjs', 'vendor/artfi-task-listing-runtime-1.0.0.tgz', ...TASK_EXACT_SIGNER_RUNTIME_FILES, ...TASK_RECEIPT_RUNTIME_FILES])]);
    const { manifest, lock } = runtimePackage(readJson('package.json'), readJson('package-lock.json'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    const installed = spawnSync('npm', ['ci', '--offline', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--bin-links=false'], {
      cwd: directory, encoding: 'utf8', timeout: 90000, env: { ...process.env, npm_config_offline: 'true' },
    });
    assert.equal(installed.status, 0, `offline lockfile installation failed:\n${installed.stdout}\n${installed.stderr}`);
    assert.doesNotThrow(() => verifyTaskRuntimeImports(directory));
    const ls = spawnSync('npm', ['ls', '--all', '--omit=dev', '--json', '--offline'], { cwd: directory, encoding: 'utf8' });
    assert.equal(ls.status, 0, ls.stderr);
    assert.equal(JSON.parse(ls.stdout).dependencies.ethers.version, manifest.dependencies.ethers);
    const baseline = run(directory, identityProbe);
    assert.equal(baseline.status, 0, baseline.stderr);
    const originalIdentity = JSON.parse(baseline.stdout);
    for (const path of [plannerEntry, encoderEntry]) {
      const destination = join(directory, path), original = readFileSync(destination);
      try {
        writeFileSync(destination, Buffer.concat([original, Buffer.from('\n// Changed package fixture bytes.\n')]));
        const changed = run(directory, identityProbe);
        assert.equal(changed.status, 0, changed.stderr);
        const identity = JSON.parse(changed.stdout);
        for (const kind of ['planner', 'enabled', 'disabled'])
          assert.notEqual(identity[kind].implementationDigest, originalIdentity[kind].implementationDigest, `${path}: ${kind}`);
      } finally { writeFileSync(destination, original); }
    }
    const restored = run(directory, identityProbe);
    assert.equal(restored.status, 0, restored.stderr);
    assert.deepEqual(JSON.parse(restored.stdout), originalIdentity);
    for (const path of [probeEntry, plannerEntry, encoderEntry, 'server/task-listing-runtime.mjs', 'server/task-listing-results.mjs', 'web/task-listing-results.mjs', 'node_modules/ethers', 'node_modules/@noble/hashes', 'node_modules/@artfi/task-listing-runtime', 'node_modules/@artfi/task-listing-runtime/node_modules/@opensea/sdk']) {
      const original = join(directory, path), absent = `${original}.absent`;
      renameSync(original, absent);
      try {
        assert.throws(() => verifyTaskRuntimeImports(directory), /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ENOENT/, path);
      } finally { renameSync(absent, original); }
    }
    assert.doesNotThrow(() => verifyTaskRuntimeImports(directory));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
