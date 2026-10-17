import assert from 'node:assert/strict';
import { test } from 'node:test';
import catalog from '../web/locales/trading-observation.mjs';
import { readOnlyText, readOnlyPaint } from '../web/readonly-i18n.mjs';
import { paint, setLocale } from '../web/i18n.mjs';
const languages = ['en', 'zh-Hans', 'zh-Hant', 'fr', 'es', 'ja'];
const keys = ['trade.projection-final-feed-fresh', 'trade.projection-provisional-feed-fresh',
  'trade.feed-not-current', 'trade.insufficient-observation', 'trade.caveat'];
test('all six locales contain the same five fixed observation messages', () => {
  assert.deepEqual(Object.keys(catalog).sort(), [...languages].sort());
  for (const language of languages) {
    assert.ok(Object.isFrozen(catalog[language]));
    assert.deepEqual(Object.keys(catalog[language]).sort(), [...keys].sort());
    for (const key of keys) {
      assert.equal(readOnlyText(key, language), catalog[language][key]);
      assert.ok(catalog[language][key].length > 20);
    }
  }
});
test('unknown locale falls back to English, unknown message is refused', () => {
  assert.equal(readOnlyText('trade.caveat', 'missing'), catalog.en['trade.caveat']);
  assert.throws(() => readOnlyText('trade.imported-approved'), /READONLY_MESSAGE_UNKNOWN/);
});
test('locale repaint updates a fixed observation and does not restore cleared content', () => {
  const node = { textContent: '', isConnected: true, removeAttribute() {} };
  try {
    setLocale('en', { document: {}, persist: false });
    readOnlyPaint(node, 'trade.feed-not-current');
    assert.equal(node.textContent, catalog.en['trade.feed-not-current']);
    setLocale('ja', { document: {}, persist: false });
    assert.equal(node.textContent, catalog.ja['trade.feed-not-current']);
    paint(node, '');
    setLocale('fr', { document: {}, persist: false });
    assert.equal(node.textContent, '');
  } finally {
    paint(node, '');
    setLocale('en', { document: {}, persist: false });
  }
});
