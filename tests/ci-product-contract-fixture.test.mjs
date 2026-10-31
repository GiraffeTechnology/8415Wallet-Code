import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePrivateDeliveryGateDeclaration } from '../scripts/ci/report-private-delivery-gates.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
function withSnapshot(run) {
  const root = mkdtempSync(resolve(tmpdir(), 'wallet-ci-contract-test-'));
  try {
    mkdirSync(resolve(root, 'config'), { recursive: true });
    mkdirSync(resolve(root, 'tests/fixtures'), { recursive: true });
    for (const path of ['config/ci-product-contract.json', 'tests/fixtures/product-source-contract.md']) {
      writeFileSync(resolve(root, path), readFileSync(resolve(source, path)));
    }
    run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('the complete product excerpt is verified without certifying the external private gate', () => {
  withSnapshot(root => {
    const result = validatePrivateDeliveryGateDeclaration(root);
    assert.equal(result.productExcerptIntegrity, 'VERIFIED');
    assert.equal(result.externalDeliveryGate, 'REQUIRED_NOT_EVALUATED_BY_CI');
    assert.equal(result.ciSuccessAloneAuthorizesActivation, false);
  });
});

test('altering a product security excerpt is refused', () => {
  withSnapshot(root => {
    const path = resolve(root, 'tests/fixtures/product-source-contract.md');
    const original = readFileSync(path, 'utf8');
    assert.ok(original.includes('Do not publish real tenant identities'));
    writeFileSync(path, original.replace('Do not publish real tenant identities', 'Publishing tenant identities is allowed'));
    assert.throws(() => validatePrivateDeliveryGateDeclaration(root), /CI_PRODUCT_CONTRACT_REFUSED: product fixture content differs/);
  });
});

test('missing product excerpts cannot turn into an optional check', () => {
  withSnapshot(root => {
    rmSync(resolve(root, 'tests/fixtures/product-source-contract.md'));
    assert.throws(() => validatePrivateDeliveryGateDeclaration(root), /ENOENT/);
  });
});

test('a declaration cannot misrepresent the external private gate as passed by CI', () => {
  withSnapshot(root => {
    const path = resolve(root, 'config/ci-product-contract.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    value.externalDeliveryGates[0].ciStatus = 'PASS';
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => validatePrivateDeliveryGateDeclaration(root), /CI cannot certify the external private gate/);
  });
});

test('activation cannot be authorized by a successful CI declaration', () => {
  withSnapshot(root => {
    const path = resolve(root, 'config/ci-product-contract.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    value.ciSuccessAloneAuthorizesActivation = true;
    writeFileSync(path, JSON.stringify(value));
    assert.throws(() => validatePrivateDeliveryGateDeclaration(root), /external delivery boundary missing/);
  });
});
