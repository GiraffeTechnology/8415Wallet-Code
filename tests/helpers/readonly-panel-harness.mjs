/** Minimal shared test DOM and login binding, extracted from the PR136 fixture.
 * No product module, backend, credentials or provider is configured. */
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
