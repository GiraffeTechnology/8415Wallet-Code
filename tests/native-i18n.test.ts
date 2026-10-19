import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAcquisition } from '../src/wallet/acquisition.ts';
import { describePosture } from '../src/wallet/posture.ts';
import { describeFinality } from '../src/wallet/finality.ts';
import { WalletSession } from '../src/wallet/session.ts';
import { divergentToken, cancelledGapToken, projectionOnlyToken, TOKEN, T } from '../src/adapters/memory/scenarios.ts';
import { renderAssetView } from '../src/wallet/renderAssetView.ts';
import { renderTemporalQuery, renderHistory } from '../src/wallet/renderTemporalQuery.ts';
import { renderRiskSurfaces, renderSettlementLog } from '../src/wallet/renderGapView.ts';
import { renderRegistration, renderAcquisitionDisclosure, renderPosture, renderCollisions, renderOwnershipHistory } from '../src/wallet/renderHolderViews.ts';
import { LOCALES, CATALOGS, renderUi, paint, setLocale, t } from '../web/i18n.mjs';
import { nativeUi, translateNative, settlementDisplay, clearingDisplay, clearingReviewDisplay } from '../web/native-i18n.mjs';

test('native renderer identity defaults preserve source English and localize cached views without new reads', async () => {
  for (const scenario of [divergentToken, cancelledGapToken, projectionOnlyToken]) {
    const { reader } = scenario(), session = new WalletSession(reader);
    const pairs: [any, any][] = [
      [renderAssetView, await session.assetView(TOKEN)],
      [renderTemporalQuery, await session.temporalQuery(TOKEN, T.finalInstant)],
      [renderTemporalQuery, await session.temporalQuery(TOKEN, T.beforeFirstEntry)],
      [renderHistory, await session.history(TOKEN)],
      [renderRegistration, await session.registration(TOKEN)],
      [renderAcquisitionDisclosure, await session.acquisitionDisclosure(TOKEN)],
      [renderRiskSurfaces, await session.riskSurfaces(TOKEN)],
      [renderPosture, await session.posture(TOKEN, T.finalInstant)],
      [renderSettlementLog, await session.settlementLog(TOKEN)],
      [renderOwnershipHistory, await session.ownershipHistory(TOKEN)],
      [renderCollisions, await session.collisions([TOKEN])],
    ];
    for (const [renderer, view] of pairs) {
      const original = structuredClone(view), expected = renderer(view), node = { textContent: '' };
      assert.equal(renderer(view, (text: string) => text), expected);
      assert.equal(renderUi(nativeUi(renderer, view), 'en'), expected);
      paint(node, nativeUi(renderer, view));
      for (const { id } of LOCALES) {
        setLocale(id, { persist: false });
        assert.equal(node.textContent, renderUi(nativeUi(renderer, view), id));
        if (id !== 'en') {
          assert.notEqual(node.textContent, expected, renderer.name);
          assert.doesNotMatch(node.textContent, /TRADEABLE POSITION|CONFIRMED HOLDER|RISK SURFACES|PROJECTION HISTORY|in force|zero — first entry|The position and the confirmed holder/);
        }
        assert.deepEqual(view, original);
      }
      paint(node, ''); setLocale('en', { persist: false });
    }
  }
});
test('native fields preserve opaque RPC reasons and exact chain facts', async () => {
  const session = new WalletSession(divergentToken().reader), view = await session.temporalQuery(TOKEN, T.finalInstant);
  const reason = 'The register is up to date <img src=x onerror=alert(1)> {v0}';
  const unavailable: any = { ...view, resolution: { kind: 'unavailable', reason, note: CATALOGS.en!['protocol.019'] } };
  for (const { id } of LOCALES) {
    const text = renderUi(nativeUi(renderTemporalQuery, unavailable), id);
    assert.ok(text.includes(reason)); assert.ok(text.includes(view.identity.address));
    assert.ok(text.includes(view.tradeablePosition.owner));
  }
});
test('known native captures stay literal and arbitrary source strings are not treated as catalogs', () => {
  const raw = '<b>{v1} 原碼</b>';
  assert.equal(translateNative(`It is asserted to track register ${raw}.`, 'zh-Hans'), `配置声称它跟踪登记簿 ${raw}。`);
  assert.equal(translateNative('Password', 'fr'), 'Password');
  const source = 'The register has until this time under the agreed window. Nothing is wrong while it has not passed.';
  for (const { id } of LOCALES) assert.equal(translateNative(source, id), t('protocol.062', {}, id));
});
test('settlement display localizes only trusted copy without changing digest, checks, parameters or original review', () => {
  const check = { name: 'proof validity', outcome: 'unverifiable', detail: CATALOGS.en!['protocol.329'] };
  const review = { digest: `0x${'1'.repeat(64)}`, parameters: { proofData: '0x1234', amount: 123456789012345678901234567890n },
    terms: { description: 'The register is up to date', name: 'Password' }, summary: 'Cancel settlement 0x1234, closing the gap without admitting anything.',
    preflight: { checks: [check], blocking: [], unverifiable: [check], consequences: [CATALOGS.en!['protocol.340']] } };
  const original = structuredClone(review);
  for (const { id } of LOCALES) {
    const display = JSON.parse(renderUi(settlementDisplay(review), id));
    assert.equal(display.digest, review.digest); assert.equal(display.parameters.amount, review.parameters.amount.toString());
    assert.deepEqual(display.terms, review.terms); assert.equal(display.preflight.checks[0].outcome, 'unverifiable');
    assert.equal(display.preflight.checks[0].detail, t('protocol.329', {}, id));
    assert.equal(display.preflight.consequences[0], t('protocol.340', {}, id));
    assert.deepEqual(review, original);
  }
});
test('clearing view display preserves state and original terms while translating first-party guidance', () => {
  const observation = { state: 'released', tokenName: 'The register is up to date', amount: '1000000000000000001',
    view: { headline: 'released to the buyer', meaning: CATALOGS.en!['protocol.280'], action: 'Nothing. The trade is done.', provisionalNote: CATALOGS.en!['protocol.267'] } };
  const original = structuredClone(observation);
  for (const { id } of LOCALES) {
    const display = JSON.parse(renderUi(clearingDisplay(observation), id));
    assert.equal(display.state, 'released'); assert.equal(display.tokenName, observation.tokenName); assert.equal(display.amount, observation.amount);
    assert.equal(display.view.headline, t('protocol.272', {}, id)); assert.deepEqual(observation, original);
  }
});

