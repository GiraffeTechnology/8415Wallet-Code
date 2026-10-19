import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALICE, BOB, CAROL, admit, commitment, entry, gap, harness } from './support/fixtures.ts';
import type { ProjectionEntry, Settlement } from '../../src/kit/engine/projection/types.ts';

const TOKEN = 1n;

function assertEntryFrozen(record: ProjectionEntry): void {
  assert.equal(Object.isFrozen(record), true);
  for (const [field, value] of [
    ['holder', CAROL], ['effectiveAt', 1n], ['supersededAt', 1n],
    ['recordCommitment', commitment(999)], ['previousCommitment', commitment(998)],
    ['registryReference', commitment(997)], ['version', 999n],
  ] as const) assert.equal(Reflect.set(record, field, value), false, field);
}

function assertSettlementFrozen(record: Settlement): void {
  assert.equal(Object.isFrozen(record), true);
  for (const [field, value] of [
    ['status', 'OPEN'], ['settlementId', commitment(999)], ['tokenId', 2n],
    ['initiator', CAROL], ['expectedHolder', CAROL], ['snapshotHash', commitment(998)],
    ['openedAt', 0n], ['deadline', 0n],
  ] as const) assert.equal(Reflect.set(record, field, value), false, field);
}

test('admission and every entry accessor expose immutable records', () => {
  const h = harness();
  const candidate = entry({ version: 1n, holder: ALICE, effectiveAt: 100n, recordCommitment: commitment(1) });
  const admitted = admit(h, TOKEN, candidate).entry;
  // Copying inputs prevents later caller changes from reaching admitted history.
  Reflect.set(candidate, 'holder', CAROL);
  Reflect.set(candidate, 'effectiveAt', 1n);
  const expected = { ...admitted };
  for (const record of [admitted, h.store.entryAt(TOKEN, 1n), h.store.currentEntry(TOKEN),
    h.store.entryAsOf(TOKEN, 120n), ...h.store.entries(TOKEN)]) {
    assertEntryFrozen(record);
    assert.deepEqual(h.store.currentEntry(TOKEN), expected);
  }
  assert.equal(h.store.holderAsOf(TOKEN, 120n), ALICE);
  assert.equal(h.store.isFinalAsOf(TOKEN, 120n), false);

  admit(h, TOKEN, entry({ version: 2n, holder: BOB, effectiveAt: 130n,
    recordCommitment: commitment(2), previousCommitment: commitment(1) }));
  const closed = h.store.entryAt(TOKEN, 1n);
  assertEntryFrozen(closed);
  assertEntryFrozen(h.store.currentEntry(TOKEN));
  assert.deepEqual(closed, { ...expected, supersededAt: 130n });
  assert.equal(admitted.supersededAt, 0n, 'the prior returned snapshot was not mutated');
  assert.notEqual(closed, admitted);
  assert.equal(h.store.holderAsOf(TOKEN, 120n), ALICE);
  assert.equal(h.store.isFinalAsOf(TOKEN, 120n), true);

  const list = h.store.entries(TOKEN);
  Reflect.set(list, 0, {});
  assert.deepEqual(h.store.entryAt(TOKEN, 1n), closed, 'the returned array remains a separate copy');
});

test('all settlement outcomes and read accessors preserve immutable history', () => {
  const h = harness();
  admit(h, TOKEN, entry({ version: 1n, holder: ALICE, effectiveAt: 100n, recordCommitment: commitment(1) }));
  const firstId = commitment(70), secondId = commitment(71), thirdId = commitment(72);
  const request = gap({ settlementId: firstId });
  const first = h.store.openGap(TOKEN, request);
  Reflect.set(request, 'expectedHolder', CAROL);
  assert.equal(h.store.settlement(firstId).expectedHolder, BOB);
  assertSettlementFrozen(first);
  assertSettlementFrozen(h.store.settlement(firstId));
  for (const record of h.store.settlementsFor(TOKEN)) assertSettlementFrozen(record);

  const second = h.store.openGap(TOKEN, gap({ settlementId: secondId }));
  assertSettlementFrozen(h.store.settlement(firstId));
  assertSettlementFrozen(second);
  assert.deepEqual(h.store.settlement(firstId), { ...first, status: 'SUPERSEDED' });
  assert.equal(first.status, 'OPEN', 'the prior returned snapshot was not mutated');
  assert.equal(h.store.openGapOf(TOKEN), secondId);

  const cancelled = h.store.cancelGap(TOKEN);
  assertSettlementFrozen(cancelled);
  assert.equal(cancelled.status, 'CANCELLED');
  h.store.openGap(TOKEN, gap({ settlementId: thirdId }));
  admit(h, TOKEN, entry({ version: 2n, holder: BOB, effectiveAt: 130n,
    recordCommitment: commitment(2), previousCommitment: commitment(1) }));
  const records = h.store.settlementsFor(TOKEN);
  assert.deepEqual(records.map(record => record.status), ['SUPERSEDED', 'CANCELLED', 'ADMITTED']);
  for (const record of records) {
    assertSettlementFrozen(record);
    assertSettlementFrozen(h.store.settlement(record.settlementId));
  }
  Reflect.set(records, 0, {});
  assert.equal(h.store.settlement(firstId).status, 'SUPERSEDED');
  assert.equal(h.store.settlement(secondId).status, 'CANCELLED');
  assert.equal(h.store.settlement(thirdId).status, 'ADMITTED');
  assert.equal(h.store.holderAsOf(TOKEN, 120n), ALICE);
});
