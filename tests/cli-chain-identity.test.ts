import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { KitErc8415Reader } from '../src/adapters/kit/kitReader.ts';
import { divergentToken, T, TOKEN } from '../src/adapters/memory/scenarios.ts';
import { RpcErc8415Reader } from '../src/adapters/rpc/rpcReader.ts';
import { RpcWatchtowerReader } from '../src/adapters/rpc/watchtowerRpcReader.ts';
import { parseArgs, validate } from '../src/cli/args.ts';
import { runLive } from '../src/cli/live.ts';
import { encodeCall, encodeWords } from '../src/codec/abi.ts';
import { ContractRevertError, TransportError } from '../src/sdk/errors.ts';
import { ZERO_ADDRESS, ZERO_BYTES32 } from '../src/sdk/types.ts';
import { WalletSession } from '../src/wallet/session.ts';
import { fakeKitFetch } from './support/fakeKit.ts';
import { FakeEvmNode } from './support/fakeNode.ts';

// Every fetch is replaced by an in-process fixture. These are not live-chain tests.
const RPC = 'https://rpc.example.invalid';
const KIT = 'https://kit.example.invalid';
const WATCHTOWER = `0x${'cd'.repeat(20)}`;
const ASSET = `0x${'ef'.repeat(32)}`;
type RpcRequest = { jsonrpc: string; id: number; method: string; params: unknown[] };
type Source = { readonly chainId: bigint; readonly address: string };

function fixture(t: TestContext, initialChain: bigint) {
  const scenario = divergentToken();
  const node = new FakeEvmNode(scenario.contract);
  const kit = fakeKitFetch(scenario.reader);
  const rpcCalls: RpcRequest[] = [];
  const kitCalls: string[] = [];
  const output: string[] = [];
  const banners: string[] = [];
  const projectionSources: Source[] = [];
  const chainSources: Source[] = [];
  const watchtowerSources: Source[] = [];
  const backends: boolean[] = [];
  let chainId = initialChain;
  let chainReply: ((request: RpcRequest) => Response | Promise<Response>) | undefined;
  const reply = (request: RpcRequest, result: unknown): Response =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));

  t.mock.method(console, 'log', (...values: unknown[]) => { output.push(values.join(' ')); });
  const assetView = WalletSession.prototype.assetView;
  t.mock.method(WalletSession.prototype, 'assetView', async function (this: WalletSession, tokenId: bigint) {
    projectionSources.push({ ...this.reader.source });
    backends.push(this.reader instanceof KitErc8415Reader);
    const result = await assetView.call(this, tokenId);
    assert.equal(result.identity.chainId, this.reader.source.chainId);
    assert.equal(result.identity.address, this.reader.source.address);
    return result;
  });
  const ownerOf = RpcErc8415Reader.prototype.ownerOf;
  t.mock.method(RpcErc8415Reader.prototype, 'ownerOf', async function (this: RpcErc8415Reader, tokenId: bigint) {
    chainSources.push({ ...this.source });
    return ownerOf.call(this, tokenId);
  });
  const freshnessOf = RpcWatchtowerReader.prototype.freshnessOf;
  t.mock.method(RpcWatchtowerReader.prototype, 'freshnessOf', async function (this: RpcWatchtowerReader, assetId: string) {
    watchtowerSources.push({ ...this.source });
    return freshnessOf.call(this, assetId);
  });

  t.mock.method(globalThis, 'fetch', (async (input, init) => {
    const url = String(input);
    if (url.startsWith(`${KIT}/`)) {
      kitCalls.push(url);
      const result = await kit(url);
      return new Response(JSON.stringify(await result.json()), { status: result.status });
    }
    assert.equal(url, RPC, 'the fixture never falls back to a real endpoint');
    const request = JSON.parse(String(init?.body)) as RpcRequest;
    rpcCalls.push(request);
    if (request.method === 'eth_chainId') {
      assert.deepEqual(request.params, []);
      return chainReply === undefined ? reply(request, `0x${chainId.toString(16)}`) : chainReply(request);
    }
    try {
      switch (request.method) {
        case 'eth_call': {
          const call = request.params[0] as { to: string; data: string };
          assert.equal(request.params[1], 'latest');
          if (call.to === WATCHTOWER) {
            if (call.data === encodeCall('freshnessOf(bytes32)', ['bytes32'], [ASSET])) {
              return reply(request, encodeWords(['uint8', 'uint256'], [3n, 12n]));
            }
            assert.equal(call.data, encodeCall('policyOf(bytes32)', ['bytes32'], [ASSET]));
            return reply(request, encodeWords(['address', 'uint64', 'uint64', 'address', 'bool'],
              [ZERO_ADDRESS, 6n, 64n, ZERO_ADDRESS, true]));
          }
          assert.equal(call.to, scenario.contract.address);
          return reply(request, await node.call(call.to, call.data));
        }
        case 'eth_getBlockByNumber': {
          const block = request.params[0];
          const instant = block === 'latest' ? await node.blockTimestamp()
            : await node.blockTimestampAt(BigInt(block as string));
          return reply(request, { timestamp: `0x${instant.toString(16)}` });
        }
        case 'eth_blockNumber':
          return reply(request, `0x${(await node.blockNumber()).toString(16)}`);
        case 'eth_getCode':
          return reply(request, await node.codeAt(request.params[0] as string, BigInt(request.params[1] as string)));
        case 'eth_getLogs':
          return reply(request, await node.getLogs(request.params[0] as Record<string, unknown>));
        default:
          assert.fail(`unexpected or write-side RPC: ${request.method}`);
      }
    } catch (error) {
      if (!(error instanceof ContractRevertError)) throw error;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        error: { code: 3, message: error.message, data: error.data } }));
    }
  }) as typeof fetch);

  return {
    address: scenario.contract.address, rpcCalls, kitCalls, output, banners,
    projectionSources, chainSources, watchtowerSources, backends,
    setChain: (next: bigint) => { chainId = next; },
    chainResponds: (next: NonNullable<typeof chainReply>) => { chainReply = next; },
    reply,
    options: (extra: readonly string[] = []) => parseArgs([
      '--rpc', RPC, '--contract', scenario.contract.address, '--token', String(TOKEN),
      '--instant', String(T.asOf), '--from-block', '0', ...extra,
    ]),
    banner: (title: string) => { banners.push(title); },
  };
}