test('Clearing review guidance is localized without modifying canonical facts, raw terms or digest', () => {
  const facts = { approval: CATALOGS.en!['protocol.clearing.approval'], condition: CATALOGS.en!['protocol.clearing.condition'], holderRead: CATALOGS.en!['protocol.clearing.unavailable'], tokenDescription: 'Password', amount: '12345678901234567890' };
  const review = { facts: JSON.stringify(facts), digest: '0x1234', requestText: '{"description":"The register is up to date"}' };
  const original = structuredClone(review);
  for (const { id } of LOCALES) {
    const result = JSON.parse(renderUi(clearingReviewDisplay(review, CATALOGS.en!['clearing.notes']!), id));
    assert.equal(result.facts.approval, t('protocol.clearing.approval', {}, id));
    assert.equal(result.facts.condition, t('protocol.clearing.condition', {}, id));
    assert.equal(result.facts.holderRead, t('protocol.clearing.unavailable', {}, id));
    assert.equal(result.facts.tokenDescription, 'Password'); assert.equal(result.facts.amount, facts.amount);
    assert.equal(result.digest, review.digest); assert.equal(result.requestText, review.requestText); assert.deepEqual(review, original);
  }
});

test('closed intervals and first-entry/missing-opening fragments do not leak English UI prose', () => {
  const samples = ['in force  2026-01-01 00:00:00 UTC (1767225600)\n                until 2026-02-01 00:00:00 UTC (1769904000)', 'previous    zero — first entry', 'opened      not read'];
  for (const { id } of LOCALES.filter(locale => locale.id !== 'en')) {
    for (const text of samples) assert.doesNotMatch(translateNative(text, id), /in force|zero — first entry|not read/);
  }
});

