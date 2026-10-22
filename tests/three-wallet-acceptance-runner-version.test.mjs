/** Linux-only intake regression. No approval, READY, Git checkout, npm or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWalletBindings } from '../scripts/acceptance/three-wallet-bindings.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(root, 'scripts/acceptance/three-wallet-acceptance.mjs');
const hashes = Object.freeze({
  '1.0': '251e811836f26c05bc4a0a4b2e3f729b5e0fe1f7ea0f1a751fb7e14524ca3180',
  '1.1': '8d11cdca84445575b5e8ab3ae68d72df26dc6ce11ec1fee34095598ac951f59d',
  '1.2': '16693ee8e14ff50d9b3a082f0335e3814b4186407323ba988015267d1fa0ebf3',
});
function input(version = '1.2') {
  return {
    schema: '8415wallet-three-wallet-run/1', taskId: 'WALLET-3W-HOODI-20261015-01',
    promptVersion: version,
    prompt: { fileId: 'SYNTHETIC_PROMPT_DOCUMENT_ID', sha256: hashes[version] },
    // Format-only pins reach the first authorization gate, never Git or execution.
    source: { commit: '1'.repeat(40), tree: '2'.repeat(40), lockSha256: '3'.repeat(64) },
    rpcEnv: 'HOODI_RPC_URL',
  };
}
function refusal(manifest, mode, code) {
  assert.equal(process.platform, 'linux', 'These regressions require the approved Linux surface');
  const dir = mkdtempSync(join(tmpdir(), 'wallet-runner-version-test-'));
  try {
    const file = join(dir, 'input.json');
    writeFileSync(file, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
    const result = spawnSync(process.execPath, [runner, mode, file], {
      cwd: root, timeout: 10000, maxBuffer: 1024 * 1024,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8', TMPDIR: dir },
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, '');
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, code);
    assert.equal(error.status, 'BLOCKED');
    assert.equal(error.transactionsSent, 0);
    assert.equal(error.fullPrdDelivery, 'NOT_ACCEPTED');
    assert.deepEqual(readdirSync(dir), ['input.json'], 'A refused gate must not create run outputs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const version of Object.keys(hashes)) {
  test(`prompt ${version} reaches real offline approval reference gate, not execution`, () => {
    refusal(input(version), 'regress', 'OFFLINE_EXECUTION_APPROVAL_REFERENCE_REQUIRED');
  });
  test(`prompt ${version} preserves full READY reference gate for online preflight`, () => {
    refusal(input(version), 'preflight', 'OPS_READY_REFERENCE_REQUIRED');
  });
  test(`prompt ${version} refuses a substituted hash`, () => {
    const manifest = input(version); manifest.prompt.sha256 = '0'.repeat(64);
    refusal(manifest, 'regress', 'PROMPT_CONTENT_IDENTITY_REQUIRED');
  });
}
test('unknown prompt version is not a fallback to the latest supported version', () => {
  const manifest = input(); manifest.promptVersion = '1.3';
  refusal(manifest, 'regress', 'MANIFEST_IDENTITY_REFUSED');
});
test('v1.2 cannot reuse the historical v1.1 prompt hash', () => {
  const manifest = input(); manifest.prompt.sha256 = hashes['1.1'];
  refusal(manifest, 'regress', 'PROMPT_CONTENT_IDENTITY_REQUIRED');
});
test('the v1.2 hash cannot relabel a v1.1 input', () => {
  const manifest = input('1.1'); manifest.prompt.sha256 = hashes['1.2'];
  refusal(manifest, 'regress', 'PROMPT_CONTENT_IDENTITY_REQUIRED');
});
for (const locator of ['SYNTHETIC_PROMPT_DOCUMENT_ID', 'synthetic-other-file', undefined]) {
  test(`v1.2 accepts exact pinned content independently of its provenance locator: ${locator}`, () => {
    const manifest = input(); manifest.prompt.fileId = locator;
    refusal(manifest, 'regress', 'OFFLINE_EXECUTION_APPROVAL_REFERENCE_REQUIRED');
    refusal(manifest, 'preflight', 'OPS_READY_REFERENCE_REQUIRED');
    manifest.prompt.sha256 = '0'.repeat(64);
    refusal(manifest, 'regress', 'PROMPT_CONTENT_IDENTITY_REQUIRED');
  });
}
test('missing prompt content is still refused before source or authorization', () => {
  const manifest = input(); delete manifest.prompt;
  refusal(manifest, 'regress', 'PROMPT_CONTENT_IDENTITY_REQUIRED');
});
test('v1.2 does not bypass source pin validation', () => {
  const manifest = input(); manifest.source.commit = 'UNRESOLVED';
  refusal(manifest, 'regress', 'EXACT_SOURCE_PINS_REQUIRED');
});
test('v1.2 does not bypass offline approval hash identity', () => {
  const manifest = input(); manifest.offlineApproval = { file: '/unused', sha256: 'UNRESOLVED' };
  refusal(manifest, 'regress', 'OFFLINE_EXECUTION_APPROVAL_REFERENCE_REQUIRED');
});
for (const mode of ['chain-read', 'transaction-read', 'verify-artifacts', 'finalize-blocked']) {
  test(`v1.2 ${mode} still requires actual full READY`, () => {
    refusal(input(), mode, 'OPS_READY_REFERENCE_REQUIRED');
  });
}
test('the v1.2 example remains unresolved and preserves independent acceptance states', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/acceptance/three-wallet-run.UNRESOLVED.json'), 'utf8'));
  assert.equal(manifest.promptVersion, '1.2');
  assert.equal(manifest.requirementsStatus, 'HISTORICAL_NONCURRENT_NOT_CURRENT_PRD_ACCEPTANCE');
  assert.equal(manifest.prompt.fileId, 'SYNTHETIC_PROMPT_DOCUMENT_ID');
  assert.equal(manifest.prd.fileId, 'SYNTHETIC_HISTORICAL_PRD_DOCUMENT_ID');
  assert.deepEqual(manifest.wallets.map(wallet => wallet.name), ['A', 'B', 'C']);
  assert.equal(manifest.prompt.sha256, hashes['1.2']);
  assert.equal(manifest.prompt.bytes, 49956);
  assert.equal(manifest.source.commit, 'UNRESOLVED');
  assert.equal(manifest.opsReady.file, 'UNRESOLVED');
  assert.equal(manifest.offlineApproval.file, 'UNRESOLVED');
  assert.equal(manifest.threeWalletAcceptance, 'NOT_RUN');
  assert.equal(manifest.fullPrdDelivery, 'NOT_ACCEPTED');
  assert.equal(manifest.productionReady, false);
  assert.equal(manifest.formalBlockerEscalation, false);
  assert.deepEqual(manifest.remainingAcceptance, [
    'exact-source regression results', 'genuine UI and agent journeys',
    'on-chain receipt and state evidence', 'version-bound deployment and complete PRD acceptance',
  ]);
  refusal(manifest, 'regress', 'EXACT_SOURCE_PINS_REQUIRED');
});

function walletBindings() {
  return ['A', 'B', 'C'].map((name, index) => ({
    name, address: '0x' + String(index + 1).repeat(40),
    controlProof: 'UNRESOLVED', signerRoute: 'UNRESOLVED',
  }));
}
test('display labels preserve supplied account bindings and evidence fields without a roster gate', () => {
  const wallets = walletBindings();
  wallets[0].name = 'Synthetic owner'; wallets[1].name = 'Synthetic recipient'; wallets[2].name = 'Synthetic custodian';
  const before = structuredClone(wallets);
  assert.equal(validateWalletBindings(wallets), undefined);
  assert.deepEqual(wallets, before);
});
test('the three-wallet fixture accepts synthetic labels without control or signer configuration', () => {
  assert.equal(validateWalletBindings(walletBindings()), undefined);
});
for (const wallets of [undefined, null, {}, [], walletBindings().slice(0, 2), [...walletBindings(), walletBindings()[0]]]) {
  test(`exactly three wallet bindings remain required: ${JSON.stringify(wallets)}`, () => {
    assert.throws(() => validateWalletBindings(wallets), /^Error: THREE_PUBLIC_WALLET_BINDINGS_REQUIRED$/);
  });
}
for (const name of ['', '  ', '\t\n', null, undefined, 1]) {
  test(`nonempty string display names remain required: ${JSON.stringify(name)}`, () => {
    const wallets = walletBindings(); wallets[0].name = name;
    assert.throws(() => validateWalletBindings(wallets), /^Error: WALLET_BINDING_REFUSED$/);
  });
}
for (const address of ['0x' + '0'.repeat(40), '0x' + '1'.repeat(39), '0x' + '1'.repeat(41), '0x' + 'A'.repeat(40), '0x' + 'g'.repeat(40), '', null, undefined]) {
  test(`existing lowercase nonzero address validation remains: ${JSON.stringify(address)}`, () => {
    const wallets = walletBindings(); wallets[0].address = address;
    assert.throws(() => validateWalletBindings(wallets), /^Error: WALLET_BINDING_REFUSED$/);
  });
}
for (const field of ['name', 'address']) {
  test(`duplicate wallet ${field} is refused`, () => {
    const wallets = walletBindings(); wallets[1][field] = wallets[0][field];
    assert.throws(() => validateWalletBindings(wallets), /^Error: THREE_DISTINCT_WALLETS_REQUIRED$/);
  });
}
test('a missing wallet entry is refused without accepting partial bindings', () => {
  const wallets = walletBindings(); wallets[0] = null;
  assert.throws(() => validateWalletBindings(wallets), /^Error: WALLET_BINDING_REFUSED$/);
});
