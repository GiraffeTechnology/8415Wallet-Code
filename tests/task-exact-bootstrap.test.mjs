import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskExactRPCPort, bootstrapTaskExactConfiguration } from '../server/task-exact-bootstrap.mjs';
const configuration = { url: 'https://wallet.example.invalid/rpc', timeoutMs: 1000, tls: { serverFingerprint256: '1'.repeat(64) } };
test('unconfigured installed bootstrap does not load credentials or make a request', async () => {
  assert.equal(await bootstrapTaskExactConfiguration(undefined), null);
});
test('wallet sign-only port rejects broadcast before transport is invoked', async () => {
  let calls = 0;
  const wallet = createTaskExactRPCPort({ configuration, methods: ['eth_chainId', 'eth_accounts', 'eth_signTransaction'],
    transport: async () => { calls++; assert.fail('write reached transport'); } });
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_requestAccounts'])
    await assert.rejects(wallet.request({ method }), /METHOD_REFUSED/);
  assert.equal(calls, 0);
});
test('JSON-RPC response must match request ID and cannot mix error with result', async () => {
  for (const shape of ['wrong-id', 'error', 'extra']) {
    const port = createTaskExactRPCPort({ configuration, methods: ['eth_chainId'], transport: async (url, init) => {
      assert.equal(url, configuration.url); const req = JSON.parse(init.body);
      return { status: 200, async json() { return { jsonrpc: '2.0', id: shape === 'wrong-id' ? req.id + 1 : req.id,
        result: '0x88bb0', ...(shape === 'error' ? { error: { code: -1 } } : shape === 'extra' ? { extra: true } : {}) }; } };
    } });
    await assert.rejects(port.request({ method: 'eth_chainId' }), /RESPONSE_REFUSED/);
  }
});

