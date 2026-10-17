import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatInstant } from '../src/wallet/format.ts';
test('last four-digit Gregorian year keeps its full date and clock', () => {
  assert.equal(formatInstant(253402300799n), '9999-12-31 23:59:59 UTC (253402300799)');
});
test('expanded Gregorian year does not shift the time substring', () => {
  assert.equal(formatInstant(253402300800n), '+010000-01-01 00:00:00 UTC (253402300800)');
});
test('maximum Date instant retains its expanded date and exact integer', () => {
  assert.equal(formatInstant(8640000000000n), '+275760-09-13 00:00:00 UTC (8640000000000)');
});
test('outside Date range and uint64 maximum retain existing integer fallback', () => {
  for (const instant of [8640000000001n, (1n << 64n) - 1n]) {
    assert.equal(formatInstant(instant), `${instant} (beyond representable calendar time)`);
  }
});
test('representable expanded instants retain integer recovery and eight clock characters', () => {
  for (const instant of [253402300800n, 253402387199n, 8640000000000n]) {
    const value = formatInstant(instant);
    assert.equal(value.match(/\((\d+)\)$/)?.[1], instant.toString());
    assert.match(value, /^\+\d{6}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC /);
  }
});
