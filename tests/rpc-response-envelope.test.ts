import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { HttpCallTransport } from '../src/adapters/rpc/transport.ts';
import { ContractRevertError, TransportError } from '../src/sdk/errors.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const address = `0x${'ab'.repeat(20)}` as const;
function transport(reply: (id: number) => unknown): HttpCallTransport {
  globalThis.fetch = (async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number };
    return new Response(JSON.stringify(reply(request.id)), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return new HttpCallTransport('https://example.invalid');
}

test('accepts correlated results across successive request ids', async () => {
  const ids: number[] = [];
  const reader = transport((id) => {
    ids.push(id);
    return { jsonrpc: '2.0', id, result: '0x2' };
  });
  assert.equal(await reader.blockNumber(), 2n);
  assert.equal(await reader.blockNumber(), 2n);
  assert.deepEqual(ids, [1, 2]);
});

const invalid: readonly [string, (id: number) => unknown][] = [
  ['null', () => null],
  ['array', (id) => [{ jsonrpc: '2.0', id, result: '0x2' }]],
  ['primitive', () => 7],
  ['missing version', (id) => ({ id, result: '0x2' })],
  ['wrong version', (id) => ({ jsonrpc: '1.0', id, result: '0x2' })],
  ['missing id', () => ({ jsonrpc: '2.0', result: '0x2' })],
  ['wrong id', (id) => ({ jsonrpc: '2.0', id: id + 1, result: '0x2' })],
  ['string id', (id) => ({ jsonrpc: '2.0', id: String(id), result: '0x2' })],
  ['null id', () => ({ jsonrpc: '2.0', id: null, result: '0x2' })],
  ['neither result nor error', (id) => ({ jsonrpc: '2.0', id })],
  ['both result and error', (id) => ({ jsonrpc: '2.0', id, result: '0x2',
    error: { code: 3, message: 'execution reverted' } })],
  ['null error', (id) => ({ jsonrpc: '2.0', id, error: null })],
  ['array error', (id) => ({ jsonrpc: '2.0', id, error: [] })],
  ['fractional code', (id) => ({ jsonrpc: '2.0', id,
    error: { code: 3.5, message: 'execution reverted' } })],
  ['missing code', (id) => ({ jsonrpc: '2.0', id, error: { message: 'execution reverted' } })],
  ['nonstring message', (id) => ({ jsonrpc: '2.0', id, error: { code: 3, message: 7 } })],
];
for (const [label, reply] of invalid) {
  test(`rejects ${label} without classifying it as a contract revert`, async () => {
    await assert.rejects(transport(reply).call(address, '0x'), (error: unknown) => {
      assert.ok(error instanceof TransportError);
      assert.ok(!(error instanceof ContractRevertError));
      return true;
    });
  });
}

test('accepts a null result envelope before the method-specific result check', async () => {
  await assert.rejects(transport((id) => ({ jsonrpc: '2.0', id, result: null })).getLogs({}),
    (error: unknown) => {
      assert.ok(error instanceof TransportError);
      assert.match(error.message, /non-array log result/);
      return true;
    });
});

test('keeps valid node errors distinct from call reverts with structured data', async () => {
  await assert.rejects(transport((id) => ({ jsonrpc: '2.0', id,
    error: { code: -32005, message: 'rate limited', data: { retry: true } },
  })).blockNumber(), (error: unknown) => {
    assert.ok(error instanceof TransportError);
    assert.equal(error.code, -32005);
    return true;
  });
  await assert.rejects(transport((id) => ({ jsonrpc: '2.0', id,
    error: { code: 3, message: 'execution reverted', data: { reason: 'fixture' } },
  })).call(address, '0x'), (error: unknown) => {
    assert.ok(error instanceof ContractRevertError);
    assert.equal(error.data, undefined);
    return true;
  });
});

test('preserves string revert data for a valid correlated call error', async () => {
  await assert.rejects(transport((id) => ({ jsonrpc: '2.0', id,
    error: { code: 3, message: 'execution reverted', data: '0x1234' },
  })).call(address, '0x'), (error: unknown) => {
    assert.ok(error instanceof ContractRevertError);
    assert.equal(error.data, '0x1234');
    return true;
  });
});
