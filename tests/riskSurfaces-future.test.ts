import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryErc8415Reader } from '../src/adapters/memory/memoryReader.ts';
import { divergentToken, TOKEN } from '../src/adapters/memory/scenarios.ts';
import type { RegisterEntry, TokenId } from '../src/sdk/types.ts';
import { buildRiskSurfaces } from '../src/wallet/riskSurfaces.ts';

// A display fixture only, not an admitted on-chain entry or protocol acceptance.
class EffectiveTimeFixture extends MemoryErc8415Reader {
  offset = 400n * 24n * 60n * 60n;
  override async currentEntry(tokenId: TokenId): Promise<RegisterEntry> {
    return { ...await super.currentEntry(tokenId), effectiveAt: await this.chainInstant() + this.offset };
  }
}
test('future effective time is not described as negative elapsed time or terminal by itself', async () => {
  const reader = new EffectiveTimeFixture(divergentToken().contract);
  const view = await buildRiskSurfaces(reader, TOKEN);
  const standing = view.surfaces.find((surface) => surface.id === 'stalled-register');
  const future = view.surfaces.find((surface) => surface.id === 'far-future-effective-time');
  assert.ok(standing);
  assert.ok(future);
  assert.equal(standing.present, false);
  assert.match(standing.finding, /ahead of now; no elapsed standing time/);
  assert.doesNotMatch(standing.finding, /-\d+ seconds have passed/);
  assert.equal(future.present, true);
  assert.match(future.meaning, /does not by itself prove/);
  assert.doesNotMatch(future.meaning, /permanently ends the projection/);
  assert.match(future.meaning, /uint64 maximum/);
});
test('past effective time retains an elapsed standing measurement', async () => {
  const reader = new EffectiveTimeFixture(divergentToken().contract);
  reader.offset = -60n;
  const view = await buildRiskSurfaces(reader, TOKEN);
  const standing = view.surfaces.find((surface) => surface.id === 'stalled-register');
  const future = view.surfaces.find((surface) => surface.id === 'far-future-effective-time');
  assert.ok(standing);
  assert.ok(future);
  assert.equal(standing.present, true);
  assert.match(standing.finding, /60 seconds have passed/);
  assert.equal(future.present, false);
});