for (const chainId of [1n, 11_155_111n, 560_048n, 8_453n, 84_532n, 9_007_199_254_740_993n]) {
  test(`CLI verifies and preserves explicitly selected chain ${chainId}`, async t => {
    const f = fixture(t, chainId);
    const options = f.options(['--chain-id', String(chainId)]);
    validate(options);
    assert.equal(options.chainId, chainId);
    await runLive(options, f.banner);
    assert.equal(f.rpcCalls[0]?.method, 'eth_chainId');
    assert.ok(f.projectionSources.length > 0);
    assert.ok(f.chainSources.length > 0);
    assert.ok(f.projectionSources.every(source => source.chainId === chainId && source.address === f.address));
    assert.ok(f.chainSources.every(source => source.chainId === chainId && source.address === f.address));
    assert.ok(f.backends.every(usesKit => !usesKit));
    assert.ok(f.output.some(line => line.includes(`chain ${chainId}`)));
    assert.ok(f.banners.includes('Risk surfaces'), 'the full read completed');
  });
}

for (const chainId of [11_155_111n, 560_048n, 8_453n, 84_532n, 9_007_199_254_740_993n]) {
  test(`CLI defaults to Ethereum and refuses endpoint chain ${chainId} without --chain-id`, async t => {
    const f = fixture(t, chainId);
    const options = f.options();
    validate(options);
    assert.equal(options.chainId, undefined);
    await assert.rejects(runLive(options, f.banner), TransportError);
    assert.deepEqual(f.rpcCalls.map(call => call.method), ['eth_chainId']);
    assert.deepEqual(f.projectionSources, []);
    assert.deepEqual(f.chainSources, []);
    assert.deepEqual(f.kitCalls, []);
    assert.deepEqual(f.output, []);
    assert.deepEqual(f.banners, []);
  });
}

test('CLI keeps projection, Kit companion and watchtower on the explicitly selected verified chain', async t => {
  const chainId = 560_048n;
  const f = fixture(t, chainId);
  await runLive(f.options(['--chain-id', '560048', '--kit', KIT,
    '--watchtower', WATCHTOWER, '--asset-id', ASSET]), f.banner);
  assert.equal(f.rpcCalls[0]?.method, 'eth_chainId');
  assert.ok(f.kitCalls.length > 0);
  assert.ok(f.backends.length > 0 && f.backends.every(Boolean));
  assert.ok(f.projectionSources.length > 0 && f.projectionSources.every(source => source.chainId === chainId));
  assert.ok(f.chainSources.length > 0 && f.chainSources.every(source => source.chainId === chainId));
  assert.deepEqual(f.watchtowerSources, [{ chainId, address: WATCHTOWER }]);
  assert.ok(f.banners.includes('Watchtower freshness'));
  assert.ok(f.banners.includes('Risk surfaces'));
});

