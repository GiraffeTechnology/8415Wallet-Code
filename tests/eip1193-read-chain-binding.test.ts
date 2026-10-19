import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RpcErc8415Reader } from '../src/adapters/rpc/rpcReader.ts';
import { Eip1193ReadTransport } from '../src/adapters/signing/eip1193ReadTransport.ts';
import type { Eip1193Provider } from '../src/adapters/signing/eip1193Signer.ts';
import { encodeWords } from '../src/codec/abi.ts';
import { ContractRevertError, TransportError } from '../src/sdk/errors.ts';

// Synthetic providers only; no selected wallet, network, signer or chain is contacted.
const ADDRESS = `0x${'ab'.repeat(20)}`;
const OWNER = `0x${'cd'.repeat(20)}`;
const CHAIN = 560_048n;
const CHAIN_HEX = '0x88bb0';
type Request = { method: string; params?: readonly unknown[] };
type ReadCase = {
  name: string;
  method: string;
  params: readonly unknown[];
  response: unknown;
  expected: unknown;
  read(transport: Eip1193ReadTransport): Promise<unknown>;
};
const reads: readonly ReadCase[] = [
  { name: 'call', method: 'eth_call', params: [{ to: ADDRESS, data: '0x12345678' }, 'latest'],
    response: '0x1234', expected: '0x1234', read: transport => transport.call(ADDRESS, '0x12345678') },
  { name: 'blockTimestamp', method: 'eth_getBlockByNumber', params: ['latest', false],
    response: { timestamp: '0x10' }, expected: 16n, read: transport => transport.blockTimestamp() },
  { name: 'blockTimestampAt', method: 'eth_getBlockByNumber', params: ['0x7', false],
    response: { timestamp: '0x11' }, expected: 17n, read: transport => transport.blockTimestampAt(7n) },
  { name: 'blockNumber', method: 'eth_blockNumber', params: [],
    response: '0x12', expected: 18n, read: transport => transport.blockNumber() },
  { name: 'getLogs', method: 'eth_getLogs', params: [{ address: ADDRESS, fromBlock: '0x1', toBlock: '0x7' }],
    response: [], expected: [], read: transport => transport.getLogs({ address: ADDRESS, fromBlock: '0x1', toBlock: '0x7' }) },
  { name: 'codeAt', method: 'eth_getCode', params: [ADDRESS, '0x7'],
    response: '0x6000', expected: '0x6000', read: transport => transport.codeAt(ADDRESS, 7n) },
];

function providerFixture() {
  const requests: Request[] = [];
  let chain: () => Promise<unknown> = async () => CHAIN_HEX;
  let business: (request: Request) => Promise<unknown> = async ({ method }) => {
    const read = reads.find(candidate => candidate.method === method);
    assert.ok(read, `unexpected or write-side provider request ${method}`);
    return read.response;
  };
  const provider: Eip1193Provider = { async request(request) {
    requests.push(request);
    if (request.method === 'eth_chainId') {
      assert.deepEqual(request.params, []);
      return chain();
    }
    return business(request);
  } };
  return {
    provider, requests,
    transport: new Eip1193ReadTransport(provider, CHAIN),
    chainResponds: (next: typeof chain) => { chain = next; },
    businessResponds: (next: typeof business) => { business = next; },
  };
}

function isTransportFailure(error: unknown): boolean {
  assert.ok(error instanceof TransportError);
  assert.ok(!(error instanceof ContractRevertError));
  return true;
}

