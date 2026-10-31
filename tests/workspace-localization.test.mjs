import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import copy, { workspaceNarrative } from '../web/locales/workspace.mjs';
import { LOCALES, paint, presentation, setLocale } from '../web/i18n.mjs';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.style = {}; this.value = ''; this.isConnected = true; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(key, listener) { this.events[key] = listener; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
test('workspace catalogs have exactly the supported six locales and complete matching keys', () => {
  assert.deepEqual(Object.keys(copy), LOCALES.map(locale => locale.id));
  for (const messages of Object.values(copy)) {
    assert.deepEqual(Object.keys(messages), Object.keys(copy.en));
    for (const text of Object.values(messages)) assert.ok(typeof text === 'string' && text.length > 0);
  }
});
for (const variant of ['asset-workspace-panel-v2.mjs', 'asset-workspace-panel.mjs']) {
  test(`${variant}: mounted labels, accessible fields and failure status repaint without reads or value changes`, async () => {
    const source = await readFile(new URL(`../web/${variant}`, import.meta.url), 'utf8');
    const document = { createElement: tag => new Element(tag), addEventListener() {}, getElementById() { return null; }, visibilityState: 'visible' };
    const globals = { addEventListener() {}, history: { state: { walletPage: 'native' } } };
    let reads = 0, projections = 0;
    const read = () => { reads++; throw new Error('unexpected read'); };
    const mount = new Function('document', 'globalThis', 'paint', 'presentation', 'workspaceCopy', 'workspaceNarrative', 'rendererMessages', 'readAssetWorkspace', 'renderAssetWorkspace', 'privateReadProjection', 'identityText', source.replace(/^import .*;\n/gm, '').replace('export function', 'function') + '\nreturn mountAssetWorkspace;')(document, globals, paint, presentation, copy, workspaceNarrative, () => undefined, read, () => 'raw', value => { projections++; return value; }, value => value);
    setLocale('en', { document: undefined, persist: false });
    const root = new Element('root');
    mount({ root, login: { assert: () => ({ chainId: '1', account: 'raw-address' }), capture: () => ({}), check: async () => {}, subscribe() {} }, getContext: () => null });
    const nodes = walk(root), inputs = nodes.filter(node => node.tag === 'input'), options = nodes.filter(node => node.tag === 'option');
    inputs[0].value = '1700000000';
    if (inputs.length === 3) inputs[1].value = '0xRAW_SEQUENCE';
    const values = inputs.map(input => input.value);
    assert.equal(options.length, variant.includes('-v2') ? 4 : 6);
    for (const input of inputs) assert.ok(nodes.some(node => node.tag === 'label' && node.children.includes(input)), 'visible programmatic input label');
    const panel = root.children[0], title = nodes.find(node => node.tag === 'h2');
    assert.equal(panel.attrs['aria-labelledby'], title.id);
    for (const locale of LOCALES) {
      setLocale(locale.id, { document: undefined, persist: false });
      assert.equal(title.textContent, copy[locale.id].title);
      for (const option of options) assert.equal(option.textContent, copy[locale.id][option.value]);
      assert.deepEqual(inputs.map(input => input.value), values);
    }
    assert.equal(reads, 0); assert.equal(projections, 0);
    await nodes.find(node => node.tag === 'button').events.click();
    const output = nodes.find(node => node.tag === 'pre');
    for (const locale of LOCALES) {
      setLocale(locale.id, { document: undefined, persist: false });
      assert.equal(output.textContent, copy[locale.id].unavailable);
    }
    assert.equal(reads, 0); assert.equal(projections, 0);
    assert.ok(source.includes('privateReadProjection(result, authenticated.account)'));
    assert.ok(source.includes('epoch !== generation'));
    if (variant.includes('-v2')) assert.ok(!source.includes('linkedReader'));
  });
}

test('workspace narrative catalogs preserve exact opaque parameter slots across all six languages', () => {
 const slots = value => [...value.matchAll(/\{([a-z]+)\}/g)].map(match => match[1]).sort();
 for (const catalog of Object.values(workspaceNarrative)) {
  assert.deepEqual(Object.keys(catalog), Object.keys(workspaceNarrative.en));
  for (const [key, value] of Object.entries(catalog)) assert.deepEqual(slots(value), slots(workspaceNarrative.en[key]), key);
 }
});
