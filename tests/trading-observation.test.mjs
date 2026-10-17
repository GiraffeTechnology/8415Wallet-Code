import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeTradingObservation } from '../web/trading-observation.mjs';
const temporal = (display, reported) => ({ resolution: { kind: 'resolved', holderAgreesWithEntry: true },
  finality: { display, reported } });
const fresh = { reported: 'FRESH_FINAL', display: 'reorg-safe' };
test('final projection and current fresh feed do not establish commercial completion', () => {
  const value = describeTradingObservation(temporal('final', true), fresh);
  assert.equal(value.interpretation, 'projection-final-feed-fresh');
  assert.equal(value.commercialCompletion, 'NOT_DETERMINED');
  assert.equal(value.canExecute, false);
  assert.equal(value.pairing, 'UNVERIFIED_CONFIGURATION');
});
test('fresh reorg-exposed feed leaves provisional answer provisional', () => {
  const value = describeTradingObservation(temporal('provisional', false),
    { reported: 'FRESH_PENDING', display: 'fresh-reorg-exposed' });
  assert.equal(value.interpretation, 'projection-provisional-feed-fresh');
  assert.equal(value.projection, 'provisional');
});
test('stale is distinct from pending even when projection is final or unavailable', () => {
  for (const projection of [temporal('final', true), undefined]) {
    const value = describeTradingObservation(projection, { reported: 'STALE', display: 'stale' });
    assert.equal(value.interpretation, 'feed-not-current');
    assert.match(value.summary, /distinct from ordinary registration pending/);
  }
});
test('unknown or inconsistent feed cannot become fresh', () => {
  for (const feed of [undefined, { reported: 'UNKNOWN', display: 'unknown' },
    { reported: 'STALE', display: 'reorg-safe' }, { reported: 'toString', display: 'reorg-safe' }]) {
    assert.equal(describeTradingObservation(temporal('final', true), feed).interpretation, 'insufficient-observation');
  }
});
test('uncovered, missing or inconsistent projection cannot become a combined conclusion', () => {
  for (const view of [undefined, { resolution: { kind: 'not-covered' } },
    temporal('final', false), { ...temporal('final', true),
      resolution: { kind: 'resolved', holderAgreesWithEntry: false } }]) {
    assert.equal(describeTradingObservation(view, fresh).interpretation, 'insufficient-observation');
  }
});
test('comparison retains snapshot, historical freshness and contest limitations', () => {
  const value = describeTradingObservation(temporal('final', true), fresh);
  assert.match(value.caveat, /not an atomic snapshot/);
  assert.match(value.caveat, /not freshness at the historical query instant/);
  assert.match(value.caveat, /Contest remains separate/);
  assert.ok(Object.isFrozen(value));
});
