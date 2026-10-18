import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WalletSession } from '../src/wallet/session.ts';
import { divergentToken, TOKEN, T } from '../src/adapters/memory/scenarios.ts';
import { renderAssetView } from '../src/wallet/renderAssetView.ts';
import { renderTemporalQuery, renderHistory } from '../src/wallet/renderTemporalQuery.ts';
import { renderSettlementLog } from '../src/wallet/renderGapView.ts';
import { renderRegistration, renderAcquisitionDisclosure, renderOwnershipHistory } from '../src/wallet/renderHolderViews.ts';
import { LOCALES, paint, renderUi, setLocale, msg, t } from '../web/i18n.mjs';
import { readOnlyText } from '../web/readonly-i18n.mjs';
import { mountAuditExport } from '../web/audit-export-panel.mjs';
import { harness, fakeLogin } from './helpers/readonly-panel-harness.mjs';
import { privateReadProjection, privateNativeSummary, privateNativeUi, privateAuditDownload,
  walletIdentityState, walletIdentityText, walletIdentityDisplay, privateReadDisplay } from '../web/wallet-identity-display.mjs';

const self = '0x' + 'a1'.repeat(20), adjacent = '0x' + 'b2'.repeat(20), contract = '0x' + 'c3'.repeat(20);
// Use an unrelated hash prefix: a substring assertion must not mistake a
// preserved 32-byte commitment for the 20-byte adjacent-wallet fixture.
const hash = '0x' + 'd4'.repeat(32);

test('identity states do not infer occurrence numbers or admit arbitrary wallet labels', () => {
  assert.equal(walletIdentityState(self.toUpperCase().replace('0X', '0x'), self), 'own');
  assert.equal(walletIdentityState(adjacent, self), 'hidden');
  for (const value of [null, 'Alice', '<img src=x>', '0x' + '0'.repeat(40)]) assert.equal(walletIdentityState(value, self), 'unavailable');
  assert.equal(walletIdentityState(adjacent, null), 'unavailable');
});

