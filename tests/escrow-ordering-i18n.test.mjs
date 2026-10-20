import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, renderUi, paint, setLocale, jsonUi } from '../web/i18n.mjs';
import { clearingDisplay } from '../web/native-i18n.mjs';
import { escrowOrderingDisplay } from '../web/escrow-ordering-i18n.mjs';

const sourceNotes = [
  'No independently bound transaction-position evidence; current or block-end observations do not establish release ordering.',
  'No corroborated successor in the release block. This is not proof that no later admission exists.',
  'Conflicting or incomplete source/entry/position evidence; no before/after conclusion.',
  'Same-transaction ordering is not established by this product path; log order alone is insufficient.',
  'The old prepared basis was superseded before the reverted release attempt. No successful release or execution-time entry read is inferred.',
  'The receipt-pinned release basis was superseded by a later transaction in the same block. The release anchor is retained; block-end state is a separate fact.',
  'Receipt outcome and ordering do not establish a supported before/after release classification.',
];

test('six-locale clearing presentation preserves raw classification, receipt positions, commitments and source object', () => {
  for (const classification of ['superseded-after-release', 'superseded-before-release-attempt', 'unknown']) {
    for (const note of sourceNotes) {
      const input = { view: { headline: 'released to the buyer', meaning: 'A literal provider value', action: 'Nothing. The trade is done.',
        releaseOrdering: { classification, note, evidence: { attempt: { position: { blockNumber: 3847831n, transactionIndex: 20n,
          blockHash: `0x${'4'.repeat(64)}`, transactionHash: `0x${'5'.repeat(64)}` }, basisCommitment: `0x${'6'.repeat(64)}` } } } } };
      const before = structuredClone(input);
      for (const { id } of LOCALES) {
        const view = JSON.parse(renderUi(clearingDisplay(input), id)).view;
        assert.equal(view.releaseOrdering.classification, classification);
        assert.deepEqual(view.releaseOrdering.evidence, JSON.parse(JSON.stringify(input.view.releaseOrdering.evidence,
          (_key, value) => typeof value === 'bigint' ? value.toString() : value)));
        assert.equal(view.meaning, input.view.meaning);
        assert.ok(view.releaseOrdering.classificationLabel);
        if (id === 'en') assert.equal(view.releaseOrdering.note, note);
        else assert.notEqual(view.releaseOrdering.note, note, `${id} must localize the exact first-party note`);
        assert.deepEqual(input, before);
      }
    }
  }
});

test('cached presentation repaints locale without touching evidence or invoking a provider', () => {
  const input = { classification: 'unknown', note: sourceNotes[3], evidence: { transactionHash: `0x${'7'.repeat(64)}` } };
  const before = structuredClone(input), node = { textContent: '' };
  try {
    paint(node, jsonUi(escrowOrderingDisplay(input)));
    for (const { id } of LOCALES) {
      setLocale(id, { persist: false });
      assert.equal(JSON.parse(node.textContent).evidence.transactionHash, input.evidence.transactionHash);
      assert.deepEqual(input, before);
    }
  } finally { paint(node, ''); setLocale('en', { persist: false }); }
});

test('arbitrary provider notes and unknown enum values remain opaque', () => {
  const input = { classification: '<img src=x>', note: 'The register is up to date <img src=x> {v0}', evidence: { raw: 'Superseded after release' } };
  for (const { id } of LOCALES) assert.deepEqual(JSON.parse(renderUi(jsonUi(escrowOrderingDisplay(input)), id)), input);
  assert.equal(escrowOrderingDisplay(undefined), undefined);
  assert.equal(escrowOrderingDisplay(null), null);
});
