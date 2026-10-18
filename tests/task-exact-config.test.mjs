import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTaskExactConfig } from '../server/task-exact-config.mjs';
const endpoint = () => ({ url: 'https://wallet.example.invalid/rpc', timeoutMs: 1000, tls: {
  certFile: '/synthetic/tls/cert', keyFile: '/synthetic/tls/key', caFile: '/synthetic/tls/ca', serverFingerprint256: '1'.repeat(64) } });
const config = () => ({ schema: '8415-task-exact-runtime/1', enabled: true, chainId: '560048', rpc: endpoint(), wallet: endpoint(),
  signerIdentity: { signerId: 'synthetic:original-wallet', signerVersion: '1', implementationDigest: '0x' + '2'.repeat(64) },
  maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1', observationPolicy: { minimumConfirmations: '2' }, plannerFeeRule: null });
test('missing exact config remains disabled; enabled config is detached without defaults', () => {
  assert.equal(validateTaskExactConfig(undefined), null);
  assert.deepEqual(validateTaskExactConfig({ schema: '8415-task-exact-runtime/1', enabled: false }), { schema: '8415-task-exact-runtime/1', enabled: false });
  const c = config(), normalized = validateTaskExactConfig(c); c.wallet.url = 'https://changed.example.invalid/';
  assert.equal(normalized.wallet.url, 'https://wallet.example.invalid/rpc');
});
test('wrong chain, missing endpoint, non-HTTPS and unknown executable fields are refused', () => {
  for (const mutate of [c => c.chainId = '1', c => delete c.rpc, c => c.wallet.url = 'http://wallet.example.invalid/',
    c => c.factory = () => {}, c => c.rpc.url = 'https://user:secret@wallet.example.invalid/',
    c => c.wallet.tls.serverFingerprint256 = 'invalid']) {
    const c = config(); mutate(c); assert.throws(() => validateTaskExactConfig(c), /CONFIG_REFUSED/);
  }
});
test('accessor factory is rejected without invocation', () => {
  const c = config(); Object.defineProperty(c.wallet, 'url', { get() { assert.fail('must not invoke accessor'); } });
  assert.throws(() => validateTaskExactConfig(c), /CONFIG_REFUSED/);
});

