import test from 'node:test';
import assert from 'node:assert/strict';

import { mountAssetWorkspace } from '../../web/asset-workspace-panel.mjs';
import { WalletSession } from '../../dist/browser/browser.js';
import { divergentToken, T } from '../../src/adapters/memory/scenarios.ts';
import { delegateReader } from '../support/delegateReader.ts';
import { fakeLogin, Node, SECRET } from './readonly-panel-harness.mjs';

/**
 * The asset and history workspace panel.
 *
 * Its whole closure is itself and dist/browser/browser.js, so it cannot be
 * imported before the browser build and a post-build step owns this file. The
 * read is the real readAssetWorkspace over the in-memory conforming contract:
 * a stubbed read would leave the panel's own refusals the only thing covered.
 *
 * The panel predates the injected-document mounts and reads the global
 * document and globalThis, so each case installs them and restores them.
 */

const flush = async () => {
  for (let turn = 0; turn < 12; turn += 1) await new Promise(resolve => setImmediate(resolve));
};

const INSTANT = String(T.asOf);

function fixture(options = {}) {
  const { reader: base, tokenId } = divergentToken();
  const calls = { entryCount: 0, entryAt: 0, versions: [] };
  const reader = delegateReader(base, {
    entryCount: async id => { calls.entryCount += 1; return options.entryCount ? options.entryCount(id) : base.entryCount(id); },
    entryAt: async (id, version) => {
      calls.entryAt += 1; calls.versions.push(version);
      return options.entryAt ? options.entryAt(id, version, base) : base.entryAt(id, version);
    },
    ...(options.overrides ?? {}),
  });
  const wallet = new WalletSession(reader);
  return { wallet, reader, tokenId, calls, chainId: reader.source.chainId.toString() };
}