test('read-only copies redact wallet fields and prose while retaining asset identity, hashes, values and source facts', () => {
  const raw = { source: { chainId: 1n, contract }, tokenId: 9007199254740993n,
    tradeablePosition: { owner: adjacent }, confirmedHolder: { holder: self },
    gap: { expectedHolder: adjacent, initiator: self, deadline: 42n },
    history: [{ from: adjacent, to: self, holder: adjacent, commitment: hash }],
    payment: { payer: self, payee: adjacent, amount: 120000000000000000001n },
    walletName: 'Private preceding wallet', tooltip: adjacent, 'aria-label': adjacent,
    notes: [`The register confirms ${adjacent}. Asset ${contract}; commitment ${hash}.`],
    metadata: { name: 'Asset title', description: 'Public asset metadata', image: '/assets/grid.svg' },
    alignment: { aligned: false }, finality: { final: false }, frozen: true };
  const before = structuredClone(raw), safe = privateReadProjection(raw, self);
  const json = JSON.stringify(safe, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  assert.ok(!json.includes(adjacent)); assert.ok(!json.includes(self)); assert.ok(!json.includes('Private preceding wallet'));
  assert.equal(safe.source.contract, contract); assert.equal(safe.history[0].commitment, hash);
  assert.equal(safe.payment.amount, raw.payment.amount); assert.equal(safe.tokenId, raw.tokenId);
  assert.deepEqual(safe.metadata, raw.metadata); assert.deepEqual(safe.alignment, raw.alignment);
  assert.deepEqual(safe.finality, raw.finality); assert.equal(safe.frozen, true); assert.deepEqual(raw, before);
});

test('native event whitelist contains neither identities nor injected DOM/tooltip/aria properties', () => {
  const view = { tokenId: 7n, observedAt: 9n, tradeablePosition: { owner: adjacent, tooltip: adjacent },
    confirmedHolder: { holder: self, version: 3n, 'aria-label': adjacent },
    presentFinality: { final: false, agreement: 'consistent', owner: adjacent },
    gap: { kind: 'open', openedAt: 8n, expectedHolder: adjacent, initiator: self },
    hiddenDom: adjacent, walletName: 'Private wallet', metadata: { owner: adjacent } };
  const event = privateNativeSummary(view, self), json = JSON.stringify(event);
  assert.equal(event.schema, '8415-native-summary/1'); assert.equal(event.tradeablePosition.owner, 'hidden');
  assert.equal(event.confirmedHolder.holder, 'own'); assert.equal(event.gap.openedAt, '8');
  assert.equal(event.presentFinality.final, false);
  for (const forbidden of [adjacent, self, 'tooltip', 'aria-label', 'hiddenDom', 'Private wallet', 'metadata']) assert.ok(!json.includes(forbidden));
});

test('metadata, unknown fields and contract-address collisions cannot exempt a wallet identity', () => {
  const raw = { identity: { address: adjacent }, source: { contract: adjacent },
    tradeablePosition: { owner: adjacent }, note: `The holder is ${adjacent}.`,
    metadata: { name: 'Ordinary NFT title', owner: adjacent, holder: adjacent, walletName: 'Private neighbor',
      description: `Owner ${adjacent}`, asset: { contract: adjacent } },
    unknownField: adjacent, unknown: { contract: adjacent } };
  const safe = privateReadProjection(raw, self);
  assert.equal(safe.identity.address, adjacent); assert.equal(safe.source.contract, adjacent);
  assert.equal(safe.metadata.name, 'Ordinary NFT title');
  for (const item of [safe.tradeablePosition, safe.note, safe.metadata, safe.unknownField, safe.unknown]) {
    assert.ok(!JSON.stringify(item).includes(adjacent)); assert.ok(!JSON.stringify(item).includes('Private neighbor'));
  }
  assert.equal(raw.metadata.owner, adjacent); assert.equal(raw.note, `The holder is ${adjacent}.`);
});

test('uppercase address text and address-keyed metadata cannot leak or collide into renamed keys', () => {
  const uppercase = adjacent.toUpperCase();
  const raw = { source: { contract }, notes: [`Owner ${uppercase}`, `prefix_${uppercase}`],
    metadata: { [adjacent]: 'First value', [uppercase]: 'Second value', name: 'Hidden with this ambiguous map' },
    extra: { items: [{ [`owner_${uppercase}`]: 'Private identity key', name: 'Private map' }] },
    other: { title: 'Ordinary asset title', commitment: hash.toUpperCase() } };
  const before = structuredClone(raw), safe = privateReadProjection(raw, self);
  assert.equal(safe.metadata, '[wallet:identity-hidden]', 'suppress the affected map instead of renaming colliding keys');
  assert.equal(safe.extra.items[0], '[wallet:identity-hidden]');
  assert.equal(safe.source.contract, contract); assert.deepEqual(safe.other, raw.other);
  for (const forbidden of [adjacent, uppercase, 'First value', 'Second value', 'Private identity key']) {
    assert.ok(!JSON.stringify(safe).includes(forbidden));
    assert.ok(!renderUi(privateReadDisplay(raw, self), 'en').includes(forbidden));
  }
  assert.deepEqual(raw, before);
});

test('all mounted native read renderers receive redacted copies; original SDK facts remain unchanged', async () => {
  const session = new WalletSession(divergentToken().reader);
  const pairs: [any, any][] = [
    [renderAssetView, await session.assetView(TOKEN)],
    [renderTemporalQuery, await session.temporalQuery(TOKEN, T.finalInstant)],
    [renderHistory, await session.history(TOKEN)],
    [renderRegistration, await session.registration(TOKEN)],
    [renderAcquisitionDisclosure, await session.acquisitionDisclosure(TOKEN)],
    [renderSettlementLog, await session.settlementLog(TOKEN)],
    [renderOwnershipHistory, await session.ownershipHistory(TOKEN)],
  ];
  for (const [renderer, view] of pairs) {
    const before = structuredClone(view);
    for (const { id } of LOCALES) {
      const rendered = renderUi(privateNativeUi(renderer, view, self), id);
      // Any displayed address must be the exact asset contract, never a wallet.
      const allowed = new Set([view.identity?.address].filter(Boolean));
      for (const match of rendered.matchAll(/\b0x[0-9a-fA-F]{40}\b/g)) assert.ok(allowed.has(match[0]), renderer.name);
      assert.ok(!rendered.includes('[wallet:'));
    }
    assert.deepEqual(view, before);
  }
});

test('six locale changes retain only a non-identifying state in cached presentation', () => {
  const node = { textContent: '', removeAttribute() {} };
  paint(node, walletIdentityDisplay(adjacent, self));
  for (const { id } of LOCALES) {
    setLocale(id, { persist: false }); assert.equal(node.textContent, walletIdentityText('hidden', id));
    assert.ok(!node.textContent.includes(adjacent)); assert.ok(!node.textContent.includes(self));
  }
  paint(node, ''); setLocale('en', { persist: false }); assert.equal(node.textContent, '');
});

test('read output and its localized disclosure share one presentation without opaque serialization', () => {
  const output = privateReadDisplay({ source: { contract }, holder: adjacent, amount: 123n }, self, msg('message.012'));
  for (const { id } of LOCALES) {
    const text = renderUi(output, id);
    assert.ok(text.includes(contract)); assert.ok(text.includes('123')); assert.ok(text.includes(t('message.012', {}, id)));
    assert.ok(!text.includes(adjacent)); assert.ok(!text.includes('[object Object]'));
  }
});

test('human audit download carries explicit display provenance and no adjacent wallet identity', () => {
  const original = { schema: 'erc8415-wallet-audit/1', source: { contract }, tokenId: '7',
    tradeablePosition: { owner: adjacent }, entries: [{ holder: self, version: '3' }],
    settlementLog: { episodes: [{ expectedHolder: adjacent, initiator: self }] } };
  const input = { json: JSON.stringify(original), filename: 'erc8415-audit-7.json', gapsAvailable: true };
  const safe = privateAuditDownload(input, self), value = JSON.parse(safe.json);
  assert.equal(value.schema, '8415-wallet-private-audit-view/1'); assert.equal(value.sourceSchema, original.schema);
  assert.equal(value.view.source.contract, contract); assert.equal(safe.filename, 'erc8415-private-audit-7.json');
  assert.ok(!safe.json.includes(adjacent)); assert.ok(!safe.json.includes(self)); assert.equal(input.json, JSON.stringify(original));
});

test('audit download completion and subsequent locale changes retain the privacy disclosure and clear cached preview', async () => {
  setLocale('en', { persist: false });
  const h = harness(), login = fakeLogin({ account: self, chainId: '1' });
  const trail = { schema: 'erc8415-wallet-audit/1', exportedAt: '2026-10-18T00:00:00.000Z',
    source: { chainId: '1', contract, registerId: hash, verificationProfile: null },
    tokenId: '1', observedAt: '9', tradeablePosition: { owner: adjacent },
    entries: [{ version: '1', holder: self, effectiveAt: '1', supersededAt: '0',
      recordCommitment: hash, previousCommitment: hash, registryReference: hash, linkFaults: [] }],
    chainIntact: true, settlementLog: { available: false, episodes: [], events: [] }, notes: [] };
  h.context.wallet = { reader: { source: { chainId: 1n, address: contract }, entryCount: async () => 1n },
    assetView: async () => {}, auditTrail: async () => structuredClone(trail) };
  const handle = mountAuditExport({ root: h.root, login, getContext: () => h.context, document: h.document, window: h.window });
  const [, , read, save, status, preview] = h.host.children[0].children;
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  try {
    read.click(); await flush(); assert.equal(save.disabled, false);
    save.click(); await flush();
    for (const { id } of LOCALES) {
      setLocale(id, { persist: false });
      assert.equal(status.textContent, readOnlyText('audit.download', id) + ' ' + walletIdentityText('audit', id));
      assert.equal(JSON.parse(preview.textContent).disclosure, walletIdentityText('audit', id));
      assert.ok(!preview.textContent.includes('[wallet:')); assert.ok(!preview.textContent.includes(adjacent));
      assert.ok(!preview.textContent.includes(self));
    }
    handle?.clear(); setLocale('en', { persist: false });
    assert.equal(status.textContent, ''); assert.equal(preview.textContent, ''); assert.equal(save.disabled, true);
  } finally { handle?.clear(); setLocale('en', { persist: false }); }
});

test('actual mount routes projection before event, textual read output, cached workspace and human download', () => {
  const read = (path: string) => readFileSync(new URL('../web/' + path, import.meta.url), 'utf8');
  const app = read('app.mjs'), shell = read('wallet-shell.mjs'), workspace = read('asset-workspace-panel.mjs'), audit = read('audit-export-panel.mjs');
  assert.match(app, /view: state === 'ready' \? privateNativeSummary/);
  assert.match(app, /case 'asset':[\s\S]*?output = privateNative\(renderAssetView/);
  assert.doesNotMatch(app, /output = nativeUi\(/);
  assert.match(app, /privateDisplay\(\{ responsibility: observed.snapshot/);
  assert.match(shell, /walletIdentityStateDisplay\(view.tradeablePosition.owner\)/);
  assert.match(shell, /walletIdentityStateDisplay\(view.confirmedHolder.holder\)/);
  assert.match(workspace, /report = privateReadProjection\(result, authenticated.account\)/);
  assert.match(audit, /result = privateAuditDownload\(value, login.assert\(binding\).account\)/);
  // Transaction confirmation continues to use the exact original review fields.
  assert.match(shell, /value.recipient/); assert.match(shell, /value.transaction.from/);
  assert.match(shell, /session \? session.account/);
});
