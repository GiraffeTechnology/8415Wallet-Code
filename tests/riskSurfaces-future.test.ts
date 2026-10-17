import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryErc8415Reader } from '../src/adapters/memory/memoryReader.ts';
import { divergentToken, TOKEN } from '../src/adapters/memory/scenarios.ts';
import type { RegisterEntry, TokenId } from '../src/sdk/types.ts';
import { buildRiskSurfaces } from '../src/wallet/riskSurfaces.ts';
import { LOCALES, t } from '../web/i18n.mjs';
import { translateNative } from '../web/native-i18n.mjs';
import nativeSource from '../web/locales/native-en.mjs';

/**
 * Wording the rule withdrew, in each language that carried it. A stalled
 * register leaves recent instants non-final while it stays stopped, which a
 * genuine later entry ends; none of this is permanent, and no clock does it.
 */
const WITHDRAWN = [
  /permanently non-final/i, /永久(保持)?非最终/, /永久(保持)?非最終/,
  /indéfiniment non définitifs/i, /permanentemente no definitivos/i, /永久に未確定/,
];
/** A block that lifts by itself, which is what registration is required for. */
const SELF_LIFTING = [
  /the block lifts as the chain clock advances/i, /该限制会解除/, /該限制會解除/,
  /le blocage se lève à mesure/i, /el bloqueo se levanta a medida/i, /制約は解けます/,
];

// A display fixture only, not an admitted on-chain entry or protocol acceptance.
class EffectiveTimeFixture extends MemoryErc8415Reader {
  offset = 400n * 24n * 60n * 60n;
  override async currentEntry(tokenId: TokenId): Promise<RegisterEntry> {
    return { ...await super.currentEntry(tokenId), effectiveAt: await this.chainInstant() + this.offset };
  }
}
test('future effective time is not described as negative elapsed time or terminal by itself', async () => {
  const reader = new EffectiveTimeFixture(divergentToken().contract);
  const view = await buildRiskSurfaces(reader, TOKEN);
  const standing = view.surfaces.find((surface) => surface.id === 'stalled-register');
  const future = view.surfaces.find((surface) => surface.id === 'far-future-effective-time');
  assert.ok(standing);
  assert.ok(future);
  assert.equal(standing.present, false);
  assert.match(standing.finding, /ahead of now; no elapsed standing time/);
  assert.doesNotMatch(standing.finding, /-\d+ seconds have passed/);
  assert.equal(future.present, true);
  assert.match(future.meaning, /does not by itself prove/);
  assert.doesNotMatch(future.meaning, /permanently ends the projection/);
  assert.match(future.meaning, /uint64 maximum/);
});
test('past effective time retains an elapsed standing measurement', async () => {
  const reader = new EffectiveTimeFixture(divergentToken().contract);
  reader.offset = -60n;
  const view = await buildRiskSurfaces(reader, TOKEN);
  const standing = view.surfaces.find((surface) => surface.id === 'stalled-register');
  const future = view.surfaces.find((surface) => surface.id === 'far-future-effective-time');
  assert.ok(standing);
  assert.ok(future);
  assert.equal(standing.present, true);
  assert.match(standing.finding, /60 seconds have passed/);
  assert.equal(future.present, false);
});

test('the stalled register is non-final while it stays stopped, and no clock ends that', async () => {
  const reader = new EffectiveTimeFixture(divergentToken().contract);
  reader.offset = -60n;
  const view = await buildRiskSurfaces(reader, TOKEN);
  const standing = view.surfaces.find((surface) => surface.id === 'stalled-register');
  assert.ok(standing);
  for (const claim of WITHDRAWN) assert.doesNotMatch(standing.meaning, claim);
  assert.match(standing.meaning, /for as long as it stays stopped/);
  assert.match(standing.meaning, /once registered, makes them final/);
  assert.match(standing.meaning, /clock running on does not do it/);
  assert.match(standing.meaning, /liveness dependency/);
});

test('each locale translates that wording, and none of them restores the withdrawn claim', async () => {
  const reader = new EffectiveTimeFixture(divergentToken().contract);
  reader.offset = -60n;
  const view = await buildRiskSurfaces(reader, TOKEN);
  const standing = view.surfaces.find((surface) => surface.id === 'stalled-register');
  assert.ok(standing);
  const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
  // The catalog's English is what the translator matches the rendered line
  // against, so a drift here silently leaves the other five in English.
  const catalogEnglish = nativeSource['protocol.109'];
  assert.ok(catalogEnglish, 'the catalog must carry the source English');
  assert.equal(collapse(catalogEnglish), collapse(standing.meaning));
  for (const { id } of LOCALES) {
    const translated = translateNative(standing.meaning, id);
    assert.equal(collapse(translated), collapse(t('protocol.109', {}, id)), id);
    if (id !== 'en') {
      assert.notEqual(collapse(translated), collapse(standing.meaning), id);
    }
    for (const claim of WITHDRAWN) assert.doesNotMatch(translated, claim, id);
  }
});

test('no locale describes the future-effective block as lifting on its own', () => {
  const registration = {
    en: /only an entry that is actually registered does/i,
    'zh-Hans': /只有真实完成登记的记录才会被接纳/,
    'zh-Hant': /只有真實完成登記的記錄才會被接納/,
    fr: /seule une inscription réellement enregistrée le fait/i,
    es: /solo lo hace un registro realmente inscrito/i,
    ja: /実際に登録されたエントリーだけが受け入れられます/,
  } as Record<string, RegExp>;
  for (const { id } of LOCALES) {
    const text = t('protocol.126', {}, id);
    for (const lifting of SELF_LIFTING) assert.doesNotMatch(text, lifting, id);
    const required = registration[id];
    assert.ok(required, `no registration wording pinned for ${id}`);
    assert.match(text, required, id);
  }
});
