import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFinality } from '../src/wallet/finality.ts';
import { describePosture } from '../src/wallet/posture.ts';
import { noWatchtower, type FreshnessView } from '../src/wallet/freshness.ts';

const fresh: FreshnessView = { ...noWatchtower(), display: 'reorg-safe',
  reported: 'FRESH_FINAL', label: 'Reorg-safe', explanation: 'Synthetic fresh feed.' };
const input = { tokenId: 1n, instant: 150n, reported: true,
  firstEffectiveAt: 100n, latestEffectiveAt: 200n };
for (const feed of [fresh, { ...fresh, display: 'stale' as const }, noWatchtower()]) {
  test('unavailable projection remains unavailable with feed ' + feed.display, () => {
    const result = describePosture(describeFinality({ ...input, reported: undefined }), feed);
    assert.equal(result.case, 'projection-unavailable');
    assert.doesNotMatch(result.explanation, /ordinary catching up|No later admission can change/);
  });
}
test('uncovered is not ordinary pending even with a fresh feed', () => {
  const result = describePosture(describeFinality({ ...input, instant: 99n, reported: false }), fresh);
  assert.equal(result.case, 'projection-not-covered');
});
for (const change of [{ reported: false }, { firstEffectiveAt: undefined },
  { latestEffectiveAt: undefined }, { firstEffectiveAt: 300n }, { instant: 200n }]) {
  test('inconsistent or incomplete bounds never become settled: ' + JSON.stringify(change, (_, v) => typeof v === 'bigint' ? String(v) : v), () => {
    const finality = describeFinality({ ...input, ...change });
    const result = describePosture(finality, fresh);
    assert.equal(result.case, 'projection-unverified');
    assert.ok(result.projection.includes(finality.label));
  });
}
test('valid covered future-entry finality and ordinary provisional observations are preserved', () => {
  assert.equal(describePosture(describeFinality(input), fresh).case, 'settled-and-current');
  const result = describePosture(describeFinality({ ...input, instant: 200n, reported: false }), fresh);
  assert.equal(result.case, 'expected-change-feed-current');
  assert.doesNotMatch(result.referencePattern, /returning it if the gap is cancelled/);
});
