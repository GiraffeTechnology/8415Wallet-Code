import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryErc8415Reader } from '../src/adapters/memory/memoryReader.ts';
import { MemoryRegisterContract } from '../src/adapters/memory/register.ts';
import { CAROL, T } from '../src/adapters/memory/scenarios.ts';
import { ContractRevertError, TransportError } from '../src/sdk/errors.ts';
import { discoverHeldTokens } from '../src/wallet/discovery.ts';
import { delegateReader } from './support/delegateReader.ts';

function fixture() {
  const contract = new MemoryRegisterContract({ now: T.v1 });
  contract.mint(7n, CAROL);
  contract.mint(8n, CAROL);
  const reader = new MemoryErc8415Reader(contract);
  return { reader, getLogs: reader.getLogs.bind(reader) };
}

const failures = [
  new TransportError('eth_call', 'node unavailable'),
  new Error('adapter refused the read'),
  new ContractRevertError('ownerOf', '0x1234'),
];
for (const failure of failures) {
  test(`does not convert ${failure.name} into a successful empty discovery`, async () => {
    const { reader, getLogs } = fixture();
    const broken = delegateReader(reader, {
      getLogs,
      ownerOf: async () => { throw failure; },
    });
    await assert.rejects(discoverHeldTokens(broken, CAROL),
      (error: unknown) => error === failure);
  });
}

test('rejects after a later candidate fails instead of returning the earlier held subset', async () => {
  const { reader, getLogs } = fixture();
  const failure = new TransportError('eth_call', 'second candidate unavailable');
  const seen: bigint[] = [];
  const broken = delegateReader(reader, {
    getLogs,
    ownerOf: async (tokenId) => {
      seen.push(tokenId);
      if (tokenId === 8n) throw failure;
      return reader.ownerOf(tokenId);
    },
  });
  await assert.rejects(discoverHeldTokens(broken, CAROL),
    (error: unknown) => error === failure);
  assert.deepEqual(seen, [7n, 8n]);
});

test('projection-count failure also prevents a successful partial report', async () => {
  const { reader, getLogs } = fixture();
  const failure = new TransportError('eth_call', 'projection count unavailable');
  const broken = delegateReader(reader, {
    getLogs,
    entryCount: async () => { throw failure; },
  });
  await assert.rejects(discoverHeldTokens(broken, CAROL),
    (error: unknown) => error === failure);
});

test('log-scan failure is preserved instead of interpreted as no candidates', async () => {
  const { reader } = fixture();
  const failure = new TransportError('eth_getLogs', 'range refused');
  const broken = delegateReader(reader, {
    getLogs: async () => { throw failure; },
  });
  await assert.rejects(discoverHeldTokens(broken, CAROL),
    (error: unknown) => error === failure);
});

test('successful candidate reads still return held tokens in token-id order', async () => {
  const { reader, getLogs } = fixture();
  const result = await discoverHeldTokens(delegateReader(reader, { getLogs }), CAROL);
  assert.equal(result.available, true);
  assert.deepEqual(result.held.map(({ tokenId }) => tokenId), [7n, 8n]);
  assert.deepEqual(result.held.map(({ hasProjection }) => hasProjection), [false, false]);
  assert.deepEqual(result.movedOn, []);
});
