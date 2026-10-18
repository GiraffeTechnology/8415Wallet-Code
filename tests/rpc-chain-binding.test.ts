import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { RpcErc8415Reader } from '../src/adapters/rpc/rpcReader.ts';
import { RpcEscrowReader } from '../src/adapters/rpc/escrowRpcReader.ts';
import { RpcWatchtowerReader } from '../src/adapters/rpc/watchtowerRpcReader.ts';
import { bindChainTransport, HttpCallTransport, type CallTransport } from '../src/adapters/rpc/transport.ts';
import { encodeWords } from '../src/codec/abi.ts';
import { detectConformance } from '../src/sdk/conformance.ts';
import { ContractRevertError, TransportError } from '../src/sdk/errors.ts';

const address = `0x${'ab'.repeat(20)}`;
const owner = `0x${'cd'.repeat(20)}`;
const key = `0x${'11'.repeat(32)}`;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function httpReply(reply: (id: number) => unknown) {
  const calls: { method: string; params: unknown[] }[] = [];
  globalThis.fetch = (async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] };
    calls.push({ method: request.method, params: request.params });
    return new Response(JSON.stringify(reply(request.id)), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { transport: new HttpCallTransport('https://rpc.example.invalid'), calls };
}

for (const chainId of [1n, 8453n, 11_155_111n, 84_532n, 560_048n, 9_007_199_254_740_993n]) {
  test(`HTTP chain discovery preserves exact chain ${chainId}`, async () => {
    const f = httpReply(id => ({ jsonrpc: '2.0', id, result: `0x${chainId.toString(16)}` }));
    assert.equal(await f.transport.getChainId(), chainId);
    assert.deepEqual(f.calls, [{ method: 'eth_chainId', params: [] }]);
  });
}
for (const value of [undefined, null, {}, [], 1, true, '', '1', '0x', '0x0', '0x01', '-0x1', ' 0x1', '0x1 ', '0xg']) {
  test(`HTTP rejects malformed chain quantity ${JSON.stringify(value)}`, async () => {
    const f = httpReply(id => ({ jsonrpc: '2.0', id, result: value }));
    await assert.rejects(f.transport.getChainId(), TransportError);
  });
}
for (const reply of [
  (id: number) => ({ jsonrpc: '1.0', id, result: '0x1' }),
  (id: number) => ({ jsonrpc: '2.0', id: id + 1, result: '0x1' }),
  (id: number) => ({ jsonrpc: '2.0', id, result: '0x1', error: { code: 3, message: 'reverted' } }),
  (id: number) => ({ jsonrpc: '2.0', id, error: { code: 3, message: 'execution reverted' } }),
]) {
  test('chain discovery rejects invalid envelopes and node errors as transport faults', async () => {
    await assert.rejects(httpReply(reply).transport.getChainId(), error => {
      assert.ok(error instanceof TransportError);
      assert.ok(!(error instanceof ContractRevertError));
      return true;
    });
  });
}
test('unreachable chain discovery never defaults to Ethereum', async () => {
  globalThis.fetch = (async () => { throw new Error('offline fixture'); }) as typeof fetch;
  await assert.rejects(new HttpCallTransport('https://rpc.example.invalid').getChainId(), TransportError);
});

