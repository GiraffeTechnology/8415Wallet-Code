import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const refuse = reason => { throw new Error(`CI_PRODUCT_CONTRACT_REFUSED: ${reason}`); };

export function validatePrivateDeliveryGateDeclaration(root = defaultRoot) {
  const contract = JSON.parse(readFileSync(resolve(root, 'config/ci-product-contract.json'), 'utf8'));
  if (contract.schema !== 'wallet-ci-product-contract/1' ||
      !/^[0-9a-f]{40}$/.test(contract.sourceCommit) ||
      !/^[0-9a-f]{40}$/.test(contract.sourceTree)) refuse('invalid source identity');
  const fixture = contract.fixture;
  if (fixture?.path !== 'tests/fixtures/product-source-contract.md' ||
      !/^[0-9a-f]{40}$/.test(fixture.sourceBlob) ||
      !Number.isSafeInteger(fixture.bytes) || fixture.bytes < 1 || fixture.bytes > 4096) {
    refuse('invalid product fixture declaration');
  }
  const bytes = readFileSync(resolve(root, fixture.path));
  if (bytes.length !== fixture.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== fixture.sha256) {
    refuse('product fixture content differs from the reviewed excerpts');
  }
  if (!Array.isArray(contract.externalDeliveryGates) || contract.externalDeliveryGates.length !== 1 ||
      contract.ciSuccessAloneAuthorizesActivation !== false) refuse('external delivery boundary missing');
  const gate = contract.externalDeliveryGates[0];
  if (gate.id !== 'internal-development-entry-contract' || gate.required !== true ||
      gate.evaluation !== 'private-local-delivery' || gate.ciStatus !== 'NOT_EVALUATED_BY_CI' ||
      gate.internalDocumentIncluded !== false) refuse('CI cannot certify the external private gate');
  const expectedPaths = ['tests/kit/repositoryStructure.test.ts', 'tests/product-positioning.test.ts'];
  if (!Array.isArray(gate.originalTests) || gate.originalTests.length !== expectedPaths.length ||
      gate.originalTests.some((test, i) => test.path !== expectedPaths[i] ||
        !/^[0-9a-f]{64}$/.test(test.sha256))) refuse('unchanged external tests must remain identified');
  return {
    sourceCommit: contract.sourceCommit,
    sourceTree: contract.sourceTree,
    productExcerptIntegrity: 'VERIFIED',
    externalDeliveryGate: 'REQUIRED_NOT_EVALUATED_BY_CI',
    ciSuccessAloneAuthorizesActivation: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = validatePrivateDeliveryGateDeclaration();
  const summary = '\n### External private delivery gate: NOT EVALUATED BY CI\n\n' +
    'CI checks the exported product snapshot and product-only excerpts. The unchanged internal ' +
    'execution-entry existence, reading-order, product, origin and PRD-pin assertions must also ' +
    'pass against the complete private source in local delivery acceptance. The internal document ' +
    'is excluded from this repository. This step verifies the declaration and excerpt integrity; ' +
    'it does not execute or attest the external gate. CI success alone does not authorize activation.\n';
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log('::notice title=Required external delivery gate::Internal execution-entry checks are NOT EVALUATED BY CI. Separate private delivery evidence is required.');
  console.log(JSON.stringify(result));
}