test('CLI without --chain-id reads Ethereum only after the endpoint confirms chain 1', async t => {
  const f = fixture(t, 1n);
  const options = f.options();
  validate(options);
  assert.equal(options.chainId, undefined);
  await runLive(options, f.banner);
  assert.equal(f.rpcCalls[0]?.method, 'eth_chainId');
  assert.ok(f.projectionSources.length > 0 && f.projectionSources.every(source => source.chainId === 1n));
  assert.ok(f.chainSources.length > 0 && f.chainSources.every(source => source.chainId === 1n));
  assert.ok(f.banners.includes('Risk surfaces'));
});

test('the same contract address on distinct CLI endpoint chains retains distinct provenance', async t => {
  const f = fixture(t, 11_155_111n);
  await runLive(f.options(['--chain-id', '11155111']), f.banner);
  const firstSources = f.projectionSources.splice(0);
  const boundary = f.rpcCalls.length;
  f.setChain(560_048n);
  await runLive(f.options(['--chain-id', '560048']), f.banner);
  assert.equal(f.rpcCalls[boundary]?.method, 'eth_chainId', 'each invocation verifies its selected chain anew');
  assert.ok(firstSources.length > 0 && f.projectionSources.length > 0);
  assert.ok(firstSources.every(source => source.chainId === 11_155_111n && source.address === f.address));
  assert.ok(f.projectionSources.every(source => source.chainId === 560_048n && source.address === f.address));
});

test('CLI mismatch refuses projection, Kit and watchtower before any business read or output', async t => {
  const f = fixture(t, 560_048n);
  await assert.rejects(runLive(f.options(['--chain-id', '1', '--kit', KIT,
    '--watchtower', WATCHTOWER, '--asset-id', ASSET]), f.banner), TransportError);
  assert.deepEqual(f.rpcCalls.map(call => call.method), ['eth_chainId']);
  assert.deepEqual(f.kitCalls, []);
  assert.deepEqual(f.projectionSources, []);
  assert.deepEqual(f.watchtowerSources, []);
  assert.deepEqual(f.output, []);
  assert.deepEqual(f.banners, []);
});

const malformedChains: readonly unknown[] = [
  '0x0', '0x00', '0x01', '0x', '', '1', ' 0x1', '0x1 ', '-0x1', '0xg',
  1, null, {}, [], true,
];
for (const [index, value] of malformedChains.entries()) {
  test(`CLI refuses malformed or zero chain response ${index} before business reads`, async t => {
    const f = fixture(t, 1n);
    f.chainResponds(request => f.reply(request, value));
    await assert.rejects(runLive(f.options(), f.banner), TransportError);
    assert.deepEqual(f.rpcCalls.map(call => call.method), ['eth_chainId']);
    assert.deepEqual(f.output, []);
    assert.deepEqual(f.banners, []);
  });
}

for (const mode of ['network', 'http', 'json', 'rpc-error', 'wrong-id'] as const) {
  test(`CLI chain verification ${mode} failure cannot bypass the Ethereum default or become a contract revert`, async t => {
    const f = fixture(t, 1n);
    f.chainResponds(request => {
      if (mode === 'network') throw new Error('fixture endpoint unavailable');
      if (mode === 'http') return new Response('unavailable', { status: 503 });
      if (mode === 'json') return new Response('not JSON');
      if (mode === 'wrong-id') return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id + 1, result: '0x1' }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id,
        error: { code: 3, message: 'execution reverted', data: ZERO_BYTES32 } }));
    });
    await assert.rejects(runLive(f.options(), f.banner), (error: unknown) => {
      assert.ok(error instanceof TransportError);
      assert.ok(!(error instanceof ContractRevertError));
      return true;
    });
    assert.deepEqual(f.rpcCalls.map(call => call.method), ['eth_chainId']);
    assert.deepEqual(f.output, []);
    assert.deepEqual(f.banners, []);
  });
}

test('the no-RPC CLI demo configuration needs no endpoint or chain request', t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', (async () => {
    requests++;
    throw new Error('the demo configuration must not fetch');
  }) as typeof fetch);
  const options = parseArgs([]);
  validate(options);
  assert.equal(options.rpc, undefined);
  assert.equal(options.chainId, undefined);
  assert.equal(requests, 0);
});
