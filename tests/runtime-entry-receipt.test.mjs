import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('original credential entry forwards fixed capabilities behind startup fence and identity refusal (virtual host unit)', () => {
  const output = execFileSync(process.execPath, ['--experimental-vm-modules',
    new URL('./helpers/runtime-entry-contract.mjs', import.meta.url).pathname],
  { encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' } });
  assert.equal(output.trim(), 'CREDENTIAL_ENTRY_WHOLE_RECEIPT_PASS');
});