function fixture() {
  let chain = 1n;
  const calls: string[] = [];
  let afterRead: () => void = () => {};
  const result = <T>(method: string, value: T): T => { calls.push(method); afterRead(); return value; };
  const transport: CallTransport = {
    getChainId: async () => { calls.push('eth_chainId'); return chain; },
    call: async () => result('eth_call', encodeWords(['address'], [owner])),
    blockTimestamp: async () => result('timestamp', 100n),
    blockTimestampAt: async () => result('timestampAt', 99n),
    blockNumber: async () => result('eth_blockNumber', 2n),
    getLogs: async () => result('eth_getLogs', []),
    codeAt: async () => result('eth_getCode', '0x6000'),
  };
  return { transport, calls, setChain: (value: bigint) => { chain = value; },
    afterRead: (callback: () => void) => { afterRead = callback; } };
}
const reads: readonly [string, (transport: CallTransport) => Promise<unknown>][] = [
  ['eth_call', transport => transport.call(address, '0x')],
  ['timestamp', transport => transport.blockTimestamp()],
  ['timestampAt', transport => transport.blockTimestampAt(1n)],
  ['eth_blockNumber', transport => transport.blockNumber()],
  ['eth_getLogs', transport => transport.getLogs({ address })],
  ['eth_getCode', transport => transport.codeAt(address, 1n)],
];
for (const [method, read] of reads) {
  test(`${method} checks the actual chain before and after its result`, async () => {
    const f = fixture();
    await read(bindChainTransport(f.transport, 1n));
    assert.deepEqual(f.calls, ['eth_chainId', method, 'eth_chainId']);
  });
  test(`${method} refuses an initial mismatch before any business read`, async () => {
    const f = fixture();
    f.setChain(8453n);
    await assert.rejects(read(bindChainTransport(f.transport, 1n)), TransportError);
    assert.deepEqual(f.calls, ['eth_chainId']);
  });
  test(`${method} discards a result after an observed network change`, async () => {
    const f = fixture();
    f.afterRead(() => f.setChain(8453n));
    await assert.rejects(read(bindChainTransport(f.transport, 1n)), TransportError);
    assert.deepEqual(f.calls, ['eth_chainId', method, 'eth_chainId']);
  });
}

test('a wrong-chain revert cannot become an unsupported ERC-165 finding', async () => {
  const f = fixture();
  f.transport.call = async () => { f.setChain(8453n); throw new ContractRevertError('fixture revert'); };
  const reader = new RpcErc8415Reader(f.transport, 1n, address);
  await assert.rejects(detectConformance(reader), TransportError);
});
test('same-chain reverts retain their original classification', async () => {
  const f = fixture(), revert = new ContractRevertError('fixture revert');
  f.transport.call = async () => { throw revert; };
  await assert.rejects(bindChainTransport(f.transport, 1n).call(address, '0x'), error => error === revert);
  assert.deepEqual(f.calls, ['eth_chainId', 'eth_chainId']);
});
test('post-failure chain discovery failure overrides an untrustworthy revert', async () => {
  const f = fixture();
  let chainReads = 0;
  f.transport.getChainId = async () => {
    if (++chainReads > 1) throw new ContractRevertError('not a valid chain answer');
    return 1n;
  };
  f.transport.call = async () => { throw new ContractRevertError('fixture revert'); };
  await assert.rejects(detectConformance(new RpcErc8415Reader(f.transport, 1n, address)), TransportError);
  assert.equal(chainReads, 2);
});
test('a failed business request is also followed by a chain check', async () => {
  const f = fixture();
  f.transport.getLogs = async () => { f.setChain(8453n); throw new Error('business failure'); };
  await assert.rejects(bindChainTransport(f.transport, 1n).getLogs({}), error => {
    assert.ok(error instanceof TransportError);
    assert.match(error.message, /chain mismatch/);
    return true;
  });
});
for (const actual of [0n, -1n, 1, '1']) {
  test(`custom discovery must return a positive bigint: ${String(actual)}`, async () => {
    const f = fixture();
    f.transport.getChainId = async () => actual as bigint;
    await assert.rejects(bindChainTransport(f.transport, 1n).blockNumber(), TransportError);
    assert.deepEqual(f.calls, []);
  });
}

