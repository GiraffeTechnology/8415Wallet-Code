import test from 'node:test';
import assert from 'node:assert/strict';

import { readOnlyText } from '../../web/readonly-i18n.mjs';

/**
 * Shared harness for the read-only panel mounts.
 *
 * The cases live here so they are written once and run against every panel.
 * Two panels import dist/browser/browser.js at module scope, so they cannot be
 * exercised until the browser build has run; they are driven from a separate
 * .mjs suite that a post-build workflow step owns, while the panels with no
 * build dependency are driven from a .test.ts suite inside npm test.
 */

export const SECRET = 'BACKEND_DETAIL_THAT_MUST_NOT_REACH_THE_PAGE';
export const CONTRACT = `0x${'ab'.repeat(20)}`;

/** A declaration the panels accept, so a read runs instead of refusing early. */
const DECLARATION = JSON.stringify({
  schema: '8415wallet-feed-continuity/1',
  projection: { chainId: '1', contract: CONTRACT, registerId: `0x${'cd'.repeat(32)}` },
  feeds: [{ chainId: '1', address: `0x${'ef'.repeat(20)}`, assetId: `0x${'12'.repeat(32)}` }],
});
export const declarationFile = () => ({ size: DECLARATION.length, text: async () => DECLARATION });

export class Node {
  id = '';
  className = '';
  textContent = '';
  hidden = false;
  disabled = false;
  value = '';
  type = '';
  accept = '';
  inputMode = '';
  autocomplete = '';
  files = [];
  style = {};
  children = [];
  attributes = new Map();
  handlers = new Map();
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(name, fn) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); }
  dispatchEvent(event) { for (const fn of this.handlers.get(event.type) ?? []) fn(event); }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  remove() {}
  /** Depth-first, so a status node nested in a label is still found. */
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
}

/**
 * Mirrors WalletLogin: assert throws when signed out or when a binding is stale.
 * The initial session is a parameter because the Hoodi panel refuses any chain
 * but 560048 and matches the session account against its evidence manifest.
 */
export function fakeLogin(initial = { account: '0xowner', chainId: '1' }) {
  let session = initial;
  let generation = 0;
  const listeners = [];
  const provider = { request: async () => { throw new Error(SECRET); } };
  const login = {
    assert(binding) {
      if (session === null) throw new Error('LOGIN_REQUIRED');
      if (binding !== undefined && binding.generation !== generation) {
        throw new Error('LOGIN_SESSION_CHANGED');
      }
      return session;
    },
    capture() { login.assert(); return Object.freeze({ generation }); },
    async check() { login.assert(); },
    subscribe(fn) { listeners.push(fn); return () => {}; },
    /** An identity token only: no panel reads through it without a stub. */
    provider() { login.assert(); return provider; },
    logout() { session = null; generation += 1; for (const fn of listeners) fn(null, 'LOGIN_REQUIRED'); },
    /**
     * A session that changed without notifying: re-established, or switched
     * before the subscriber ran. Nothing clears the panel, so only the
     * binding asserts stand between a stale read and the page.
     */
    expire() { generation += 1; },
    subscriberCount() { return listeners.length; },
  };
  return login;
}

export function harness() {
  const host = new Node();
  host.setAttribute('data-page', 'native');
  const root = new Node();
  root.children.push(host);
  const rootWithSelector = Object.assign(root, {
    querySelector: selector => (selector === '[data-page="native"]' ? host : undefined),
  });
  const documentEvents = new Node();
  const windowEvents = new Node();
  const byId = new Map([['tokenId', new Node()]]);
  const document = {
    visibilityState: 'visible',
    getElementById: id => byId.get(id),
    createElement: () => new Node(),
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
  };
  const window = {
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    setTimeout: () => 0,
    location: { origin: 'http://127.0.0.1:8415' },
    Blob: class {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  };
  let backendReads = 0;
  const wallet = {
    reader: { source: { chainId: 1n, address: CONTRACT } },
    // Every panel's read reaches this; it fails with text no page may show.
    assetView: async () => { backendReads += 1; throw new Error(SECRET); },
  };
  const context = { wallet, tokenId: 1n, provider: { request: async () => { throw new Error(SECRET); } } };
  return { root: rootWithSelector, host, document, window, documentEvents, windowEvents, byId, context,
    backendReads: () => backendReads };
}

const flush = async () => {
  for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => setImmediate(resolve));
};

