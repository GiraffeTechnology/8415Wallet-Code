import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WatchtowerBinding, WatchtowerPolicy } from '../src/sdk/watchtower.ts';
import { TransportError } from '../src/sdk/errors.ts';
import { buildFreshnessView } from '../src/wallet/freshness.ts';
const asset = '0x' + 'a'.repeat(64), other = '0x' + 'b'.repeat(64);
function fixture() {
  const source = { chainId: 1n, address: '0x' + '1'.repeat(40) };
  const unused = async (): Promise<never> => { assert.fail('unexpected method'); };
  const value: WatchtowerBinding = { assetId: asset, provenance: 'configured', reader: {
    source, freshnessOf: async () => ({ status: 'FRESH_FINAL', age: 40n }),
    policyOf: async () => ({ finalityDepth: 32n } as WatchtowerPolicy),
    headOf: unused, computeAssetId: unused,
  } };
  return { source, value };
}
test('binding labels and both requested asset IDs stay captured across caller mutation', async () => {
  const { value } = fixture();
  const configured = { ...value, claimedRegisterId: asset,
    provenance: 'configured' as 'configured' | 'computed' };
  const seen: string[] = [];
  value.reader.freshnessOf = async id => {
    seen.push(id);
    configured.assetId = other;
    configured.claimedRegisterId = other;
    configured.provenance = 'computed';
    return { status: 'FRESH_FINAL', age: 40n };
  };
  value.reader.policyOf = async id => { seen.push(id); return { finalityDepth: 32n } as WatchtowerPolicy; };
  const view = await buildFreshnessView(configured);
  assert.deepEqual(seen, [asset, asset]);
  assert.equal(view.assetId, asset);
  assert.equal(view.binding?.claimedRegisterId, asset);
  assert.equal(view.binding?.provenance, 'configured');
  assert.match(view.bindingNote!, /supplied by configuration/);
});
for (const field of ['chainId', 'address'] as const) {
  for (const phase of ['freshness', 'policy', 'failed-policy'] as const) {
    test(`changed ${field} during ${phase} refuses relabelled observation`, async () => {
      const { source, value } = fixture();
      const change = () => { if (field === 'chainId') source.chainId = 2n; else source.address = '0x' + '2'.repeat(40); };
      if (phase === 'freshness') value.reader.freshnessOf = async () => {
        change(); return { status: 'FRESH_FINAL', age: 40n };
      };
      else value.reader.policyOf = async () => {
        change();
        if (phase === 'failed-policy') throw new Error('unavailable');
        return { finalityDepth: 32n } as WatchtowerPolicy;
      };
      await assert.rejects(buildFreshnessView(value), TransportError);
    });
  }
}
test('returned source label is a frozen copy, not a live alias', async () => {
  const { source, value } = fixture();
  const view = await buildFreshnessView(value);
  assert.ok(Object.isFrozen(view.source));
  source.chainId = 2n;
  assert.equal(view.source?.chainId, 1n);
  assert.equal(Reflect.set(view.source!, 'chainId', 3n), false);
});
