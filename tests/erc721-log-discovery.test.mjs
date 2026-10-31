/** Synthetic RPC transcripts only; no credentials, network or transactions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256Utf8 } from '../src/codec/keccak.ts';
import { createErc721LogDiscovery } from '../server/erc721-log-discovery.mjs';
import { createRpcNftInventoryReader } from '../server/nft-inventory-reader.mjs';
import { encodeCall } from '../src/codec/abi.ts';
const account = '0x' + '1'.repeat(40), contract = '0x' + '2'.repeat(40);
const blockHash = '0x' + '3'.repeat(64), transactionHash = '0x' + '4'.repeat(64);
const topic = v => '0x' + '0'.repeat(24) + v.slice(2);
const context = { principal: { tenant: 'fixture', origin: 'https://wallet.example', username: 'owner', account, chainId: '1' }, readId: 'a'.repeat(32) };
function fixture(options = {}) {
  const state = { chain: '0x1', reorg: false, mutate: x => x, calls: [] };
  const log = { address: contract, removed: false, data: '0x',
    topics: [keccak256Utf8('Transfer(address,address,uint256)'), topic(account), topic(account), '0x' + (9007199254740993n).toString(16).padStart(64, '0')],
    blockNumber: '0x10', blockHash, transactionHash, transactionIndex: '0x0', logIndex: '0x0' };
  const contracts = [contract];
  const reader = createErc721LogDiscovery({ contracts, fromBlock: '0xf', now: () => 1000,
    rpcForPrincipal: async p => { assert.deepEqual(p, context.principal); return { async request(c) {
      state.calls.push(c);
      if (c.method === 'eth_chainId') return state.chain;
      if (c.method === 'eth_getBlockByNumber') return { number: '0x10', hash: state.reorg && c.params[0] !== 'finalized' ? transactionHash : blockHash };
      assert.equal(c.method, 'eth_getLogs'); return state.mutate([structuredClone(log)]);
    } }; }, ...options });
  return { reader, state, contracts };
}
test('self-transfer deduplicates and bigint IDs survive; bounded discovery stays partial', async () => {
  const f = fixture(); f.contracts[0] = account;
  const value = await f.reader.listForPrincipal(context);
  assert.equal(value.inventoryState, 'partial'); assert.equal(value.tokens.length, 1);
  assert.equal(value.tokens[0].tokenId, '9007199254740993'); assert.equal(value.tokens[0].contract, contract);
  assert.equal(value.tokens[0].metadata.state, 'unavailable'); assert.equal(value.validUntil, 31000);
  const queries = f.state.calls.filter(c => c.method === 'eth_getLogs');
  assert.equal(queries.length, 2); assert.equal(queries[0].params[0].fromBlock, '0xf');
  assert.ok(f.state.calls.every(c => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs'].includes(c.method)));
});
test('empty log window is partial, never a complete empty wallet', async () => {
  const f = fixture(); f.state.mutate = () => [];
  const value = await f.reader.listForPrincipal(context); assert.equal(value.inventoryState, 'partial'); assert.deepEqual(value.tokens, []);
});
test('wrong chain and changed pinned block refuse', async () => {
  for (const change of [s => s.chain = '0x2', s => s.reorg = true]) {
    const f = fixture(); change(f.state); await assert.rejects(f.reader.listForPrincipal(context), /NFT_LOG_DISCOVERY_REFUSED/);
  }
});
test('removed, foreign, malformed and out-of-window logs refuse', async () => {
  for (const change of [x => x.removed = true, x => x.address = account, x => x.topics.pop(),
    x => x.topics[2] = topic(contract), x => x.blockNumber = '0x11', x => x.blockHash = transactionHash,
    x => x.data = '0x00', x => x.logIndex = '0x00']) {
    const f = fixture(); f.state.mutate = logs => { change(logs[0]); return logs; };
    await assert.rejects(f.reader.listForPrincipal(context), /NFT_LOG_DISCOVERY_REFUSED/);
  }
});
test('conflicting duplicate log identity refuses', async () => {
  const f = fixture(); f.state.mutate = logs => [...logs, { ...logs[0], transactionHash: blockHash }];
  await assert.rejects(f.reader.listForPrincipal(context), /NFT_LOG_DISCOVERY_REFUSED/);
});
test('cap-sized provider response refuses possible silent truncation', async () => {
  const f = fixture({ maximumLogsPerQuery: 1 });
  await assert.rejects(f.reader.listForPrincipal(context), /NFT_LOG_DISCOVERY_REFUSED/);
});
test('oversized window refuses before log I/O', async () => {
  const f = fixture({ fromBlock: '0x0', maximumBlocks: 16 });
  await assert.rejects(f.reader.listForPrincipal(context), /NFT_LOG_DISCOVERY_REFUSED/);
  assert.equal(f.state.calls.filter(c => c.method === 'eth_getLogs').length, 0);
});
test('RPC failure propagates instead of manufacturing an empty inventory', async () => {
  const f = fixture(); f.state.mutate = () => { throw Error('provider unavailable'); };
  await assert.rejects(f.reader.listForPrincipal(context), /provider unavailable/);
});
test('composition verifies current ownership and never promotes log candidates to holdings', async () => {
  const calls = [], tokenId = '9007199254740993';
  const rpc = { async request(c) {
    calls.push(c);
    if (c.method === 'eth_chainId') return '0x1';
    if (c.method === 'eth_getBlockByNumber') return { number: '0x10', hash: blockHash };
    if (c.method === 'eth_getLogs') return [{ address: contract, removed: false, data: '0x',
      topics: [keccak256Utf8('Transfer(address,address,uint256)'), topic(account), topic(account), '0x' + BigInt(tokenId).toString(16).padStart(64, '0')],
      blockNumber: '0x10', blockHash, transactionHash, transactionIndex: '0x0', logIndex: '0x0' }];
    if (c.method === 'eth_getCode') return '0x6000';
    assert.equal(c.method, 'eth_call'); assert.equal(c.params[1], '0x10');
    const data = c.params[0].data;
    if (data === encodeCall('ownerOf(uint256)', ['uint256'], [BigInt(tokenId)])) return topic(contract);
    for (const iid of ['0x01ffc9a7', '0xffffffff', '0x80ac58cd']) {
      if (data === encodeCall('supportsInterface(bytes4)', ['bytes4'], [iid])) return '0x' + '0'.repeat(63) + (iid === '0xffffffff' ? '0' : '1');
    }
    throw Error('unexpected RPC call');
  } };
  const rpcForPrincipal = async () => rpc;
  const discovery = createErc721LogDiscovery({ contracts: [contract], fromBlock: '0xf', now: () => 1000, rpcForPrincipal });
  const reader = createRpcNftInventoryReader({ discovery, rpcForPrincipal, now: () => 1000 });
  const value = await reader.readForPrincipal(context);
  assert.equal(value.inventoryState, 'partial'); assert.deepEqual(value.records, []);
  assert.ok(calls.some(c => c.method === 'eth_call'));
  assert.ok(calls.every(c => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_getCode', 'eth_call'].includes(c.method)));
});
