import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeFinality } from '../src/wallet/finality.ts';

const bounds = { tokenId: 1n, firstEffectiveAt: 10n, latestEffectiveAt: 20n };
for (const instant of [20n, 21n]) {
  test(`flags true at or beyond the latest boundary (${instant}) without replacing it`, () => {
    const view = describeFinality({ ...bounds, instant, reported: true });
    assert.equal(view.reported, true);
    assert.equal(view.display, 'final');
    assert.match(view.label, /reported; observations inconsistent/);
    assert.match(view.explanation, /at or after/);
    assert.doesNotMatch(view.explanation, /No entry admitted in the future can change/);
  });
}
test('preserves true before the first boundary with an explicit inconsistency label', () => {
  const view = describeFinality({ ...bounds, instant: 9n, reported: true });
  assert.equal(view.reported, true);
  assert.match(view.label, /inconsistent/);
  assert.match(view.explanation, /precedes the first/);
});
test('does not explain false inside the final interval as after the latest boundary', () => {
  const view = describeFinality({ ...bounds, instant: 10n, reported: false });
  assert.equal(view.reported, false);
  assert.equal(view.display, 'provisional');
  assert.match(view.label, /reported; observations inconsistent/);
  assert.match(view.explanation, /strictly before/);
  assert.doesNotMatch(view.explanation, /a later admission may carry an earlier/);
});
test('missing bounds do not invent an interval for either reported answer', () => {
  for (const reported of [true, false]) {
    const view = describeFinality({ tokenId: 1n, instant: 15n, reported,
      firstEffectiveAt: undefined, latestEffectiveAt: undefined });
    assert.equal(view.reported, reported);
    assert.match(view.label, /reported/);
    assert.match(view.explanation, /boundary was not obtained/);
    assert.doesNotMatch(view.explanation, /unknown\)/);
  }
});
test('reversed entry boundaries are flagged for either reported answer', () => {
  for (const reported of [true, false]) {
    const view = describeFinality({ ...bounds, firstEffectiveAt: 30n, instant: 25n, reported });
    assert.equal(view.reported, reported);
    assert.match(view.label, /entry boundaries inconsistent/);
    assert.match(view.explanation, /cannot explain it as a valid projection interval/);
  }
});
test('normal final, provisional and uncovered explanations retain their categories', () => {
  assert.equal(describeFinality({ ...bounds, instant: 10n, reported: true }).label, 'Final');
  assert.equal(describeFinality({ ...bounds, instant: 20n, reported: false }).label, 'Provisional');
  assert.equal(describeFinality({ ...bounds, instant: 9n, reported: false }).display, 'not-covered');
});
test('equal first and latest boundaries have no final interval at the boundary', () => {
  const view = describeFinality({ ...bounds, firstEffectiveAt: 20n, instant: 20n, reported: true });
  assert.match(view.label, /observations inconsistent/);
});
test('an unavailable answer never becomes final from entry bounds', () => {
  const view = describeFinality({ ...bounds, instant: 15n, reported: undefined });
  assert.equal(view.reported, undefined);
  assert.equal(view.display, 'unavailable');
  assert.equal(view.label, 'Unavailable — no answer was obtained');
});
