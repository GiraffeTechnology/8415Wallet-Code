import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryErc8415Reader } from '../src/adapters/memory/memoryReader.ts';
import { divergentToken, TOKEN } from '../src/adapters/memory/scenarios.ts';
import type { RegisterEntry, TokenId, Version } from '../src/sdk/types.ts';
import { buildHistoryView } from '../src/wallet/history.ts';

class HistoryBoundaryFixture extends MemoryErc8415Reader {
  wrongFirst = false;
  closedLatest = false;
  single = false;
  override async entryCount(tokenId: TokenId): Promise<bigint> {
    return this.single ? 1n : super.entryCount(tokenId);
  }
  override async entryAt(tokenId: TokenId, version: Version): Promise<RegisterEntry> {
    const entry = await super.entryAt(tokenId, version);
    const count = await this.entryCount(tokenId);
    return { ...entry,
      version: this.wrongFirst && version === 1n ? 42n : entry.version,
      supersededAt: this.closedLatest && version === count ? entry.effectiveAt + 1n : entry.supersededAt,
    };
  }
}
test('valid entry history remains intact', async () => {
  const view = await buildHistoryView(new HistoryBoundaryFixture(divergentToken().contract), TOKEN);
  assert.equal(view.chainIntact, true);
});
test('a non-one first version is retained and reported as a broken chain', async () => {
  const reader = new HistoryBoundaryFixture(divergentToken().contract);
  reader.wrongFirst = true;
  const view = await buildHistoryView(reader, TOKEN);
  assert.equal(view.chainIntact, false);
  assert.equal(view.entries[0]!.entry.version, 42n);
  assert.ok(view.entries[0]!.linkFaults.includes('version-not-consecutive'));
});
test('a closed latest interval cannot produce an intact-chain claim', async () => {
  const reader = new HistoryBoundaryFixture(divergentToken().contract);
  reader.closedLatest = true;
  const view = await buildHistoryView(reader, TOKEN);
  const latest = view.entries.at(-1)!;
  assert.equal(view.chainIntact, false);
  assert.ok(latest.linkFaults.includes('latest-entry-has-closed-interval'));
  assert.equal(latest.intervalEnd, latest.entry.supersededAt);
});
test('a single-entry history checks both first and latest boundaries', async () => {
  const reader = new HistoryBoundaryFixture(divergentToken().contract);
  reader.single = true;
  reader.wrongFirst = true;
  reader.closedLatest = true;
  const view = await buildHistoryView(reader, TOKEN);
  assert.equal(view.chainIntact, false);
  assert.ok(view.entries[0]!.linkFaults.includes('version-not-consecutive'));
  assert.ok(view.entries[0]!.linkFaults.includes('latest-entry-has-closed-interval'));
});
