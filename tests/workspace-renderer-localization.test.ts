import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAssetWorkspace as standalone } from '../src/standalone/renderAssetWorkspace.ts';
import { renderAssetWorkspace as unified } from '../src/wallet/renderAssetWorkspace.ts';
// @ts-ignore JavaScript presentation catalog.
import { workspaceNarrative } from '../web/locales/workspace.mjs';
const opaque = 'opaque-registry\nAsset workspace — READ ONLY, not transaction authority';
const no = { state: 'not-requested' } as const;
const view: any = {
 source: { chainId: 1n, contract: '0xCONTRACT', tokenId: 9n }, instant: 123n,
 asset: no, temporal: no, ownershipHistory: no, settlementLog: no, linked: no,
 registerHistory: { state: 'ready', value: { startVersion: 1n, totalEntries: 1n, nextVersion: null, readSemantics: 'OPAQUE_SEMANTICS', entries: [{ version: 1n, holder: 'RAW_HOLDER', effectiveAt: 1n, supersededAt: 2n, recordCommitment: 'RAW_HASH', previousCommitment: 'RAW_PREV', registryReference: opaque }] } },
 notes: ['Standalone and linked observations keep their own read semantics; this workspace is not an atomic execution snapshot.', 'RAW_NOTE'], paymentMode: 'not-configured', payments: [],
};
for (const render of [standalone, unified]) {
 test(`${render === standalone ? 'standalone' : 'unified'} wrapper translations keep raw values outside callback`, () => {
  const english = render(view, 'register-history');
  assert.equal(english, render(view, 'register-history', text => text));
  for (const language of Object.keys(workspaceNarrative)) {
   const visited: string[] = [];
   const output = render(view, 'register-history', text => { visited.push(text); assert.ok(Object.hasOwn(workspaceNarrative.en, text), text); return workspaceNarrative[language][text]; });
   for (const raw of [opaque, 'RAW_HOLDER', 'RAW_HASH', 'RAW_PREV', 'RAW_NOTE', 'OPAQUE_SEMANTICS', '0xCONTRACT']) { assert.ok(output.includes(raw)); assert.ok(!visited.includes(raw)); }
   assert.ok(output.includes(workspaceNarrative[language]['Requested instant: ']));
   const unavailable = render({ ...view, asset: { state: 'unavailable', reason: 'RAW_REASON' } }, 'asset', text => workspaceNarrative[language][text]);
   assert.ok(unavailable.includes('RAW_REASON'));
  }
 });
}

test('linked fixed templates translate once while protocol codes and hostile parameters remain literal', async () => {
 const { renderLinkedChain } = await import('../src/wallet/renderLinkedChain.ts');
 const raw = 'final {count} <script>'; const linked: any = {
  asset: { chainId: 1n, contract: raw, tokenId: 3n }, sequenceId: raw, revision: 2n,
  blockNumber: 4n, blockHash: raw, evidenceStatus: raw, protocolFinality: false,
  legs: [{ id: raw, seller: raw, buyer: raw, outcome: raw, completionPredicate: true, control: { controlId: raw, acceptanceHash: raw } }],
  detachedLegIds: [], offChainDetached: 5n, detachedCommitment: raw, completionPrefix: [], returnBoundary: { account: raw, occurrenceId: raw }, note: 'RAW_NOTE',
 };
 const english = renderLinkedChain(linked);
 assert.ok(english.includes('Detached and held off chain: 5 (records at the register; commitment '+raw+')'));
 for (const language of Object.keys(workspaceNarrative)) {
  const seen: string[] = [];
  const format = (template: string, values: Readonly<Record<string,string>> = {}) => {
   seen.push(template); assert.ok(Object.hasOwn(workspaceNarrative.en, template), template);
   return workspaceNarrative[language][template].replace(/\{([a-z]+)\}/g, (match: string, key: string) => values[key] ?? match);
  };
  const output = renderLinkedChain(linked, format);
  assert.ok(output.includes(raw)); assert.ok(output.includes('RAW_NOTE')); assert.ok(!seen.includes(raw));
  assert.ok(output.includes(workspaceNarrative[language].provisional));
  if (language === 'en') assert.equal(output, english);
  assert.equal(renderLinkedChain({ ...linked, protocolFinality: null }, format).includes(workspaceNarrative[language].unavailable), true);
 }
});

test('workspace forwards the explicit native formatter to the nested read-only renderer', async () => {
 // @ts-ignore JavaScript presentation adapter.
 const { rendererMessages } = await import('../web/renderer-messages.mjs');
 // @ts-ignore JavaScript presentation catalog.
 const { t } = await import('../web/i18n.mjs');
 for (const render of [standalone, unified]) for (const language of Object.keys(workspaceNarrative)) {
  const format = rendererMessages(language);
  const result = render({ ...view, settlementLog: { state: 'ready', value: { tokenId: 9n, available: false, note: 'RAW_EXTERNAL_NOTE' } } }, 'dual-history', text => workspaceNarrative[language][text], format);
  assert.ok(result.includes(t('protocol.222', { v0: '9' }, language)));
  assert.ok(result.includes('RAW_EXTERNAL_NOTE'));
 }
});
