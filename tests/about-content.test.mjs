import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { aboutContent, renderAbout, bindAbout } from '../web/about.mjs';
// Draft text languages, not a claim about the deployed website's menu.
const languages = ['en', 'zh-Hans', 'zh-Hant', 'fr', 'es', 'ja'];
test('independently supplied fixed About text matches its complete original UTF-8 digest', () => {
  const copies = Object.fromEntries(languages.map(locale => [locale, aboutContent(locale, languages)]));
  const bytes = Buffer.from(JSON.stringify(copies, null, 2) + '\n');
  assert.equal(bytes.length, 3341);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'c297759b43c51875929ddc097168e4136cd10a8dd8538b0fd48106b5213d0dea');
  for (const locale of languages) assert.equal(Object.isFrozen(copies[locale]), true);
});
test('a draft copy does not enable a locale absent from the actual menu and missing text never falls back', () => {
  assert.throws(() => aboutContent('fr', ['en']), /NOT_CONFIGURED/);
  assert.throws(() => aboutContent('de', ['en', 'de']), /NOT_CONFIGURED/);
  assert.throws(() => aboutContent('constructor', ['constructor']), /NOT_CONFIGURED/);
});
function dom() {
  const document = { createElement(tag) { return { tag, textContent: '' }; }, defaultView: {}, documentElement: {} };
  const root = { ownerDocument: document, children: [], attributes: {},
    replaceChildren(...nodes) { this.children = nodes; }, setAttribute(key, value) { this.attributes[key] = value; } };
  return { document, root };
}
test('About renders fixed literal text with no HTML interpretation or machine translation', () => {
  const { root } = dom(), copy = renderAbout(root, 'zh-Hans', ['en', 'zh-Hans']);
  assert.equal(root.attributes.lang, 'zh-Hans');
  assert.deepEqual(root.children.map(node => node.tag), ['h2', 'p', 'p']);
  assert.deepEqual(root.children.map(node => node.textContent), [copy.title, copy.body, copy.profiles]);
  const source = readFileSync(new URL('../web/about.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s/m); assert.doesNotMatch(source, /innerHTML|\bfetch\s*\(|XMLHttpRequest|localStorage|\.request\s*\(/);
});
test('binding uses the unchanged existing menu and fixed text; disposal removes its listener', () => {
  const { root } = dom(), listeners = new Map(), label = { textContent: '' };
  const options = [{ value: 'en' }, { value: 'ja' }], selector = { value: 'en', options,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { assert.equal(listeners.get(name), listener); listeners.delete(name); } };
  const dispose = bindAbout(root, selector, label);
  selector.value = 'ja'; listeners.get('change')();
  assert.equal(label.textContent, aboutContent('ja', ['en', 'ja']).title);
  assert.equal(selector.options, options); assert.deepEqual(options.map(option => option.value), ['en', 'ja']);
  dispose(); assert.equal(listeners.size, 0);
});
