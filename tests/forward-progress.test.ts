import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForwardProgress } from '../src/wallet/forwardProgress.ts';
import type { LinkedChainSnapshot, LinkedCompletionEvidence } from '../src/sdk/linked.ts';
import type { Bytes32, Address } from '../src/sdk/types.ts';
const h = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Bytes32;
const a = (n: number) => ('0x' + (100 - n).toString(16).padStart(40, '0')) as Address;
function fixture(owner = 20, holder = 6, offset = 0n) {
  const snapshot: LinkedChainSnapshot = {
    asset: { chainId: 560048n, contract: a(50), tokenId: 7n }, sequenceId: h(1), revision: 2n,
    blockNumber: 10n, blockHash: h(2), initialOccurrenceId: h(100), initialHolder: a(0),
    offChainDetached: offset, ...(offset > 0n ? { detachedCommitment: h(3) } : {}),
    legs: Array.from({ length: 20 }, (_, i) => ({ id: h(200 + i), predecessorId: i === 0 ? null : h(199 + i),
      buyerOccurrenceId: h(101 + i), seller: a(i), buyer: a(i + 1), termsHash: h(300 + i),
      control: { controlId: h(400 + i), acceptanceHash: h(500 + i) }, outcome: 'active' as const })),
  };
  const evidence: LinkedCompletionEvidence = { kind: 'bound', asset: snapshot.asset, sequenceId: h(1), revision: 2n,
    blockNumber: 10n, blockHash: h(2), owner: { occurrenceId: h(100 + owner), account: a(owner) },
    admittedHolder: { occurrenceId: h(100 + holder), account: a(holder) }, protocolFinality: false };
  return { snapshot, evidence };
}
test('user occurrence6 keeps owner20 and the full chain plus white tail, with separate tracks', () => {
  const f = fixture(), v = buildForwardProgress(f.snapshot, f.evidence, h(106));
  assert.equal(v.userPosition, '6'); assert.equal(v.knownEnd, '20'); assert.equal(v.scaleEnd, '21');
  assert.deepEqual(v.owner.ratio, { numerator: '20', denominator: '21' });
  assert.deepEqual(v.holder.ratio, { numerator: '6', denominator: '21' }); assert.equal(v.state, 'DONE');
  assert.equal(v.protocolFinality, false); assert.equal(v.commercialExecution, 'not-evaluated');
});
test('holder already beyond the user is not a newly observed user-specific DONE milestone', () => {
  const f = fixture(20, 7); assert.equal(buildForwardProgress(f.snapshot, f.evidence, h(106)).state, 'PENDING');
});
test('global occurrences use lossless detached offsets, not window indexes or address rank', () => {
  const offset = 9007199254740993n, f = fixture(20, 6, offset), v = buildForwardProgress(f.snapshot, f.evidence, h(106));
  assert.equal(v.userPosition, (offset + 6n).toString()); assert.equal(v.knownEnd, (offset + 20n).toString());
  assert.equal(v.state, 'DONE');
});
test('unavailable or ambiguous evidence cannot turn into owner/holder zero or DONE', () => {
  const f = fixture();
  for (const kind of ['unavailable', 'ambiguous'] as const) {
    const v = buildForwardProgress(f.snapshot, { kind }, h(106));
    assert.equal(v.state, 'UNAVAILABLE'); assert.equal(v.owner.position, null); assert.equal(v.holder.position, null);
  }
});
test('privacy projection excludes preceding/subsequent wallets and cannot infer funds or rollback DONE', () => {
  const f = fixture(), v = buildForwardProgress(f.snapshot, f.evidence, h(106)), text = JSON.stringify(v);
  for (let i = 0; i <= 20; i++) assert.equal(text.includes(a(i)), false);
  assert.deepEqual(v.funds, { state: 'not-evaluated' }); assert.deepEqual(v.rollback, { state: 'not-evaluated' });
  assert.equal(v.canExecute, false);
});
test('wrong own occurrence, asset evidence or source block is refused', () => {
  const f = fixture(); assert.throws(() => buildForwardProgress(f.snapshot, f.evidence, h(999)));
  assert.throws(() => buildForwardProgress(f.snapshot, { ...f.evidence, blockHash: h(999) } as LinkedCompletionEvidence, h(106)));
});