export const inputsOf = (host, type) => host.descendants().filter(node => node.type === type);

const statusOf = host => {
  const found = host.descendants().find(node => node.getAttribute('role') === 'status');
  assert.ok(found, 'the panel must expose a status region');
  return found;
};
const readButtonOf = (host, readKey) => {
  const label = readOnlyText(readKey);
  const found = host.descendants().find(node => node.textContent === label);
  assert.ok(found, `the panel must expose its read control (${readKey})`);
  return found;
};

/** Register every lifecycle case for one panel. */
export function runPanelLifecycleCases(panel) {
  test(`${panel.label}: mounts nothing without a native host`, () => {
    const context = harness();
    const rootWithoutHost = Object.assign(new Node(), { querySelector: () => undefined });
    const handle = panel.mount({
      root: rootWithoutHost, login: fakeLogin(), getContext: () => context.context,
      document: context.document, window: context.window,
    });
    assert.equal(handle, undefined);
    assert.deepEqual(rootWithoutHost.children, []);
  });

  test(`${panel.label}: mounts exactly one card and registers a logout subscriber`, () => {
    const context = harness();
    const login = fakeLogin();
    panel.mount({
      root: context.root, login, getContext: () => context.context,
      document: context.document, window: context.window,
    });
    assert.equal(context.host.children.length, 1);
    assert.equal(context.host.children[0]?.className, 'card');
    assert.equal(login.subscriberCount(), 1);
  });

  test(`${panel.label}: a hidden host refuses to read at all`, async () => {
    const context = harness();
    let contextReads = 0;
    panel.mount({
      root: context.root, login: fakeLogin(),
      getContext: () => { contextReads += 1; return context.context; },
      document: context.document, window: context.window,
    });
    context.host.hidden = true;
    readButtonOf(context.host, panel.readKey).click();
    await flush();
    assert.equal(contextReads, 0, 'a hidden panel must not even look at the selection');
    assert.equal(statusOf(context.host).textContent, '');
  });

  test(`${panel.label}: a failed read reports its own message and leaks nothing`, async () => {
    const context = harness();
    panel.mount({
      root: context.root, login: fakeLogin(), getContext: () => context.context,
      document: context.document, window: context.window,
    });
    panel.prepare(context.host);
    readButtonOf(context.host, panel.readKey).click();
    await flush();
    assert.ok(context.backendReads() > 0,
      'the read refused on its own form, so this proves nothing about leaking');
    assert.equal(statusOf(context.host).textContent, readOnlyText(panel.errorKey));
    for (const node of context.host.descendants()) {
      assert.doesNotMatch(node.textContent, new RegExp(SECRET), 'backend text reached the page');
    }
  });

  const clearings = [
    { label: 'logout', fire: (h, login) => login.logout() },
    { label: 'a page change away from native',
      fire: h => h.documentEvents.dispatchEvent({ type: 'wallet:page', detail: 'linked' }) },
    { label: 'the page becoming hidden',
      fire: h => { h.document.visibilityState = 'hidden'; h.documentEvents.dispatchEvent({ type: 'visibilitychange' }); } },
    { label: 'pagehide', fire: h => h.windowEvents.dispatchEvent({ type: 'pagehide' }) },
    { label: 'a token selection change', fire: h => h.byId.get('tokenId').dispatchEvent({ type: 'input' }) },
  ];
  for (const clearing of clearings) {
    test(`${panel.label}: ${clearing.label} clears the reported failure`, async () => {
      const context = harness();
      const login = fakeLogin();
      panel.mount({
        root: context.root, login, getContext: () => context.context,
        document: context.document, window: context.window,
      });
      panel.prepare(context.host);
      readButtonOf(context.host, panel.readKey).click();
      await flush();
      assert.equal(statusOf(context.host).textContent, readOnlyText(panel.errorKey));
      clearing.fire(context, login);
      await flush();
      assert.equal(statusOf(context.host).textContent, '', 'stale state survived a clearing event');
    });
  }
}
