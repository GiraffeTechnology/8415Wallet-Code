import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken, TOKEN } from '../src/adapters/memory/scenarios.ts';
import { ValueOutOfRangeError } from '../src/sdk/errors.ts';
import { buildTemporalView } from '../src/wallet/temporalQuery.ts';

async function refusesBeforeRead(tokenId: unknown, instant: unknown,
  expected: typeof TypeError | typeof ValueOutOfRangeError): Promise<void> {
  const { reader } = divergentToken();
  let calls = 0;
  reader.supportsInterface = async () => { calls++; throw new Error('unexpected adapter call'); };
  await assert.rejects(buildTemporalView(reader, tokenId as bigint, instant as bigint), expected);
  assert.equal(calls, 0);
}
test('negative instant is invalid input, not an uncovered protocol instant', async () => {
  await refusesBeforeRead(TOKEN, -1n, ValueOutOfRangeError);
});
test('uint64 instant overflow is refused before adapter access', async () => {
  await refusesBeforeRead(TOKEN, 1n << 64n, ValueOutOfRangeError);
});
test('number, string and absent instants are not coerced to bigint', async () => {
  for (const value of [0, '0', undefined, null]) await refusesBeforeRead(TOKEN, value, TypeError);
});
test('negative token ID is refused before adapter access', async () => {
  await refusesBeforeRead(-1n, 0n, ValueOutOfRangeError);
});
test('uint256 token ID overflow is refused before adapter access', async () => {
  await refusesBeforeRead(1n << 256n, 0n, ValueOutOfRangeError);
});
test('number, string and absent token IDs are not coerced', async () => {
  for (const value of [0, '0', undefined, null]) await refusesBeforeRead(value, 0n, TypeError);
});
test('zero and maximum representable domains reach the adapter without range refusal', async () => {
  for (const tokenId of [0n, (1n << 256n) - 1n]) {
    for (const instant of [0n, (1n << 64n) - 1n]) {
      const { reader } = divergentToken();
      const marker = new Error('adapter reached; no asset or temporal result claimed');
      let calls = 0;
      reader.supportsInterface = async () => { calls++; throw marker; };
      await assert.rejects(buildTemporalView(reader, tokenId, instant), error => error === marker);
      assert.equal(calls, 1);
    }
  }
});
