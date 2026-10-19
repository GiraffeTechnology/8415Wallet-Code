import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EthereumChainAdapter } from '../../src/kit/adapters/ethereum/ethereumChain.ts';
import { EthereumProjectionReader } from '../../src/kit/adapters/ethereum/projectionReader.ts';
import { ChainIdentityError } from '../../src/kit/adapters/ethereum/chainIdentity.ts';
import { JsonRpcError, type JsonRpcTransport } from '../../src/kit/adapters/ethereum/transport.ts';
import { ProjectionClient, ProjectionClientError } from '../../src/kit/sdk/js/client.ts';
import { Directory } from '../../src/kit/engine/access/roles.ts';
import { handleConsole } from '../../src/kit/console/server.ts';
import { ZERO_BYTES32 } from '../../src/kit/engine/projection/types.ts';
import { FakeNode } from './support/fakeNode.ts';
import { ALICE, REFERENCE, commitment, harness } from './support/fixtures.ts';

// Source-only regression proposal. No network, signer or server is required.
const CONTRACT = `0x${'ee'.repeat(20)}`;
const applicationRoot = { contract: `0x${'dd'.repeat(20)}`, callData: '0x12345678' };
const HEIGHT = 0x1234n;
const ROOT = commitment(0x777);
const node = (chainId = 1n): FakeNode => new FakeNode({
  chainId, registerId: commitment(0x8415), openGap: ZERO_BYTES32,
  supports: ['0x6309e170'], applicationRoot: ROOT,
  finalized: { number: HEIGHT, stateRoot: commitment(0x55) },
  entries: [{ recordCommitment: commitment(1), previousCommitment: ZERO_BYTES32,
    registryReference: REFERENCE, holder: ALICE, version: 1n, effectiveAt: 100n, supersededAt: 0n }],
});
const adapter = (transport: JsonRpcTransport, chainId?: bigint): EthereumChainAdapter =>
  new EthereumChainAdapter({ transport, contract: CONTRACT, applicationRoot,
    ...(chainId === undefined ? {} : { chainId }) });
const reader = (transport: JsonRpcTransport, chainId?: bigint): EthereumProjectionReader =>
  new EthereumProjectionReader({ transport, contract: CONTRACT,
    ...(chainId === undefined ? {} : { chainId }) });