for (const read of reads) {
  test(`${read.name} checks the configured chain both before and after its read`, async () => {
    const f = providerFixture();
    f.businessResponds(async () => read.response);
    assert.deepEqual(await read.read(f.transport), read.expected);
    assert.deepEqual(f.requests, [
      { method: 'eth_chainId', params: [] },
      { method: read.method, params: read.params },
      { method: 'eth_chainId', params: [] },
    ]);
  });

  test(`${read.name} refuses a pre-read chain mismatch without issuing the business request`, async () => {
    const f = providerFixture();
    f.chainResponds(async () => '0x1');
    await assert.rejects(read.read(f.transport), isTransportFailure);
    assert.ok(f.requests.length > 0);
    assert.ok(f.requests.every(request => request.method === 'eth_chainId'));
  });

  test(`${read.name} discards a successful result when the chain changes during the read`, async () => {
    const f = providerFixture();
    f.businessResponds(async () => {
      f.chainResponds(async () => '0x1');
      return read.response;
    });
    await assert.rejects(read.read(f.transport), isTransportFailure);
    assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', read.method, 'eth_chainId']);
  });

  test(`${read.name} still checks the chain after a rejected business request`, async () => {
    const f = providerFixture();
    f.businessResponds(async () => {
      f.chainResponds(async () => '0x1');
      throw Object.assign(new Error('provider refused'), { code: 4001 });
    });
    await assert.rejects(read.read(f.transport), isTransportFailure);
    assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', read.method, 'eth_chainId']);
  });
}

test('getChainId reports the actual provider chain independently of the configured read chain', async () => {
  const f = providerFixture();
  f.chainResponds(async () => '0xaa36a7');
  assert.equal(await f.transport.getChainId(), 11_155_111n);
  assert.deepEqual(f.requests, [{ method: 'eth_chainId', params: [] }]);
  await assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
  assert.ok(f.requests.every(request => request.method === 'eth_chainId'));
});

test('getChainId preserves positive chain quantities above Number.MAX_SAFE_INTEGER', async () => {
  const f = providerFixture();
  f.chainResponds(async () => '0x20000000000001');
  assert.equal(await f.transport.getChainId(), 9_007_199_254_740_993n);
});

const invalidChains: readonly unknown[] = [
  '0x0', '0x00', '0x01', '0x', '', '560048', ' 0x88bb0', '0x88bb0 ', '-0x1', '0xg',
  CHAIN, 560048, null, undefined, {}, [], true,
];
for (const [index, invalid] of invalidChains.entries()) {
  test(`getChainId rejects malformed or zero chain response ${index}`, async () => {
    const f = providerFixture();
    f.chainResponds(async () => invalid);
    await assert.rejects(f.transport.getChainId(), isTransportFailure);
    assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId']);
  });

  test(`malformed chain response ${index} before a read is not a contract answer`, async () => {
    const f = providerFixture();
    f.chainResponds(async () => invalid);
    await assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
    assert.ok(f.requests.length > 0 && f.requests.every(request => request.method === 'eth_chainId'));
  });

  test(`malformed chain response ${index} after a read discards its result`, async () => {
    const f = providerFixture();
    f.businessResponds(async () => {
      f.chainResponds(async () => invalid);
      return '0x1234';
    });
    await assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
    assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
  });
}

for (const failure of [new Error('provider disconnected'), { code: 3, message: 'execution reverted' }, { code: 4900 }]) {
  test(`failed chain RPC ${String((failure as { code?: number }).code ?? 'error')} always becomes TransportError`, async () => {
    const f = providerFixture();
    f.chainResponds(async () => { throw failure; });
    await assert.rejects(f.transport.getChainId(), isTransportFailure);
    await assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
    assert.ok(f.requests.every(request => request.method === 'eth_chainId'));
  });
}

test('a chain RPC failure after a successful read prevents returning its data', async () => {
  const f = providerFixture();
  f.businessResponds(async () => {
    f.chainResponds(async () => { throw new Error('provider disconnected'); });
    return '0x1234';
  });
  await assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
  assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
});

test('numeric code 3 preserves a contract revert only after a valid post-read chain check', async () => {
  const f = providerFixture();
  f.businessResponds(async () => { throw { code: 3, message: 'execution reverted', data: '0x1234' }; });
  await assert.rejects(f.transport.call(ADDRESS, '0x'), ContractRevertError);
  assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
});

