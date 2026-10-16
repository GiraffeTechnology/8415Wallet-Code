import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../web/locales/readonly-panels.mjs';
import { readOnlyText, readOnlyMessage, readOnlyLabel, readOnlyPaint } from '../web/readonly-i18n.mjs';
import { paint, renderUi, setLocale } from '../web/i18n.mjs';

const locales = ['en', 'zh-Hans', 'zh-Hant', 'fr', 'es', 'ja'];
const emptyDocument = { querySelectorAll: () => [] };
class Element {
  children = []; isConnected = true; value = ''; content = '';
  append(child) { this.children.push(child); }
  set textContent(value) { this.children = []; this.content = value; }
  get textContent() { return this.content; }
  removeAttribute() {}
}
test('six complete fixed catalogs with exact key parity', () => {
  assert.deepEqual(Object.keys(catalog).sort(), [...locales].sort());
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalog[locale]).sort(), Object.keys(catalog.en).sort());
    for (const text of Object.values(catalog[locale])) assert.ok(typeof text === 'string' && text.length > 0);
  }
});
test('fixed messages use existing presentation binding in all six languages', () => {
  const message = readOnlyMessage('wt.title');
  for (const locale of locales) assert.equal(renderUi(message, locale), catalog[locale]['wt.title']);
  assert.equal(readOnlyText('wt.title', 'invalid'), catalog.en['wt.title']);
  assert.throws(() => readOnlyMessage('not-a-key'));
});
test('label repaint preserves the exact input node and entered value', () => {
  setLocale('en', { document: emptyDocument, persist: false });
  const document = { createElement: () => new Element() }, label = new Element(), input = new Element();
  input.value = '0x123 {wt.title}';
  const text = readOnlyLabel(label, 'kit.path', document); label.append(input);
  setLocale('ja', { document: emptyDocument, persist: false });
  assert.deepEqual(label.children, [text, input]); assert.equal(input.value, '0x123 {wt.title}');
  assert.equal(text.textContent, catalog.ja['kit.path']);
  paint(text, ''); setLocale('en', { document: emptyDocument, persist: false });
});
test('cleared status is not restored by later locale changes', () => {
  const status = new Element(); readOnlyPaint(status, 'wt.ok'); paint(status, '');
  for (const locale of locales) {
    setLocale(locale, { document: emptyDocument, persist: false }); assert.equal(status.textContent, '');
  }
  setLocale('en', { document: emptyDocument, persist: false });
});
test('protocol fields and metadata-like strings remain exact literal text', () => {
  const values = ['FRESH_FINAL', 'UNVERIFIED_CONFIGURATION', '0x' + 'a'.repeat(64), '9007199254740993', '<img src=x>{wt.title}', catalog.en['wt.title']];
  for (const language of locales) for (const value of values) assert.equal(renderUi(value, language), value);
});
test('selector repaint changes only bound text, not read buttons or consent inputs', () => {
  const button = new Element(), consent = { checked: true, value: 'original' };
  button.disabled = true; readOnlyPaint(button, 'kit.read');
  for (const locale of locales) setLocale(locale, { document: emptyDocument, persist: false });
  assert.equal(button.disabled, true); assert.deepEqual(consent, { checked: true, value: 'original' });
  paint(button, ''); setLocale('en', { document: emptyDocument, persist: false });
});