test('Kit uses Ethereum as the omitted expected network and verifies before and after reads', async () => {
  const transport = node();
  const chain = adapter(transport);
  assert.equal(chain.chainId, 1n);
  assert.equal(await chain.refresh(), HEIGHT);
  assert.deepEqual(transport.calls.map((call) => call.method), [
    'eth_chainId', 'eth_getBlockByNumber', 'eth_call', 'eth_chainId',
  ]);
  transport.calls.length = 0;
  const projection = reader(transport);
  assert.equal(projection.chainId, 1n);
  assert.equal(await projection.isFinalAsOf(1n, 100n), false);
  assert.deepEqual(transport.calls.map((call) => call.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
});

test('Kit default rejects a different provider before attributing any data', async () => {
  const transport = node(8453n);
  const chain = adapter(transport);
  await assert.rejects(() => chain.refresh(), ChainIdentityError);
  await assert.rejects(() => reader(transport).holderAsOf(1n, 100n), ChainIdentityError);
  assert.ok(transport.calls.every((call) => call.method === 'eth_chainId'));
  assert.equal(chain.finalizedHeight, 0n);
  assert.equal(chain.stateRootAt(HEIGHT), undefined);
});

test('Kit accepts an explicitly selected matching EVM network without changing the default', async () => {
  const transport = node(8453n);
  const chain = adapter(transport, 8453n);
  assert.equal(await chain.refresh(), HEIGHT);
  assert.equal(chain.chainId, 8453n);
  assert.equal(await reader(transport, 8453n).holderAsOf(1n, 100n), ALICE);
  assert.equal(chain.stateRootAt(HEIGHT), ROOT);
  await assert.rejects(() => reader(transport).entryCount(1n), ChainIdentityError);
});

test('Kit rejects malformed or unavailable eth_chainId without a data fallback', async () => {
  for (const malformed of ['0x01', '0x', '0xzz', `0x1${'0'.repeat(64)}`, null, 1]) {
    const calls: string[] = [];
    const transport: JsonRpcTransport = { send: async (request) => {
      calls.push(request.method);
      return malformed;
    } };
    await assert.rejects(() => adapter(transport).refresh(), ChainIdentityError);
    assert.deepEqual(calls, ['eth_chainId']);
  }
  const calls: string[] = [];
  const unavailable: JsonRpcTransport = { send: async (request) => {
    calls.push(request.method);
    throw new JsonRpcError(-32601, 'identity method unavailable');
  } };
  await assert.rejects(() => reader(unavailable).entryCount(1n), /identity method unavailable/);
  assert.deepEqual(calls, ['eth_chainId']);
});

test('Kit refuses a provider switch during an application-root read without publishing it', async () => {
  const backend = node();
  const transport: JsonRpcTransport = { send: async (request) => {
    const result = await backend.send(request);
    if (request.method === 'eth_call') backend.set({ chainId: 8453n });
    return result;
  } };
  const chain = adapter(transport);
  await assert.rejects(() => chain.refresh(), ChainIdentityError);
  assert.equal(chain.finalizedHeight, 0n);
  assert.equal(chain.isFinalized(HEIGHT), false);
  assert.equal(chain.stateRootAt(HEIGHT), undefined);
});

test('Kit refuses a provider switch during a projection read', async () => {
  const backend = node();
  const transport: JsonRpcTransport = { send: async (request) => {
    const result = await backend.send(request);
    if (request.method === 'eth_call') backend.set({ chainId: 8453n });
    return result;
  } };
  await assert.rejects(() => reader(transport).holderAsOf(1n, 100n), ChainIdentityError);
});

test('Kit shared-transport mismatch quarantines roots but retains consumed admission heights', async () => {
  const transport = node();
  const chain = adapter(transport);
  await chain.refresh();
  chain.advanceHeight(1n, 10n);
  transport.set({ chainId: 8453n });
  await assert.rejects(() => reader(transport).entryCount(1n), ChainIdentityError);
  assert.equal(chain.finalizedHeight, 0n);
  assert.equal(chain.isFinalized(HEIGHT), false);
  assert.equal(chain.stateRootAt(HEIGHT), undefined);
  assert.equal(chain.acceptedHeight(1n), 10n);
  transport.set({ chainId: 1n });
  assert.equal(await chain.refresh(), HEIGHT);
  assert.equal(chain.stateRootAt(HEIGHT), ROOT);
  assert.equal(chain.acceptedHeight(1n), 10n);
  assert.throws(() => chain.advanceHeight(1n, 10n), /must advance/);
});

test('Kit discards an in-flight root even after a concurrently observed mismatch switches back', async () => {
  const backend = node();
  let entered!: () => void;
  const enteredRead = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const releaseRead = new Promise<void>((resolve) => { release = resolve; });
  const transport: JsonRpcTransport = { send: async (request) => {
    const result = await backend.send(request);
    if (request.method === 'eth_call') {
      entered();
      await releaseRead;
    }
    return result;
  } };
  const chain = adapter(transport);
  const rejected = assert.rejects(chain.refresh(), ChainIdentityError);
  await enteredRead;
  backend.set({ chainId: 8453n });
  await assert.rejects(() => reader(transport).entryCount(1n), ChainIdentityError);
  backend.set({ chainId: 1n });
  release();
  await rejected;
  assert.equal(chain.finalizedHeight, 0n);
  assert.equal(chain.stateRootAt(HEIGHT), undefined);
});

const finalityClient = (final: unknown): ProjectionClient => new ProjectionClient({
  baseUrl: 'https://kit.example',
  fetch: async () => ({ status: 200, json: async () => ({ holder: ALICE, final, openGap: null }) }),
});
test('Kit JS SDK preserves both genuine JSON finality booleans', async () => {
  for (const value of [false, true]) {
    const client = finalityClient(value);
    assert.equal(await client.isFinalAsOf(1n, 100n), value);
    assert.equal((await client.resolve(1n, 100n)).final, value);
  }
});
test('Kit JS SDK refuses non-boolean finality in single and combined reads', async () => {
  const invalidResponse = (error: unknown): boolean => error instanceof ProjectionClientError &&
    error.status === 502 && error.code === 'INVALID_RESPONSE';
  for (const value of ['false', 'true', 0, 1, null, undefined, {}, []]) {
    const client = finalityClient(value);
    await assert.rejects(() => client.isFinalAsOf(1n, 100n), invalidResponse);
    await assert.rejects(() => client.resolve(1n, 100n), invalidResponse);
  }
});

test('Kit permissions page renders authenticated directory subjects as text', () => {
  const admin = 'admin@example.org';
  const subject = '<img src=x onerror=alert(1)>&"\'';
  const directory = new Directory([[admin, 'ADMIN'], [subject, 'VIEWER']]);
  const response = handleConsole({ store: harness().store, directory, clock: { now: () => 100n } },
    { method: 'GET', path: '/permissions', user: admin });
  assert.equal(response.status, 200);
  assert.ok(!response.body.includes('<img'));
  assert.ok(response.body.includes('&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;'));
  assert.ok(response.body.includes('<td>VIEWER</td>'));
});