for (const postRead of ['mismatch', 'malformed', 'rejected'] as const) {
  test(`post-revert chain ${postRead} takes precedence over a contract-looking rejection`, async () => {
    const f = providerFixture();
    f.businessResponds(async () => {
      f.chainResponds(async () => {
        if (postRead === 'rejected') throw { code: 3, message: 'execution reverted' };
        return postRead === 'mismatch' ? '0x1' : '0x088bb0';
      });
      throw { code: 3, message: 'execution reverted', data: '0x1234' };
    });
    await assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
    assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
  });
}

for (const read of reads.filter(read => read.method !== 'eth_call')) {
  test(`${read.name} cannot turn provider code 3 into a contract revert`, async () => {
    const f = providerFixture();
    f.businessResponds(async () => { throw { code: 3, message: 'execution reverted' }; });
    await assert.rejects(read.read(f.transport), isTransportFailure);
    assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', read.method, 'eth_chainId']);
  });
}

test('message text and string code 3 do not manufacture eth_call reverts', async () => {
  for (const error of [new Error('execution reverted'), { code: '3', message: 'execution reverted' }]) {
    const f = providerFixture();
    f.businessResponds(async () => { throw error; });
    await assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
    assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
  }
});

test('the same address on distinct chains cannot reuse a previously successful reader', async () => {
  const f = providerFixture();
  f.businessResponds(async () => encodeWords(['address'], [OWNER]));
  const first = new RpcErc8415Reader(f.transport, CHAIN, ADDRESS);
  assert.equal(await first.ownerOf(7n), OWNER);
  const firstBusinessCount = f.requests.filter(request => request.method === 'eth_call').length;
  f.chainResponds(async () => '0xaa36a7');
  await assert.rejects(first.ownerOf(7n), isTransportFailure);
  assert.equal(f.requests.filter(request => request.method === 'eth_call').length, firstBusinessCount);
  assert.deepEqual(first.source, { chainId: CHAIN, address: ADDRESS });

  const second = new RpcErc8415Reader(new Eip1193ReadTransport(f.provider, 11_155_111n), 11_155_111n, ADDRESS);
  assert.equal(await second.ownerOf(7n), OWNER);
  assert.deepEqual(second.source, { chainId: 11_155_111n, address: ADDRESS });
  assert.notEqual(first.source.chainId, second.source.chainId);
});

test('getChainId has a bounded failure when the provider never answers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = providerFixture();
  f.chainResponds(() => new Promise<never>(() => {}));
  const rejected = assert.rejects(f.transport.getChainId(), isTransportFailure);
  t.mock.timers.tick(30_000);
  await rejected;
  assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId']);
});

test('a stalled post-read chain check is bounded and cannot release the business result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = providerFixture();
  let entered!: () => void;
  const postReadEntered = new Promise<void>(resolve => { entered = resolve; });
  f.businessResponds(async () => {
    f.chainResponds(() => { entered(); return new Promise<never>(() => {}); });
    return '0x1234';
  });
  const rejected = assert.rejects(f.transport.call(ADDRESS, '0x'), isTransportFailure);
  await postReadEntered;
  t.mock.timers.tick(30_000);
  await rejected;
  assert.deepEqual(f.requests.map(request => request.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
});

test('read transport requests only chain identity and read RPCs, with no signing or writes', async () => {
  const f = providerFixture();
  assert.equal(await f.transport.getChainId(), CHAIN);
  for (const read of reads) {
    f.businessResponds(async () => read.response);
    await read.read(f.transport);
  }
  const methods = new Set(f.requests.map(request => request.method));
  assert.deepEqual([...methods].sort(), [
    'eth_chainId', 'eth_call', 'eth_getBlockByNumber', 'eth_blockNumber', 'eth_getLogs', 'eth_getCode',
  ].sort());
  assert.equal(f.requests.filter(request => request.method !== 'eth_chainId').length, reads.length);
});
