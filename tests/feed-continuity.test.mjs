import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedContinuity, describeFeedContinuity, readFeedContinuity } from '../web/feed-continuity.mjs';
const address = '0x' + '1'.repeat(40), tower = '0x' + '2'.repeat(40), registerId = '0x' + '1'.repeat(64);
const first = { chainId: '560048', address: tower, assetId: '0x' + '2'.repeat(64) };
const second = { chainId: '560048', address: tower, assetId: '0x' + '3'.repeat(64) };
function input(feeds = [first, second]) {
  return { schema: '8415wallet-feed-continuity/1',
    projection: { chainId: '560048', contract: address, registerId }, feeds };
}
function wallet() {
  return { reader: { source: { chainId: 560048n, address } },
    assetView: async tokenId => ({ tokenId, observedAt: 9007199254740993n,
      identity: { chainId: 560048n, address, registerId } }) };
}
test('ordered predecessors and current feed remain explicitly unverified', () => {
  const value = describeFeedContinuity(input());
  assert.equal(value.rows[0].role, 'asserted-predecessor');
  assert.equal(value.rows[1].role, 'asserted-current');
  assert.equal(value.rows[1].predecessorLink, 'UNVERIFIED_CONFIGURATION');
  assert.equal(value.rows[1].previousPosition, 0);
  assert.equal(value.canExecute, false); assert.equal(value.changesRuntimeConfiguration, false);
  assert.ok(Object.isFrozen(value.rows[1].feed));
});
test('one feed declares no predecessor rather than manufacturing history', () => {
  const value = describeFeedContinuity(input([first]));
  assert.equal(value.rows[0].role, 'asserted-current');
  assert.equal(value.rows[0].predecessorLink, 'NOT_DECLARED');
});
test('repeated feed identities are retained and labelled, not collapsed or ranked', () => {
  const value = describeFeedContinuity(input([first, second, first]));
  assert.equal(value.rows.length, 3);
  assert.equal(value.rows[0].repeatedIdentity, true);
  assert.equal(value.rows[2].repeatedIdentity, true);
  assert.equal(value.rows[2].previousPosition, 1);
});
test('rejects credentials, URLs and approval fields instead of importing authority', () => {
  for (const key of ['apiKey','url','verified','approved']) {
    const value = input(); value.feeds[0] = { ...first, [key]: 'not authority' };
    assert.throws(() => parseFeedContinuity(JSON.stringify(value)));
  }
});
test('canonical lossless identities and bounded files are required', () => {
  const value = input(); value.projection.chainId = 560048;
  assert.throws(() => parseFeedContinuity(JSON.stringify(value)));
  value.projection.chainId = '0560048'; assert.throws(() => parseFeedContinuity(JSON.stringify(value)));
  assert.throws(() => parseFeedContinuity(JSON.stringify(input(Array.from({ length: 33 }, () => first)))));
  assert.throws(() => parseFeedContinuity(' '.repeat(16385)));
});
test('review reads the selected projection only and never probes or selects a feed', async () => {
  const selected = wallet(); let calls = 0;
  const original = selected.assetView; selected.assetView = async id => { calls++; return original(id); };
  const result = await readFeedContinuity({ wallet: selected, tokenId: 1n, text: JSON.stringify(input()), guard() {} });
  assert.equal(calls, 1);
  assert.equal(result.projectionObservation.observedAt, '9007199254740993');
  assert.equal(result.changesRuntimeConfiguration, false);
});
test('wrong projection or register is refused', async () => {
  const value = input(); value.projection.contract = tower;
  await assert.rejects(readFeedContinuity({ wallet: wallet(), tokenId: 1n, text: JSON.stringify(value), guard() {} }));
  value.projection.contract = address; value.projection.registerId = second.assetId;
  await assert.rejects(readFeedContinuity({ wallet: wallet(), tokenId: 1n, text: JSON.stringify(value), guard() {} }));
});
test('late cancellation or reader source change cannot publish a review', async () => {
  const selected = wallet(); let active = true;
  selected.assetView = async id => { active = false; return wallet().assetView(id); };
  await assert.rejects(readFeedContinuity({ wallet: selected, tokenId: 1n, text: JSON.stringify(input()),
    guard() { if (!active) throw new Error('cancelled'); } }));
  const drift = wallet(); drift.assetView = async id => { drift.reader.source.chainId = 1n; return wallet().assetView(id); };
  await assert.rejects(readFeedContinuity({ wallet: drift, tokenId: 1n, text: JSON.stringify(input()), guard() {} }));
});
