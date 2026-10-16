import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readOnlyText } from '../web/readonly-i18n.mjs';
import { mountAuditExport } from '../web/audit-export-panel.mjs';
import { mountFeedContinuity } from '../web/feed-continuity-panel.mjs';
import { mountKitRead } from '../web/kit-read-panel.mjs';
import { mountWatchtowerRead } from '../web/watchtower-read-panel.mjs';

/**
 * The read-only panels' mount modules, driven for the first time.
 *
 * Each one is imported by `web/app.mjs` at load time and had no regression
 * that executed it. They share one lifecycle contract, so the cases below are
 * written once and run against all four: inert without a host, refusing to
 * read while the host is hidden, reporting a failure as its own fixed message
 * without leaking what the read actually said, and clearing that state on
 * logout, page change, hidden visibility and pagehide.
 */

class Node {
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
  files: { size: number; text(): Promise<string> }[] = [];
  style: Record<string, string> = {};
  children: Node[] = [];
  readonly attributes = new Map<string, string>();
  readonly handlers = new Map<string, Function[]>();
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  addEventListener(name: string, fn: Function): void {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
  }
  dispatchEvent(event: { type: string; detail?: unknown }): void {
    for (const fn of this.handlers.get(event.type) ?? []) fn(event);
  }
  click(): void { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
  append(...items: Node[]): void { this.children.push(...items); }
  replaceChildren(...items: Node[]): void { this.children = items; }
  remove(): void {}
  /** Depth-first, so a status node nested in a label is still found. */
  descendants(): Node[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
}

/** Mirrors WalletLogin: assert throws when signed out or when a binding is stale. */
function fakeLogin() {
  let session: { account: string; chainId: string } | null = { account: '0xowner', chainId: '1' };
  let generation = 0;
  const listeners: Function[] = [];
  const login = {
    assert(binding?: { generation: number }) {
      if (session === null) throw new Error('LOGIN_REQUIRED');
      if (binding !== undefined && binding.generation !== generation) {
        throw new Error('LOGIN_SESSION_CHANGED');
      }
      return session;
    },
    capture() { login.assert(); return Object.freeze({ generation }); },
    async check() { login.assert(); },
    subscribe(fn: Function) { listeners.push(fn); return () => {}; },
    logout() { session = null; generation += 1; for (const fn of listeners) fn(null, 'LOGIN_REQUIRED'); },
    subscriberCount() { return listeners.length; },
  };
  return login;
}

const SECRET = 'BACKEND_DETAIL_THAT_MUST_NOT_REACH_THE_PAGE';
const CONTRACT = `0x${'ab'.repeat(20)}`;
/** A declaration the panels accept, so the read runs instead of refusing early. */
const DECLARATION = JSON.stringify({
  schema: '8415wallet-feed-continuity/1',
  projection: { chainId: '1', contract: CONTRACT, registerId: `0x${'cd'.repeat(32)}` },
  feeds: [{ chainId: '1', address: `0x${'ef'.repeat(20)}`, assetId: `0x${'12'.repeat(32)}` }],
});
const declarationFile = () => ({ size: DECLARATION.length, text: async () => DECLARATION });

function harness() {
  const host = new Node();
  host.setAttribute('data-page', 'native');
  const root = new Node();
  root.children.push(host);
  const rootWithSelector = Object.assign(root, {
    querySelector: (selector: string) => (selector === '[data-page="native"]' ? host : undefined),
  });
  const documentEvents = new Node();
  const windowEvents = new Node();
  const byId = new Map<string, Node>([['tokenId', new Node()]]);
  const document = {
    visibilityState: 'visible',
    getElementById: (id: string) => byId.get(id),
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

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setImmediate(resolve));
};

const inputsOf = (host: Node, type: string): Node[] =>
  host.descendants().filter((node) => node.type === type);

const PANELS = [
  { label: 'custody audit export', mount: mountAuditExport, readKey: 'audit.read', errorKey: 'audit.error',
    prepare: () => {} },
  { label: 'feed continuity review', mount: mountFeedContinuity, readKey: 'feed.read', errorKey: 'feed.error',
    prepare: (host: Node) => { inputsOf(host, 'file')[0]!.files = [declarationFile()]; } },
  { label: 'Kit display read', mount: mountKitRead, readKey: 'kit.read', errorKey: 'kit.error',
    prepare: (host: Node) => {
      const [basePath, instant] = inputsOf(host, 'text');
      basePath!.value = '/kit';
      instant!.value = '1000';
    } },
  { label: 'watchtower comparison', mount: mountWatchtowerRead, readKey: 'wt.read', errorKey: 'wt.error',
    prepare: (host: Node) => {
      inputsOf(host, 'file')[0]!.files = [declarationFile()];
      inputsOf(host, 'text')[0]!.value = '1000';
    } },
] as const;

const statusOf = (host: Node): Node => {
  const found = host.descendants().find((node) => node.getAttribute('role') === 'status');
  assert.ok(found, 'the panel must expose a status region');
  return found;
};
const readButtonOf = (host: Node, readKey: string): Node => {
  const label = readOnlyText(readKey);
  const found = host.descendants().find((node) => node.textContent === label);
  assert.ok(found, `the panel must expose its read control (${readKey})`);
  return found;
};

for (const panel of PANELS) {
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
    const login = fakeLogin();
    let contextReads = 0;
    panel.mount({
      root: context.root, login,
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

  for (const clearing of [
    { label: 'logout', fire: (h: ReturnType<typeof harness>, login: ReturnType<typeof fakeLogin>) => login.logout() },
    { label: 'a page change away from native', fire: (h: ReturnType<typeof harness>) => h.documentEvents.dispatchEvent({ type: 'wallet:page', detail: 'linked' }) },
    { label: 'the page becoming hidden', fire: (h: ReturnType<typeof harness>) => { h.document.visibilityState = 'hidden'; h.documentEvents.dispatchEvent({ type: 'visibilitychange' }); } },
    { label: 'pagehide', fire: (h: ReturnType<typeof harness>) => h.windowEvents.dispatchEvent({ type: 'pagehide' }) },
    { label: 'a token selection change', fire: (h: ReturnType<typeof harness>) => h.byId.get('tokenId')!.dispatchEvent({ type: 'input' }) },
  ]) {
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
