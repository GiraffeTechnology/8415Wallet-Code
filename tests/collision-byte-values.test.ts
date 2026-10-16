import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken, TOKEN } from '../src/adapters/memory/scenarios.ts';
import type { RegisterEntry } from '../src/sdk/types.ts';
import { detectCollisions } from '../src/wallet/collisions.ts';

const lower = '0x' + 'ab'.repeat(32);
const upper = '0x' + 'AB'.repeat(32);
test('equal bytes with mixed hex case collide across tokens for both fields', async () => {
  const { reader } = divergentToken();
  const sample = await reader.entryAt(TOKEN, 1n);
  reader.entryCount = async () => 1n;
  reader.entryAt = async tokenId => ({ ...sample,
    recordCommitment: tokenId === 1n ? lower : upper,
    registryReference: tokenId === 1n ? upper : lower,
  });
  const report = await detectCollisions(reader, [1n, 2n]);
  assert.equal(report.collisions.length, 2);
  for (const collision of report.collisions) {
    assert.equal(collision.value, lower);
    assert.equal(collision.crossToken, true);
    assert.deepEqual(collision.occurrences, [{ tokenId: 1n, version: 1n }, { tokenId: 2n, version: 1n }]);
  }
});
for (const field of ['recordCommitment', 'registryReference'] as const) {
  test(`malformed ${field} refuses the entire scan instead of a partial result`, async () => {
    const { reader } = divergentToken();
    const sample = await reader.entryAt(TOKEN, 1n);
    reader.entryCount = async () => 1n;
    for (const invalid of [undefined, '0x1', 'not-a-hash', '0x' + 'g'.repeat(64)]) {
      reader.entryAt = async tokenId => tokenId === 1n ? sample
        : ({ ...sample, [field]: invalid } as RegisterEntry);
      await assert.rejects(detectCollisions(reader, [1n, 2n]), /COLLISION_BYTES32_REFUSED/);
    }
  });
}
test('canonical comparison does not mutate the received entry object', async () => {
  const { reader } = divergentToken();
  const sample = Object.freeze({ ...await reader.entryAt(TOKEN, 1n),
    recordCommitment: upper, registryReference: upper });
  reader.entryCount = async () => 1n;
  reader.entryAt = async () => sample;
  await detectCollisions(reader, [1n, 2n]);
  assert.equal(sample.recordCommitment, upper);
  assert.equal(sample.registryReference, upper);
});
test('different valid byte values do not collide', async () => {
  const { reader } = divergentToken();
  const sample = await reader.entryAt(TOKEN, 1n);
  reader.entryCount = async () => 1n;
  reader.entryAt = async tokenId => ({ ...sample,
    recordCommitment: tokenId === 1n ? lower : '0x' + 'cd'.repeat(32),
    registryReference: tokenId === 1n ? lower : '0x' + 'cd'.repeat(32),
  });
  assert.equal((await detectCollisions(reader, [1n, 2n])).collisions.length, 0);
});
