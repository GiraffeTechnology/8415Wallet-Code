import test from 'node:test';
import assert from 'node:assert/strict';
import { readWatchtowerComparison } from '../web/watchtower-read.mjs';

const address = n => '0x' + n.repeat(40), hash = n => '0x' + n.repeat(64);
function setup() {
  const declaration = { schema: '8415wallet-feed-continuity/1',
    projection: { chainId: '560048', contract: address('1'), registerId: hash('2') },
    feeds: [{ chainId: '560048', address: address('3'), assetId: hash('4') },
      { chainId: '560048', address: address('5'), assetId: hash('6') }] };
  let reads = 0;
  const wallet = { reader: { source: { chainId: 560048n, address: address('1') } },
    assetView: async tokenId => ({ tokenId, identity: { chainId: 560048n, address: address('1'), registerId: hash('2') }, observedAt: 1000n }),
    temporalQuery: async () => ({ finality: { state: 'provisional' }, contest: { state: 'not-contested' } }) };
  return { declaration, wallet, get reads() { return reads; },
    args: { wallet, tokenId: 1n, text: JSON.stringify(declaration), instant: '100', guard: () => {},
      readFreshness: async feed => { reads++; return { reported: 'STALE', display: 'stale', assetId: feed.assetId }; } } };
}
test('current feed only, stale stays distinct from provisional and does not authorize actions', async () => {
  const fixture = setup(), value = await readWatchtowerComparison(fixture.args);
  assert.equal(fixture.reads, 1);
  assert.equal(value.assertedCurrentFeed.assetId, hash('6'));
  assert.equal(value.freshness.reported, 'STALE');
  assert.equal(value.temporal.finality.state, 'provisional');
  assert.equal(value.pairing, 'UNVERIFIED_CONFIGURATION');
  assert.equal(value.canExecute, false);
  assert.equal(value.changesRuntimeConfiguration, false);
  assert.match(value.readSemantics, /NOT_ATOMIC/);
});
test('reorg-safe freshness does not replace provisional temporal finality', async () => {
  const { args } = setup(); args.readFreshness = async () => ({ reported: 'FRESH_FINAL', display: 'reorg-safe' });
  const value = await readWatchtowerComparison(args);
  assert.equal(value.freshness.display, 'reorg-safe'); assert.equal(value.temporal.finality.state, 'provisional');
});
test('invalid or uint64-overflow instant is refused before feed reads', async () => {
  for (const instant of ['01', '-1', '1.2', '18446744073709551616']) {
    const fixture = setup(); await assert.rejects(readWatchtowerComparison({ ...fixture.args, instant }));
    assert.equal(fixture.reads, 0);
  }
});
test('cross-chain declaration never probes another network', async () => {
  const fixture = setup(); fixture.declaration.feeds[1].chainId = '1';
  await assert.rejects(readWatchtowerComparison({ ...fixture.args, text: JSON.stringify(fixture.declaration) }));
  assert.equal(fixture.reads, 0);
});
test('projection identity mismatch blocks the feed read', async () => {
  const fixture = setup(); fixture.declaration.projection.registerId = hash('7');
  await assert.rejects(readWatchtowerComparison({ ...fixture.args, text: JSON.stringify(fixture.declaration) }));
  assert.equal(fixture.reads, 0);
});
test('temporal failure is not replaced by feed success', async () => {
  const fixture = setup(); fixture.wallet.temporalQuery = async () => { throw new Error('unavailable'); };
  await assert.rejects(readWatchtowerComparison(fixture.args)); assert.equal(fixture.reads, 0);
});
test('failed current feed does not query a predecessor as fallback', async () => {
  const fixture = setup(); let attempts = 0;
  await assert.rejects(readWatchtowerComparison({ ...fixture.args, readFreshness: async feed => {
    attempts++; assert.equal(feed.assetId, hash('6')); throw new Error('unavailable');
  } }));
  assert.equal(attempts, 1);
});
test('revoked guard after a feed response prevents publication', async () => {
  const fixture = setup(); let revoked = false;
  await assert.rejects(readWatchtowerComparison({ ...fixture.args,
    guard: () => { if (revoked) throw new Error('revoked'); },
    readFreshness: async () => { revoked = true; return { reported: 'FRESH_FINAL' }; } }));
});
test('reader switch during a feed response prevents publication', async () => {
  const fixture = setup();
  await assert.rejects(readWatchtowerComparison({ ...fixture.args, readFreshness: async () => {
    fixture.wallet.reader = { source: { chainId: 560048n, address: address('1') } };
    return { reported: 'UNKNOWN' };
  } }));
});
test('final immutable register recheck fails closed', async () => {
  const fixture = setup(), original = fixture.wallet.assetView; let calls = 0;
  fixture.wallet.assetView = async id => {
    const value = await original(id); calls++; if (calls > 1) value.identity.registerId = hash('8'); return value;
  };
  await assert.rejects(readWatchtowerComparison(fixture.args)); assert.equal(fixture.reads, 1);
});
