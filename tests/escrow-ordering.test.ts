import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEscrow } from '../src/wallet/renderEscrow.ts';
import { buildEscrowView } from '../src/wallet/escrowView.ts';
import type { Trade, TradeObservation, ReleaseConfirmation, ReleaseOrderingEvidence } from '../src/sdk/escrow.ts';
import type { Bytes32 } from '../src/sdk/types.ts';

// Presentation/identity regressions only, not EVM, authenticated UI or Hoodi acceptance.
const h = (n: string) => `0x${n.repeat(64)}` as Bytes32;
const buyer = `0x${'b'.repeat(40)}` as const, seller = `0x${'a'.repeat(40)}` as const;
const trade: Trade = { projection: seller, tokenId: 1n, seller, buyer, price: 0n,
  entryCountAtFunding: 1n, admissionDeadline: 200n, maxEffectiveAt: 190n, state: 'RELEASED' };
const observation: TradeObservation = { state: 'RELEASED', confirmed: false, version: 3n, effectiveAt: 100n,
  confirmedHolder: seller, positionHolder: buyer, entryCount: 3n };
const position = { blockNumber: 10n, blockHash: h('1'), transactionHash: h('2'), transactionIndex: 0n };
const release: ReleaseConfirmation = { version: 2n, effectiveAt: 90n, recordCommitment: h('4'), position: { ...position, logIndex: 0n } };
const after: ReleaseOrderingEvidence = { attempt: { position, outcome: 'released', basisVersion: 2n, basisSource: 'release-event', basisCommitment: h('4') },
  supersession: { source: 'canonical-receipt-and-entry', scope: 'release-block-only',
    position: { ...position, transactionHash: h('3'), transactionIndex: 1n, logIndex: 2n },
    supersededVersion: 2n, supersededCommitment: h('4'), successorVersion: 3n, successorCommitment: h('5'), effectiveAt: 100n } };

test('release before same-block admission preserves release v2 while classifying later supersession', () => {
  const view = buildEscrowView(trade, observation, 100n, release, after);
  assert.equal(view.releaseOrdering.classification, 'superseded-after-release');
  assert.equal(view.confirmingVersion, 2n); assert.equal(view.confirmingRecordCommitment, h('4'));
  assert.equal(view.confirmedHolder, seller); assert.equal(view.state, 'released');
  assert.equal(view.releaseOrdering.evidence?.attempt.position.transactionIndex, 0n);
  assert.equal(view.releaseOrdering.evidence?.supersession?.position.transactionIndex, 1n);
  const beforeRender = structuredClone(view), text = renderEscrow(view);
  assert.match(text, /Release ordering\s+superseded-after-release/);
  assert.match(text, /Confirming entry\s+v2/);
  assert.ok(text.includes(h('4')));
  assert.ok(text.includes(seller));
  assert.match(text.replace(/\s+/g, ' '), /release anchor is retained/);
  assert.deepEqual(view, beforeRender);
});

test('admission before reverted attempt is not a completed release or an execution-time entry assertion', () => {
  const before = structuredClone(after);
  const input: ReleaseOrderingEvidence = { attempt: { ...before.attempt, position: { ...position, transactionIndex: 1n },
    outcome: 'reverted', basisSource: 'prepared-observation', basisCommitment: undefined },
    supersession: { ...before.supersession!, position: { ...before.supersession!.position, transactionIndex: 0n } } };
  const view = buildEscrowView({ ...trade, state: 'FUNDED' }, { ...observation, state: 'FUNDED' }, 100n, undefined, input);
  assert.equal(view.releaseOrdering.classification, 'superseded-before-release-attempt');
  assert.equal(view.confirmingVersion, undefined); assert.equal(view.confirmingRecordCommitment, undefined);
  assert.equal(view.state, 'waiting-for-the-register');
  assert.match(view.releaseOrdering.note, /No successful release or execution-time entry read/);
  const beforeRender = structuredClone(view), text = renderEscrow(view);
  assert.match(text, /Release ordering\s+superseded-before-release-attempt/);
  assert.match(text.replace(/\s+/g, ' '), /No successful release or execution-time/);
  assert.doesNotMatch(text, /Confirming entry|Release commitment/);
  assert.deepEqual(view, beforeRender);
});

test('block-end version, timestamps and a release without positioned event cannot manufacture ordering', () => {
  assert.equal(buildEscrowView(trade, observation, 100n, release).releaseOrdering.classification, 'unknown');
  assert.equal(buildEscrowView(trade, observation, 100n, { version: 2n, effectiveAt: 90n, recordCommitment: h('4') }, after).releaseOrdering.classification, 'unknown');
  assert.equal(buildEscrowView(trade, observation, 100n, release, { attempt: after.attempt }).releaseOrdering.classification, 'unknown');
});

test('conflicting block, entry, receipt and same-transaction positions remain unknown', () => {
  const variants: ReleaseOrderingEvidence[] = [
    { ...after, supersession: { ...after.supersession!, position: { ...after.supersession!.position, blockHash: h('6') } } },
    { ...after, supersession: { ...after.supersession!, supersededVersion: 1n } },
    { ...after, supersession: { ...after.supersession!, supersededCommitment: h('6') } },
    { ...after, supersession: { ...after.supersession!, successorVersion: 4n } },
    { ...after, supersession: { ...after.supersession!, position: { ...after.supersession!.position, transactionHash: position.transactionHash } } },
    { ...after, supersession: { ...after.supersession!, position: { ...after.supersession!.position, transactionIndex: 0n } } },
    { ...after, supersession: { ...after.supersession!, position: { ...after.supersession!.position, blockNumber: 11n } } },
    { ...after, attempt: { ...after.attempt, outcome: 'reverted' } },
    { ...after, attempt: { ...after.attempt, basisSource: 'prepared-observation' } },
  ];
  for (const input of variants) {
    const view = buildEscrowView(trade, observation, 100n, release, input);
    assert.equal(view.releaseOrdering.classification, 'unknown');
    const beforeRender = structuredClone(view), text = renderEscrow(view);
    assert.match(text, /Release ordering\s+unknown/);
    assert.doesNotMatch(text, /Release ordering\s+superseded-/);
    assert.deepEqual(view, beforeRender);
  }
  assert.equal(buildEscrowView(trade, observation, 100n, { ...release, position: { ...release.position!, transactionHash: h('6') } }, after).releaseOrdering.classification, 'unknown');
});

