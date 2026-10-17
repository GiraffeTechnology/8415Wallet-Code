import assert from 'node:assert/strict';
import { test } from 'node:test';

import { divergentToken, TOKEN } from '../src/adapters/memory/scenarios.ts';
import { InvariantViolationError, TransportError } from '../src/sdk/errors.ts';
import { encodeTopic, tokenFilter, topicOf, type RawLog } from '../src/sdk/events.ts';
import { buildSettlementLog } from '../src/wallet/settlementLog.ts';
import { delegateReader } from './support/delegateReader.ts';

async function fixture() {
  const { reader } = divergentToken();
  const logs = await reader.getLogs(tokenFilter(reader.source.address, 'SettlementStarted', TOKEN));
  const first = logs[0];
  assert.ok(first);
  return { reader, first };
}

const corruptions: readonly [string, (log: RawLog) => RawLog][] = [
  ['wrong contract', (log) => ({ ...log, address: `0x${'ef'.repeat(20)}` })],
  ['wrong token', (log) => ({ ...log, topics: log.topics.map((topic, index) =>
    index === 2 ? encodeTopic('uint256', TOKEN + 1n) : topic) })],
  ['wrong requested event', (log) => ({ ...log,
    topics: [topicOf('SettlementCancelled'), ...log.topics.slice(1)], data: '0x' })],
  ['unknown event', (log) => ({ ...log, topics: [`0x${'11'.repeat(32)}`, ...log.topics.slice(1)] })],
];
for (const [label, corrupt] of corruptions) {
  test(`rejects ${label} rather than publish successful gap history`, async () => {
    const { reader, first } = await fixture();
    const bad = delegateReader(reader, { getLogs: async () => [corrupt(first)] });
    await assert.rejects(buildSettlementLog(bad, TOKEN), (error: unknown) => {
      assert.ok(error instanceof InvariantViolationError);
      assert.equal(error.invariant, 'settlement-log-scope');
      return true;
    });
  });
}

test('rejects a successfully returned record for another token outside fallback catch', async () => {
  const { reader } = await fixture();
  const bad = delegateReader(reader, {
    getLogs: reader.getLogs.bind(reader),
    settlement: async (id) => ({ ...await reader.settlement(id), tokenId: TOKEN + 1n }),
  });
  await assert.rejects(buildSettlementLog(bad, TOKEN), (error: unknown) => {
    assert.ok(error instanceof InvariantViolationError);
    assert.equal(error.invariant, 'settlement-record-scope');
    return true;
  });
});

test('NONE cannot become a current still-open record for an observed settlement', async () => {
  const { reader } = await fixture();
  const bad = delegateReader(reader, {
    getLogs: reader.getLogs.bind(reader),
    settlement: async (id) => ({ ...await reader.settlement(id), status: 'NONE' }),
  });
  await assert.rejects(buildSettlementLog(bad, TOKEN), InvariantViolationError);
});

test('a failed optional record read preserves log facts without inventing openedAt', async () => {
  const { reader } = await fixture();
  const partial = delegateReader(reader, {
    getLogs: reader.getLogs.bind(reader),
    settlement: async () => { throw new TransportError('eth_call', 'unavailable'); },
  });
  const view = await buildSettlementLog(partial, TOKEN);
  assert.equal(view.available, true);
  // This token has three closed gaps and one still open, folded in admission
  // order, so the open one is last. A failed record read leaves every episode
  // log-derived, and none of them gains an openedAt.
  assert.equal(view.episodes.length, 4);
  assert.ok(view.episodes.every((episode) => episode.openedAt === undefined));
  assert.equal(view.episodes.at(-1)?.closure, 'still-open');
  assert.match(view.note, /log-derived/);
  assert.match(view.note, /not proof that every historical gap is present/);
});

test('valid scoped transitions preserve current enrichment and ordered events', async () => {
  const { reader } = await fixture();
  const view = await buildSettlementLog(reader, TOKEN);
  assert.equal(view.available, true);
  assert.equal(view.episodes.length, 4);
  const open = view.episodes.at(-1);
  assert.equal(open?.closure, 'still-open');
  assert.notEqual(open?.openedAt, undefined);
  // A readable record enriches every episode, not only the open one.
  assert.ok(view.episodes.every((episode) => episode.openedAt !== undefined));
  assert.ok(view.events.every((event) => event.tokenId === TOKEN));
});
