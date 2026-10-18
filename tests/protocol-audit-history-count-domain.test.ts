import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DAVE, divergentToken, TOKEN } from '../src/adapters/memory/scenarios.ts';
import { InvariantViolationError, ProjectionNotInitialized } from '../src/sdk/errors.ts';
import type { Erc8415Reader } from '../src/sdk/port.ts';
import { buildHistoryView } from '../src/wallet/history.ts';
import { buildOwnershipHistory } from '../src/wallet/ownershipHistory.ts';
import { delegateReader } from './support/delegateReader.ts';

// Source-only regression candidates. No execution result is claimed.
const builders: readonly [string, (reader: Erc8415Reader) => Promise<unknown>][] = [
  ['projection history', reader => buildHistoryView(reader, TOKEN)],
  ['dual ownership history', reader => buildOwnershipHistory(reader, TOKEN)],
];
const invalidCounts: readonly [string, unknown][] = [
  ['negative bigint', -1n],
  ['uint64 overflow', 1n << 64n],
  ['number', 1],
  ['decimal string', '1'],
  ['missing', undefined],
  ['null', null],
];

for (const [builderName, build] of builders) {
  for (const [caseName, count] of invalidCounts) {
    test(`${builderName} refuses ${caseName} entryCount before entry or log reads`, async () => {
      const { reader } = divergentToken();
      let entryReads = 0;
      let logReads = 0;
      const unexpectedRead = new Error('count validation must precede dependent reads');
      const malformed = delegateReader(reader, {
        entryCount: async () => count as bigint,
        entryAt: async () => { entryReads++; throw unexpectedRead; },
        getLogs: async () => { logReads++; throw unexpectedRead; },
        chainInstantAt: async () => 0n,
      });
      await assert.rejects(build(malformed), error => {
        assert.notEqual(error, unexpectedRead, 'a malformed count reached dependent reads');
        assert.ok(error instanceof InvariantViolationError);
        assert.equal(error.invariant, 'entryCount');
        assert.equal(error.message, 'projection invariant violated (entryCount): must be a uint64 bigint');
        return true;
      });
      assert.equal(entryReads, 0);
      assert.equal(logReads, 0);
    });
  }
}

test('projection history retains the zero-count uninitialized result', async () => {
  const { reader } = divergentToken();
  let entryReads = 0;
  const empty = delegateReader(reader, {
    entryCount: async () => 0n,
    entryAt: async () => { entryReads++; throw new Error('must not read entries'); },
  });
  await assert.rejects(buildHistoryView(empty, TOKEN), ProjectionNotInitialized);
  assert.equal(entryReads, 0);
});

test('ownership history retains a genuine empty projection alongside readable position logs', async () => {
  const { reader } = divergentToken();
  let entryReads = 0;
  let logReads = 0;
  const empty = delegateReader(reader, {
    entryCount: async () => 0n,
    entryAt: async () => { entryReads++; throw new Error('must not read entries'); },
    getLogs: async filter => { logReads++; return reader.getLogs(filter); },
    chainInstantAt: block => reader.chainInstantAt(block),
  });
  const view = await buildOwnershipHistory(empty, TOKEN);
  assert.equal(view.available, true);
  assert.equal(view.entries, 0);
  assert.ok(view.positionChanges > 0);
  assert.ok(view.timeline.every(event => event.kind === 'position'));
  assert.ok(view.timeline.some(event => event.kind === 'position' && event.to === DAVE));
  assert.equal(view.correspondences.length, view.positionChanges);
  assert.ok(view.correspondences.every(item => item.state === 'outstanding' && item.apparentEntry === undefined));
  assert.equal(entryReads, 0);
  assert.equal(logReads, 1);
});

test('projection history retains valid positive entry counts and commitment links', async () => {
  const view = await buildHistoryView(divergentToken().reader, TOKEN);
  assert.deepEqual(view.entries.map(item => item.entry.version), [1n, 2n, 3n]);
  assert.equal(view.chainIntact, true);
});

test('ownership history retains both sequences with a valid positive entry count', async () => {
  const view = await buildOwnershipHistory(divergentToken().reader, TOKEN);
  assert.equal(view.entries, 3);
  assert.equal(view.available, true);
  assert.ok(view.timeline.some(event => event.kind === 'entry'));
  assert.ok(view.timeline.some(event => event.kind === 'position'));
});
