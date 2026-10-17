import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FreshnessAnswer, WatchtowerBinding, WatchtowerPolicy } from '../src/sdk/watchtower.ts';
import { TransportError } from '../src/sdk/errors.ts';
import { buildFreshnessView } from '../src/wallet/freshness.ts';
function binding(answer: unknown, policy: unknown = { finalityDepth: 32n }): WatchtowerBinding {
  const unused = async (): Promise<never> => { assert.fail('unexpected watchtower method'); };
  return { assetId: '0x' + 'a'.repeat(64), provenance: 'configured', reader: {
    source: { chainId: 1n, address: '0x' + '1'.repeat(40) },
    freshnessOf: async () => answer as FreshnessAnswer,
    policyOf: async () => policy as WatchtowerPolicy,
    headOf: unused, computeAssetId: unused,
  } };
}
test('each supported raw status retains its own display and finality disclaimer', async () => {
  for (const [status, display] of [['UNKNOWN', 'unknown'], ['STALE', 'stale'],
    ['FRESH_PENDING', 'fresh-reorg-exposed'], ['FRESH_FINAL', 'reorg-safe']]) {
    const view = await buildFreshnessView(binding({ status, age: status === 'FRESH_PENDING' ? 1n : 40n }));
    assert.equal(view.reported, status);
    assert.equal(view.display, display);
    assert.match(view.disclaimer, /Freshness is not finality/);
  }
});
test('malformed status and age responses fail instead of producing a display', async () => {
  for (const answer of [null, undefined, { status: 'toString', age: 1n },
    { status: 'FRESH_FINAL', age: -1n }, { status: 'FRESH_FINAL', age: '40' },
    { status: 'FRESH_FINAL' }, { age: 1n }]) {
    await assert.rejects(buildFreshnessView(binding(answer)), TransportError);
  }
});
test('a successful malformed policy response is not downgraded to missing depth', async () => {
  for (const policy of [null, undefined, {}, { finalityDepth: -1n }, { finalityDepth: '32' }]) {
    const value = binding({ status: 'FRESH_FINAL', age: 40n });
    value.reader.policyOf = async () => policy as WatchtowerPolicy;
    await assert.rejects(buildFreshnessView(value), TransportError);
  }
});
test('an unavailable optional policy remains distinct from a malformed response', async () => {
  const value = binding({ status: 'FRESH_FINAL', age: 40n });
  value.reader.policyOf = async () => { throw new TransportError('policyOf', 'unavailable'); };
  const view = await buildFreshnessView(value);
  assert.equal(view.reported, 'FRESH_FINAL');
  assert.equal(view.finalityDepth, undefined);
  assert.match(view.explanation, /the configured depth/);
});
test('freshness transport failure propagates rather than becoming unknown or stale', async () => {
  const value = binding({ status: 'UNKNOWN', age: 0n });
  const failure = new TransportError('freshnessOf', 'unavailable');
  value.reader.freshnessOf = async () => { throw failure; };
  await assert.rejects(buildFreshnessView(value), error => error === failure);
});