/** Installs the globals the panel reads, and gives them back afterwards. */
function mount(options = {}) {
  const base = options.fixture ?? fixture();
  const login = options.login ?? fakeLogin({ account: '0xowner', chainId: base.chainId });
  const root = options.withRoot === false ? null : new Node();
  const tokenNode = new Node();
  const documentEvents = new Node();
  const windowEvents = new Node();
  let created = 0;
  const document = {
    getElementById: id => (id === 'tokenId' ? tokenNode : undefined),
    createElement: () => { created += 1; return new Node(); },
    createTextNode: text => Object.assign(new Node(), { textContent: text }),
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
  };
  const savedDocument = 'document' in globalThis ? globalThis.document : undefined;
  const savedListener = globalThis.addEventListener;
  globalThis.document = document;
  globalThis.addEventListener = windowEvents.addEventListener.bind(windowEvents);
  let contextReads = 0;
  const context = {
    wallet: base.wallet, tokenId: base.tokenId,
    provider: { request: async () => { throw new Error(SECRET); } },
    linkedReader: options.linkedReader ?? null,
  };
  let handle;
  try {
    handle = mountAssetWorkspace({
      root, login,
      getContext: () => {
        contextReads += 1;
        if (options.getContext) return options.getContext(context, contextReads);
        return context;
      },
    });
  } finally {
    if (savedDocument === undefined) delete globalThis.document; else globalThis.document = savedDocument;
    if (savedListener === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = savedListener;
  }
  const nodes = root ? root.descendants() : [];
  const byType = type => nodes.filter(node => node.type === type);
  const selection = nodes.find(node => node.getAttribute('aria-label') === 'Workspace section');
  // A real select reports its first option; the stand-in element would report
  // an empty value, which no browser shows the panel.
  if (selection && selection.value === '') selection.value = selection.children[0]?.value ?? '';
  const [instant, sequence] = byType('text');
  const button = label => nodes.find(node => node.textContent === label);
  return {
    handle, root, login, created, context, base, calls: base.calls,
    card: root?.children[0],
    instant, sequence,
    logs: byType('checkbox')[0],
    load: button('Read asset workspace'),
    next: button('Next register-history page'),
    select: selection,
    output: nodes.find(node => node.getAttribute('aria-live') === 'polite'),
    tokenNode, documentEvents, windowEvents,
    contextReads: () => contextReads,
    /** Every handler runs against the globals the panel captured at mount. */
    async act(run) {
      const previousDocument = 'document' in globalThis ? globalThis.document : undefined;
      const previousListener = globalThis.addEventListener;
      globalThis.document = document;
      globalThis.addEventListener = windowEvents.addEventListener.bind(windowEvents);
      try { await run(); await flush(); } finally {
        if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
        if (previousListener === undefined) delete globalThis.addEventListener; else globalThis.addEventListener = previousListener;
      }
    },
  };
}

const ready = panel => { panel.instant.value = INSTANT; };

/**
 * Holds a read open. One read asks for the entry count more than once, so a
 * fresh promise per call would leave the first one pending for good and the
 * test would pass on a read that never finished.
 */
function deferredCount(value = 3n) {
  let release = () => {};
  const promise = new Promise(resolve => { release = () => resolve(value); });
  return { read: () => promise, release: () => release() };
}

export function runAssetWorkspaceCases() {
  test('asset workspace: no host element mounts nothing', () => {
    const panel = mount({ withRoot: false });
    assert.equal(panel.handle, undefined);
    assert.equal(panel.created, 0);
    assert.equal(panel.login.subscriberCount(), 0);
  });

  test('asset workspace: mounts one card with its read controls', () => {
    const panel = mount();
    assert.equal(panel.root.children.length, 1);
    assert.equal(panel.card.getAttribute('aria-label'), 'Asset and responsibility workspace');
    assert.ok(panel.instant && panel.sequence && panel.logs && panel.load && panel.next && panel.select);
    assert.equal(panel.output.textContent, '');
    assert.equal(panel.login.subscriberCount(), 1);
    assert.deepEqual([...panel.windowEvents.handlers.keys()].sort(), ['pagehide', 'pageshow']);
    assert.deepEqual([...panel.documentEvents.handlers.keys()], ['wallet:summary-stale']);
    assert.deepEqual([...panel.tokenNode.handlers.keys()].sort(), ['change', 'input']);
    assert.deepEqual(
      panel.select.children.map(option => option.value),
      ['asset', 'temporal', 'register-history', 'dual-history', 'responsibility', 'payments'],
    );
  });

  test('asset workspace: a signed-in mount enables the read but not the cursor', () => {
    const panel = mount();
    for (const control of [panel.load, panel.select, panel.instant, panel.sequence, panel.logs]) {
      assert.equal(control.disabled, false);
    }
    assert.equal(panel.next.disabled, true, 'there is no page cursor before a read');
  });

  test('asset workspace: a signed-out mount disables every control', () => {
    const login = fakeLogin();
    login.logout();
    const panel = mount({ login });
    for (const control of [panel.load, panel.select, panel.instant, panel.sequence, panel.logs, panel.next]) {
      assert.equal(control.disabled, true);
    }
  });

  for (const refusal of [
    { label: 'an empty instant', prepare: () => {} },
    { label: 'a non-numeric instant', prepare: panel => { panel.instant.value = '12a'; } },
    { label: 'a zero-padded instant', prepare: panel => { panel.instant.value = '01'; } },
    { label: 'a hexadecimal instant', prepare: panel => { panel.instant.value = '0x10'; } },
    // A linked reader is supplied so only the identifier's form can refuse.
    { label: 'a malformed sequence id', linked: true, prepare: panel => { ready(panel); panel.sequence.value = '0xabc'; } },
    { label: 'an uppercase sequence id', linked: true, prepare: panel => { ready(panel); panel.sequence.value = `0x${'AB'.repeat(32)}`; } },
  ]) {
    test(`asset workspace: ${refusal.label} refuses before any read`, async () => {
      const panel = mount(refusal.linked
        ? { linkedReader: { observe: async () => { throw new Error(SECRET); } } } : {});
      refusal.prepare(panel);
      await panel.act(() => panel.load.click());
      assert.equal(panel.calls.entryCount, 0, 'a refused form must not reach the contract');
      assert.equal(panel.output.textContent, 'WORKSPACE_UNAVAILABLE');
    });
  }

  test('asset workspace: a sequence id without a linked reader refuses before any read', async () => {
    const panel = mount();
    ready(panel);
    panel.sequence.value = `0x${'ab'.repeat(32)}`;
    await panel.act(() => panel.load.click());
    assert.equal(panel.calls.entryCount, 0);
    assert.equal(panel.output.textContent, 'WORKSPACE_UNAVAILABLE');
  });

  test('asset workspace: a context on another chain refuses before any read', async () => {
    const base = fixture();
    const panel = mount({ fixture: base, login: fakeLogin({ account: '0xowner', chainId: '999' }) });
    ready(panel);
    await panel.act(() => panel.load.click());
    assert.equal(panel.calls.entryCount, 0, 'a chain the session did not authorize must not be read');
    assert.equal(panel.output.textContent, 'WORKSPACE_UNAVAILABLE');
  });

  test('asset workspace: a context that refuses to open shows only the panel message', async () => {
    const panel = mount({ getContext: () => { throw new Error(SECRET); } });
    ready(panel);
    await panel.act(() => panel.load.click());
    assert.ok(panel.contextReads() > 0, 'the panel refused earlier, so this proves nothing');
    assert.equal(panel.calls.entryCount, 0);
    assert.equal(panel.output.textContent, 'WORKSPACE_UNAVAILABLE');
    for (const node of panel.root.descendants()) {
      assert.doesNotMatch(node.textContent, new RegExp(SECRET), 'context text reached the page');
    }
  });

  test('asset workspace: an instant the read itself refuses reports the panel message', async () => {
    const panel = mount();
    panel.instant.value = (1n << 64n).toString();
    await panel.act(() => panel.load.click());
    assert.equal(panel.output.textContent, 'WORKSPACE_UNAVAILABLE');
    assert.equal(panel.next.disabled, true);
  });

  test('asset workspace: a read over the conforming contract renders each section', async () => {
    const panel = mount();
    ready(panel);
    await panel.act(() => panel.load.click());
    assert.ok(panel.calls.entryCount > 0, 'the read never reached the contract');
    const asset = panel.output.textContent;
    assert.notEqual(asset, '');
    assert.notEqual(asset, 'WORKSPACE_UNAVAILABLE');
    assert.match(asset, /READ ONLY, not transaction authority/);
    const reads = panel.calls.entryCount;
    panel.select.value = 'register-history';
    await panel.act(() => panel.select.dispatchEvent({ type: 'change' }));
    assert.notEqual(panel.output.textContent, asset, 'the section selection did not re-render');
    assert.equal(panel.calls.entryCount, reads, 're-rendering must not read the contract again');
  });

  test('asset workspace: failing sections stay unavailable without showing their cause', async () => {
    const throwing = async () => { throw new Error(SECRET); };
    const panel = mount({ fixture: fixture({ overrides: {
      entryAsOf: throwing, holderAsOf: throwing, isFinalAsOf: throwing, currentEntry: throwing,
    } }) });
    ready(panel);
    await panel.act(() => panel.load.click());
    assert.ok(panel.calls.entryCount > 0);
    assert.notEqual(panel.output.textContent, '');
    assert.notEqual(panel.output.textContent, 'WORKSPACE_UNAVAILABLE',
      'the whole read refused, so this proves nothing about a failing section');
    for (const node of panel.root.descendants()) {
      assert.doesNotMatch(node.textContent, new RegExp(SECRET), 'contract error text reached the page');
    }
  });

  test('asset workspace: the register cursor pages forward from the returned version', async () => {
    const base = fixture({
      entryCount: async () => 20n,
      entryAt: async (id, version, reader) => ({ ...await reader.entryAt(id, (version - 1n) % 3n + 1n), version }),
    });
    const panel = mount({ fixture: base });
    ready(panel);
    await panel.act(() => panel.load.click());
    const firstPage = panel.calls.versions;
    assert.ok(firstPage.includes(16n), 'the first page must reach the requested limit');
    assert.equal(firstPage.filter(version => version > 16n).length, 0, 'the first page read past its limit');
    assert.equal(panel.next.disabled, false, 'a further page exists and the cursor stayed disabled');
    panel.calls.versions.length = 0;
    await panel.act(() => panel.next.click());
    assert.equal(panel.select.value, 'register-history', 'the cursor must show the page it read');
    // The asset section reads the first entry too; the page is what is pinned.
    assert.deepEqual(panel.calls.versions.filter(version => version > 16n), [17n, 18n, 19n, 20n]);
    assert.equal(panel.next.disabled, true, 'the last page must not offer a further one');
  });

  test('asset workspace: a second read while one is pending is ignored', async () => {
    const held = deferredCount();
    const panel = mount({ fixture: fixture({ entryCount: held.read }) });
    ready(panel);
    await panel.act(() => panel.load.click());
    assert.equal(panel.load.disabled, true, 'a pending read must disable its control');
    const reads = panel.calls.entryCount;
    await panel.act(() => panel.load.dispatchEvent({ type: 'click' }));
    assert.equal(panel.calls.entryCount, reads, 'the pending read was entered twice');
    await panel.act(() => held.release());
    assert.notEqual(panel.output.textContent, '', 'the released read never reached the page');
  });

  test('asset workspace: a logout during a read discards the result', async () => {
    const held = deferredCount();
    const panel = mount({ fixture: fixture({ entryCount: held.read }) });
    ready(panel);
    await panel.act(() => panel.load.click());
    await panel.act(() => panel.login.logout());
    await panel.act(() => held.release());
    assert.equal(panel.output.textContent, '', 'a stale session reached the page');
    assert.equal(panel.load.disabled, true);
  });

  test('asset workspace: a context change during a read discards the result', async () => {
    const held = deferredCount();
    const base = fixture({ entryCount: held.read });
    const other = fixture();
    const panel = mount({ fixture: base,
      getContext: (context, reads) => (reads === 1 ? context : { ...context, wallet: other.wallet }) });
    ready(panel);
    await panel.act(() => panel.load.click());
    await panel.act(() => held.release());
    assert.equal(panel.output.textContent, '', 'a result from a replaced context reached the page');
  });

  test('asset workspace: a silent session change during a read discards the result', async () => {
    const held = deferredCount();
    const panel = mount({ fixture: fixture({ entryCount: held.read }) });
    ready(panel);
    await panel.act(() => panel.load.click());
    // No subscriber fires, so nothing clears the panel on its own.
    await panel.act(() => panel.login.expire());
    await panel.act(() => held.release());
    assert.equal(panel.output.textContent, '', 'a read bound to a replaced session reached the page');
  });

  for (const clearing of [
    { label: 'logout', fire: panel => panel.login.logout() },
    { label: 'a stale summary', fire: panel => panel.documentEvents.dispatchEvent({ type: 'wallet:summary-stale' }) },
    { label: 'a token selection change', fire: panel => panel.tokenNode.dispatchEvent({ type: 'input' }) },
    { label: 'pagehide', fire: panel => panel.windowEvents.dispatchEvent({ type: 'pagehide' }) },
    { label: 'pageshow', fire: panel => panel.windowEvents.dispatchEvent({ type: 'pageshow' }) },
  ]) {
    test(`asset workspace: ${clearing.label} clears the rendered read`, async () => {
      const panel = mount();
      ready(panel);
      await panel.act(() => panel.load.click());
      assert.notEqual(panel.output.textContent, '');
      await panel.act(() => clearing.fire(panel));
      assert.equal(panel.output.textContent, '', 'a stale read survived a clearing event');
      assert.equal(panel.next.disabled, true, 'a stale page cursor survived a clearing event');
    });
  }

  test('asset workspace: a section change while signed out clears instead of rendering', async () => {
    const panel = mount();
    ready(panel);
    await panel.act(() => panel.load.click());
    const rendered = panel.output.textContent;
    assert.notEqual(rendered, '');
    panel.login.logout();
    panel.select.value = 'temporal';
    await panel.act(() => panel.select.dispatchEvent({ type: 'change' }));
    assert.equal(panel.output.textContent, '');
  });
}
