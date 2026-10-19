import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { HttpCallTransport } from '../src/adapters/rpc/transport.ts';
import { RpcErc8415Reader } from '../src/adapters/rpc/rpcReader.ts';
import { detectConformance } from '../src/sdk/conformance.ts';
import { ContractRevertError, TransportError } from '../src/sdk/errors.ts';

// Source-only regression candidates: NOT_RUN until the authorized server runs them.
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const address = `0x${'ab'.repeat(20)}`;
function stub(business: Record<string, unknown>) {
  const calls: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const sent = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push(sent.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: sent.id,
      ...(sent.method === 'eth_chainId' ? { result: '0x1' } : business) }));
  }) as typeof fetch;
  return calls;
}
for (const detail of [
  { code: -32005, message: 'rate limited', data: '0x1234' },
  { code: -32602, message: 'invalid params; revert data unavailable', data: '0x1234' },
  { code: -32601, message: 'execution reverted' },
  { code: -32000, message: 'upstream cannot retrieve revert data', data: '0x1234' },
]) {
  test(`provider error ${detail.code}: ${detail.message} remains unavailable`, async () => {
    stub({ error: detail });
    const reader = new RpcErc8415Reader(new HttpCallTransport('https://example.invalid'), 1n, address);
    await assert.rejects(detectConformance(reader), (error: unknown) => {
      assert.ok(error instanceof TransportError);
      assert.equal(error.code, detail.code);
      assert.ok(!(error instanceof ContractRevertError));
      return true;
    });
  });
}
for (const code of [3, -32000]) {
  test(`explicit execution revert ${code} remains a contract revert`, async () => {
    stub({ error: { code, message: 'execution reverted: fixture', data: '0x1234' } });
    await assert.rejects(new HttpCallTransport('https://example.invalid').call(address, '0x'), ContractRevertError);
  });
}
for (const value of ['-1', '0', '1', '0x', '0x00', '0x01', '-0x1', '', null, 0]) {
  test(`invalid block quantity ${JSON.stringify(value)} cannot become empty history`, async () => {
    const calls = stub({ result: value });
    const reader = new RpcErc8415Reader(new HttpCallTransport('https://example.invalid'), 1n, address, { fromBlock: 0n });
    await assert.rejects(reader.getLogs({ address, topics: [] }), TransportError);
    assert.ok(!calls.includes('eth_getLogs'));
  });
}
for (const [value, expected] of [['0x0', 0n], ['0x1', 1n], ['0xA', 10n], ['0x10000000000000000', 1n << 64n]] as const) {
  test(`canonical block quantity ${value} preserves its exact integer`, async () => {
    stub({ result: value });
    assert.equal(await new HttpCallTransport('https://example.invalid').blockNumber(), expected);
  });
}
