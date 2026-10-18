import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRegisterContract } from '../src/adapters/memory/register.ts';
import { MemoryErc8415Reader } from '../src/adapters/memory/memoryReader.ts';
import { WalletSession } from '../src/wallet/session.ts';
import { describeAcquisition } from '../src/wallet/acquisition.ts';

const holder = '0x' + '1'.repeat(40);
async function fixture(now: bigint) {
  const contract = new MemoryRegisterContract({ now });
  contract.mint(1n, holder);
  contract.seedEntries(1n, [{ holder, effectiveAt: 100n, seed: 'a' },
    { holder, effectiveAt: 200n, seed: 'b' }]);
  return new WalletSession(new MemoryErc8415Reader(contract)).assetView(1n);
}
test('future admitted effective time legitimately makes a covered present instant final', async () => {
  const view = await fixture(150n);
  assert.equal(view.presentFinality.final, true);
  assert.equal(view.presentFinality.agreement, 'consistent');
  const output = describeAcquisition(view, 150n).points.join(' ');
  assert.match(output, /isFinalAsOf reports final/);
  assert.doesNotMatch(output, /will not be final|present instant never/);
});
test('the latest effective boundary remains not final, without universalizing the answer', async () => {
  const view = await fixture(200n);
  const output = describeAcquisition(view, 200n).points.join(' ');
  assert.match(output, /isFinalAsOf reports not final/);
  assert.doesNotMatch(output, /present instant never/);
});
test('a distinct requested acquisition time is not assigned the cached present answer', async () => {
  const view = await fixture(150n);
  const output = describeAcquisition(view, 201n).points.join(' ');
  assert.match(output, /No finality answer for the acquisition instant \(201\) was obtained/);
  assert.doesNotMatch(output, /isFinalAsOf reports final/);
});
test('contradictory contract answers retain the disagreement explanation', async () => {
  const view = await fixture(150n);
  const changed = { ...view, presentFinality: { ...view.presentFinality,
    final: false, agreement: 'disagrees' as const, explanation: 'Observed finality disagrees with the rule.' } };
  const output = describeAcquisition(changed, 150n).points.join(' ');
  assert.match(output, /isFinalAsOf reports not final/);
  assert.match(output, /disagrees with the rule/);
});