const readerReads: readonly [string, (transport: CallTransport) => Promise<unknown>][] = [
  ['projection contract', t => new RpcErc8415Reader(t, 1n, address).supportsInterface('0x6309e170')],
  ['projection timestamp', t => new RpcErc8415Reader(t, 1n, address).chainInstant()],
  ['projection historical timestamp', t => new RpcErc8415Reader(t, 1n, address).chainInstantAt(1n)],
  ['projection logs', t => new RpcErc8415Reader(t, 1n, address).getLogs({ address, topics: [] })],
  ['escrow trade', t => new RpcEscrowReader(t, 1n, address).tradeOf(key)],
  ['escrow observation', t => new RpcEscrowReader(t, 1n, address).observe(key)],
  ['watchtower freshness', t => new RpcWatchtowerReader(t, 1n, address).freshnessOf(key)],
  ['watchtower head', t => new RpcWatchtowerReader(t, 1n, address).headOf(key)],
  ['watchtower asset id', t => new RpcWatchtowerReader(t, 1n, address).computeAssetId(address, key)],
  ['watchtower policy', t => new RpcWatchtowerReader(t, 1n, address).policyOf(key)],
];
for (const [label, read] of readerReads) {
  test(`${label} is guarded at the reader boundary`, async () => {
    const f = fixture(); f.setChain(8453n);
    await assert.rejects(read(f.transport), TransportError);
    assert.deepEqual(f.calls, ['eth_chainId']);
  });
}
for (const Reader of [RpcErc8415Reader, RpcEscrowReader, RpcWatchtowerReader]) {
  test(`${Reader.name} source identity cannot be relabelled`, () => {
    const f = fixture(), reader = new Reader(f.transport, 1n, address);
    assert.equal(Object.isFrozen(reader.source), true);
    assert.equal(Reflect.set(reader.source, 'chainId', 8453n), false);
    assert.equal(Reflect.set(reader.source, 'address', owner), false);
    assert.equal(Reflect.set(reader, 'source', { chainId: 8453n, address: owner }), false);
    assert.deepEqual(reader.source, { chainId: 1n, address });
  });
}
test('same contract/token on distinct chains and a shared transport keep separate bindings', async () => {
  const f = fixture();
  const first = new RpcErc8415Reader(f.transport, 1n, address);
  const second = new RpcErc8415Reader(f.transport, 8453n, address);
  assert.equal(await first.ownerOf(7n), owner);
  await assert.rejects(second.ownerOf(7n), TransportError);
  assert.equal(await first.ownerOf(7n), owner);
  f.setChain(8453n);
  assert.equal(await second.ownerOf(7n), owner);
  await assert.rejects(first.ownerOf(7n), TransportError);
  assert.equal(first.source.chainId, 1n);
  assert.equal(second.source.chainId, 8453n);
});
test('a network change in a later log page rejects the whole scan', async () => {
  const f = fixture(); let pages = 0;
  f.transport.getLogs = async filter => {
    if (++pages === 2) f.setChain(8453n);
    return [{ address, topics: [key], data: '0x', blockNumber: filter.fromBlock, logIndex: '0x0' }];
  };
  const reader = new RpcErc8415Reader(f.transport, 1n, address, { fromBlock: 0n, logWindow: 1n });
  await assert.rejects(reader.getLogs({ address, topics: [] }), TransportError);
  assert.equal(pages, 2);
});
test('deployment-block discovery rejects a network change during code lookup', async () => {
  const f = fixture();
  f.transport.codeAt = async () => { f.setChain(8453n); return '0x6000'; };
  await assert.rejects(new RpcErc8415Reader(f.transport, 1n, address).getLogs({ address, topics: [] }), TransportError);
});
test('legacy custom transports remain compatible without claiming independent chain verification', async () => {
  globalThis.fetch = (async () => { assert.fail('legacy fixture must never use HTTP'); }) as typeof fetch;
  const f = fixture();
  const { getChainId: _discovery, ...legacy } = f.transport;
  const bound = bindChainTransport(legacy, 8453n);
  assert.equal(bound.getChainId, undefined);
  assert.equal(bound, legacy);
  assert.equal(await new RpcErc8415Reader(legacy, 8453n, address).ownerOf(7n), owner);
  assert.deepEqual(f.calls, ['eth_call']);
});