test('repaired native protocol catalogs preserve opaque captures and localize each fixed template', () => {
  const keys = Object.keys(CATALOGS.en!).filter(key => /^protocol\.(acquisition\.|posture\.|present\.|finality\.|escrow\.holderUnavailable$)/.test(key)).concat(['protocol.011', 'protocol.012', 'protocol.028', 'protocol.086']);
  const parameters = { v0: '1700000000', v1: '1700000001', v2: 'false', v3: '1700000002' };
  for (const key of keys) {
    const source = t(key, parameters, 'en');
    for (const { id } of LOCALES) {
      assert.ok(Object.prototype.hasOwnProperty.call(CATALOGS[id], key), `${id}:${key}`);
      assert.equal(translateNative(source, id), t(key, parameters, id), `${id}:${key}`);
      for (const name of CATALOGS.en![key]!.match(/\{v[0-9]+\}/g) ?? []) {
        const value = parameters[name.slice(1, -1) as keyof typeof parameters];
        assert.ok(translateNative(source, id).includes(value), `${id}:${key}:${name}`);
      }
    }
  }
});

test('acquisition actual observed answers translate their first-party explanation but retain instants', async () => {
  const original = await new WalletSession(divergentToken().reader).assetView(TOKEN);
  for (const final of [true, false]) {
    const explanationKey = final ? 'protocol.present.final' : 'protocol.012';
    const values = final ? { v0: '1700000030', v1: '1700000020', v2: '1700000010' } : { v0: '1700000010' };
    const view = { ...original, presentFinality: { ...original.presentFinality, instant: original.observedAt, final, explanation: t(explanationKey, values, 'en') } };
    const before = structuredClone(view), result = describeAcquisition(view, view.observedAt);
    const key = final ? 'protocol.acquisition.observedFinal' : 'protocol.acquisition.observedNotFinal';
    assert.equal(result.points[1], t(key, { v0: String(view.observedAt), v1: view.presentFinality.explanation }, 'en'));
    for (const { id } of LOCALES) assert.equal(translateNative(result.points[1]!, id), t(key, { v0: String(view.observedAt), v1: t(explanationKey, values, id) }, id));
    const later = describeAcquisition(view, view.observedAt + 1n);
    for (const { id } of LOCALES) assert.equal(translateNative(later.points[1]!, id), t('protocol.acquisition.unobserved', { v0: String(view.observedAt + 1n) }, id));
    assert.deepEqual(view, before);
  }
});

test('actual unavailable uncovered and inconsistent posture prose uses the new native mappings', () => {
  const inputs = [
    { reported: undefined, firstEffectiveAt: undefined, latestEffectiveAt: undefined },
    { reported: false, firstEffectiveAt: 20n, latestEffectiveAt: 30n },
    { reported: false, firstEffectiveAt: undefined, latestEffectiveAt: 30n },
    { reported: true, firstEffectiveAt: undefined, latestEffectiveAt: 30n },
    { reported: false, firstEffectiveAt: 30n, latestEffectiveAt: 20n },
    { reported: true, firstEffectiveAt: 30n, latestEffectiveAt: 20n },
    { reported: true, firstEffectiveAt: 20n, latestEffectiveAt: 30n },
    { reported: false, firstEffectiveAt: 0n, latestEffectiveAt: 30n },
    { reported: true, firstEffectiveAt: 0n, latestEffectiveAt: 10n },
  ];
  for (const input of inputs) {
    const finality = describeFinality({ tokenId: TOKEN, instant: 10n, ...input });
    const freshness: any = { display: 'current', label: 'Current', explanation: 'Known feed text' };
    const posture = describePosture(finality, freshness), before = structuredClone(posture);
    for (const { id } of LOCALES.filter(locale => locale.id !== 'en')) {
      assert.notEqual(translateNative(posture.label, id), posture.label);
      assert.notEqual(translateNative(posture.explanation, id), posture.explanation);
      assert.notEqual(translateNative(posture.referencePattern, id), posture.referencePattern);
      const projection = translateNative(posture.projection, id);
      assert.equal(projection, `${translateNative(finality.label, id)} — ${translateNative(finality.explanation, id)}`);
      assert.notEqual(translateNative(finality.explanation, id), finality.explanation);
    }
    assert.deepEqual(posture, before);
  }
});

test('escrow zero-sentinel prose is localized without claiming a missing holder', () => {
  const source = 'unavailable or no record — not distinguished by this observation';
  for (const { id } of LOCALES) assert.equal(translateNative(source, id), t('protocol.escrow.holderUnavailable', {}, id));
});
