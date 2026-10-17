import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../web/locales/custody-panels.mjs';
import original from '../web/locales/readonly-panels.mjs';
import { readOnlyText, readOnlyMessage, readOnlyPaint, readOnlyLabel } from '../web/readonly-i18n.mjs';
import { paint, renderUi, setLocale } from '../web/i18n.mjs';

const languages = ['en', 'zh-Hans', 'zh-Hant', 'fr', 'es', 'ja'];
const emptyDocument = { querySelectorAll: () => [] };
class Element {
  children = []; isConnected = true; value = ''; content = '';
  append(node) { this.children.push(node); }
  set textContent(value) { this.children = []; this.content = value; }
  get textContent() { return this.content; }
  removeAttribute() {}
}
test('custody keys and nonempty translations match across all six languages', () => {
  assert.deepEqual(Object.keys(catalog).sort(), [...languages].sort());
  for (const language of languages) {
    assert.deepEqual(Object.keys(catalog[language]).sort(), Object.keys(catalog.en).sort());
    for (const value of Object.values(catalog[language])) assert.ok(typeof value === 'string' && value.length > 0);
    for (const key of Object.keys(catalog[language])) assert.equal(readOnlyText(key, language), catalog[language][key]);
  }
});
test('existing watchtower and Kit labels remain unchanged', () => {
  for (const language of languages) for (const key of Object.keys(original.en)) {
    assert.equal(readOnlyText(key, language), original[language][key]);
  }
});
test('unknown locale falls back and unknown keys fail closed', () => {
  assert.equal(readOnlyText('audit.title', 'unknown'), catalog.en['audit.title']);
  assert.throws(() => readOnlyMessage('audit.nonexistent'));
});
test('fixed disclosures are bound presentations, not replacements inside raw JSON', () => {
  const value = JSON.stringify({ registryReference: '0x' + 'a'.repeat(64), note: catalog.en['audit.ok'], holder: '{audit.title}' });
  for (const language of languages) {
    assert.equal(renderUi(readOnlyMessage('audit.gaps'), language), catalog[language]['audit.gaps']);
    assert.equal(renderUi(value, language), value);
  }
});
test('locale repaint preserves original file input object and selection marker', () => {
  const label = new Element(), input = new Element(), files = Object.freeze([{ name: 'original.json' }]); input.files = files;
  const text = readOnlyLabel(label, 'feed.file', { createElement: () => new Element() }); label.append(input);
  for (const language of languages) {
    setLocale(language, { document: emptyDocument, persist: false });
    assert.deepEqual(label.children, [text, input]); assert.equal(input.files, files);
    assert.equal(text.textContent, catalog[language]['feed.file']);
  }
  paint(text, ''); setLocale('en', { document: emptyDocument, persist: false });
});
test('cleared download/status notice cannot be revived by a locale switch', () => {
  const node = new Element(); readOnlyPaint(node, 'audit.download'); paint(node, '');
  for (const language of languages) { setLocale(language, { document: emptyDocument, persist: false }); assert.equal(node.textContent, ''); }
  setLocale('en', { document: emptyDocument, persist: false });
});
