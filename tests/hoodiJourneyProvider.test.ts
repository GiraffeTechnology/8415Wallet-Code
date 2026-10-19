import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContractRevertError } from '../src/sdk/errors.ts';
import { openHoodiJourneyRead } from '../src/wallet/hoodiJourneyProvider.ts';
import { HOODI_JOURNEY_GENESIS, type JourneyManifest } from '../src/wallet/hoodiJourney.ts';

const hash = '0x' + 'b'.repeat(64);
const manifest: JourneyManifest = {
  chainId: 560048n, genesisHash: HOODI_JOURNEY_GENESIS,
  contract: '0x' + 'a'.repeat(40), tokenId: 1n,
  registerId: '0x' + 'c'.repeat(64), verificationProfile: '0x' + 'd'.repeat(64),
  wallets: [],
};
function fakeProvider() {
  const calls: { method: string; params: unknown[] }[] = [];
  const provider = { async request(args: { method: string; params: unknown[] }): Promise<unknown> {
    calls.push(args);
    if (args.method === 'eth_chainId') return '0x88bb0';
    if (args.method === 'eth_getBlockByNumber') return args.params[0] === '0x0'
      ? { number: '0x0', hash: HOODI_JOURNEY_GENESIS, timestamp: '0x0' }
      : { number: '0x10', hash, timestamp: '0x100' };
    if (args.method === 'eth_getCode') return '0x6000';
    if (args.method === 'eth_call') return '0x' + '0'.repeat(64);
    throw new Error('unexpected method');
  } };
  return { calls, provider };
}

test('opening a finalized snapshot never requests an account or transaction', async () => {
  const f = fakeProvider();
  const pinned = await openHoodiJourneyRead(f.provider, manifest);
  assert.equal(pinned.blockNumber, 16n);
  assert.equal(pinned.recordedAt, 256n);
  assert.equal(await pinned.readBlockHash(16n), hash);
  assert.deepEqual(f.calls.slice(-3).map(c => c.method),
    ['eth_chainId', 'eth_getBlockByNumber', 'eth_chainId']);
  assert.ok(f.calls.some(c => c.method === 'eth_getBlockByNumber' && c.params[0] === 'finalized'));
  assert.ok(f.calls.every(c => !/send|sign|requestAccounts/i.test(c.method)));
});

test('genesis mismatch refuses rather than switching network or RPC', async () => {
  const f = fakeProvider();
  await assert.rejects(openHoodiJourneyRead({ request: async args =>
    args.method === 'eth_getBlockByNumber' && args.params[0] === '0x0'
      ? { number: '0x0', hash, timestamp: '0x0' } : f.provider.request(args),
  }, manifest), /genesis mismatch/);
});

test('all projection calls and code reads use the canonical block-hash tag', async () => {
  const f = fakeProvider();
  const pinned = await openHoodiJourneyRead(f.provider, manifest);
  await pinned.reader.registerId();
  const tagged = f.calls.filter(c => c.method === 'eth_call' || c.method === 'eth_getCode');
  assert.ok(tagged.length >= 2);
  for (const call of tagged) assert.deepEqual(call.params.at(-1), { blockHash: hash, requireCanonical: true });
});

test('structured execution revert remains a contract error, not empty success', async () => {
  const f = fakeProvider();
  const pinned = await openHoodiJourneyRead({ request: async args => {
    if (args.method === 'eth_call') throw { code: 3 };
    return f.provider.request(args);
  } }, manifest);
  await assert.rejects(pinned.reader.registerId(), ContractRevertError);
});

for (const otherChain of ['0x1', '0x2105']) test(`final header cannot publish after a late switch to ${otherChain}, even with the same hash`, async () => {
  const f = fakeProvider();
  const calls: { method: string; params: unknown[] }[] = [];
  let switched = false;
  const pinned = await openHoodiJourneyRead({ request: async args => {
    calls.push(args);
    if (args.method === 'eth_chainId' && switched) return otherChain;
    const answer = await f.provider.request(args);
    // Opening uses 'finalized'; only the subsequent numbered reread switches.
    if (args.method === 'eth_getBlockByNumber' && args.params[0] === '0x10') switched = true;
    return answer;
  } }, manifest);
  await assert.rejects(pinned.readBlockHash(16n), /Hoodi chain mismatch/);
  assert.equal(switched, true);
  assert.deepEqual(calls.slice(-3).map(c => c.method),
    ['eth_chainId', 'eth_getBlockByNumber', 'eth_chainId']);
  assert.equal(pinned.reader.source.chainId, 560048n);
  assert.ok(calls.every(c => !/send|sign|requestAccounts|switchEthereumChain/i.test(c.method)));
});
