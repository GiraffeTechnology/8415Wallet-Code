/** Linux-only intake regression. No approval, READY, Git checkout, npm or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    prompt: { fileId: '1NvTIC0hnoc9xCRt50zALq0z5qIJAC3kz', sha256: hashes[version] },
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
test('v1.2 keeps the fixed original prompt file identity', () => {
  const manifest = input(); manifest.prompt.fileId = 'synthetic-other-file';
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
  assert.equal(manifest.prompt.sha256, hashes['1.2']);
  assert.equal(manifest.prompt.bytes, 49956);
  assert.equal(manifest.source.commit, 'UNRESOLVED');
  assert.equal(manifest.opsReady.file, 'UNRESOLVED');
  assert.equal(manifest.offlineApproval.file, 'UNRESOLVED');
  assert.equal(manifest.threeWalletAcceptance, 'NOT_RUN');
  assert.equal(manifest.fullPrdDelivery, 'NOT_ACCEPTED');
  assert.equal(manifest.productionReady, false);
  assert.equal(manifest.formalBlockerEscalation, false);
  assert.match(manifest.deliveryResponsibilities.pm, /sole original FINAL update and unified result email/);
  refusal(manifest, 'regress', 'EXACT_SOURCE_PINS_REQUIRED');
});
