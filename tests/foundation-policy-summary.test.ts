/** Synthetic DOM contract for the read-only Agent settings policy row.
 * No server, browser, session or saved policy is created by this suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectFoundationPolicySummary } from '../web/foundation-policy-summary.mjs';

class Node {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  textContent = ''; hidden = false;
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
}

type View = { mode: string; revision: string } | null;
function fixture({ view = { mode: 'OFF', revision: '7' } as View, adapter = true, fails = false, defer = false } = {}) {
  const nodes = new Map<string, Node>();
  for (const id of ['foundation-humanVerification-switch', 'foundation-humanVerification-value',
    'foundation-policy-saved-note']) nodes.set(id, new Node());
  type PageEvent = { detail?: unknown };
  const listeners = new Map<string, ((event: PageEvent) => void)[]>();
  const reads: unknown[] = [], logins: (() => void)[] = [];
  let binding: object | null = { id: 'synthetic-binding' }, valid = true;
  const document = {
    getElementById: (id: string) => nodes.get(id) ?? null,
    addEventListener(type: string, handler: (event: PageEvent) => void) { listeners.set(type, [...listeners.get(type) ?? [], handler]); },
    removeEventListener(type: string, handler: (event: PageEvent) => void) {
      listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== handler));
    },
  };
  const walletLogin = {
    capture() { if (!binding) throw Error('LOGIN_REQUIRED'); return binding; },
    assert(value: unknown) { if (!valid || value !== binding) throw Error('LOGIN_SESSION_CHANGED'); return binding; },
    subscribe(handler: () => void) { logins.push(handler); return () => {}; },
  };
  let release = () => {};
  const policyClient = { async read(request: unknown) {
    reads.push(request);
    if (defer) await new Promise<void>(resolve => { release = resolve; });
    if (fails) throw Error('TASK_POLICY_ADAPTER_UNAVAILABLE');
    return view;
  } };
  const connection = connectFoundationPolicySummary({ document, walletLogin, getPolicyClient: () => adapter ? policyClient : null });
  assert.ok(connection);
  return { connection, reads, logins, nodes,
    control: nodes.get('foundation-humanVerification-switch')!,
    value: nodes.get('foundation-humanVerification-value')!,
    note: nodes.get('foundation-policy-saved-note')!,
    page(detail: string) { for (const handler of listeners.get('wallet:page') ?? []) handler({ detail }); },
    invalidate() { valid = false; },
    release() { release(); },
    signOut() { binding = null; for (const handler of logins) handler(); },
  };
}

const unconnected = (f: ReturnType<typeof fixture>) => {
  assert.equal(f.control.dataset.policySource, 'unconnected-default');
  assert.equal(f.control.dataset.displayMode, 'ON');
  assert.equal(Object.hasOwn(f.control.dataset, 'savedRevision'), false);
  assert.equal(f.control.getAttribute('aria-describedby'), 'foundation-policy-note');
  assert.equal(f.value.textContent, 'ON');
  assert.equal(f.note.hidden, true);
};

test('before any authoritative read the row keeps the unlocked ON default', () => {
  const f = fixture(); unconnected(f); assert.deepEqual(f.reads, []);
});

test('opening settings displays the saved mode, its revision and where it is operated', async () => {
  const f = fixture();
  f.page('settings'); await new Promise(resolve => setImmediate(resolve));
  // One read per settings entry: a second overlapping request is not started.
  assert.deepEqual(f.reads, [{ binding: { id: 'synthetic-binding' } }]);
  assert.equal(f.control.dataset.policySource, 'saved-policy');
  assert.equal(f.control.dataset.displayMode, 'OFF');
  assert.equal(f.control.dataset.savedRevision, '7');
  assert.equal(f.control.getAttribute('aria-describedby'), 'foundation-policy-saved-note');
  assert.equal(f.value.textContent, 'OFF');
  assert.equal(f.note.hidden, false);
});

test('any other page performs no policy read', () => {
  const f = fixture();
  for (const page of ['overview', 'tasks', 'native']) f.page(page);
  assert.deepEqual(f.reads, []); unconnected(f);
});

test('an unavailable service, failed read or malformed mode keeps the default instead of showing OFF', async () => {
  for (const options of [{ adapter: false }, { fails: true }, { view: null }, { view: { mode: 'MAYBE', revision: '1' } }]) {
    const f = fixture(options as never); await f.connection.read(); unconnected(f);
  }
});

test('a login or account change during the read discards its result', async () => {
  const f = fixture(); f.invalidate(); await f.connection.read(); unconnected(f);
});

test('signing out returns the row to the unlocked default', async () => {
  const f = fixture(); await f.connection.read();
  assert.equal(f.control.dataset.displayMode, 'OFF');
  f.signOut(); unconnected(f);
  await f.connection.read(); unconnected(f);
});

test('a fresh management view is adopted while hidden and busy states change nothing', async () => {
  const f = fixture(); await f.connection.read();
  f.connection.observe({ view: { mode: 'ON', revision: '9' } });
  assert.equal(f.control.dataset.displayMode, 'ON');
  assert.equal(f.control.dataset.savedRevision, '9');
  assert.equal(f.control.dataset.policySource, 'saved-policy');
  for (const state of [null, undefined, { view: null }, { view: null, busy: true }, { draftMode: 'OFF' }]) {
    f.connection.observe(state as never);
    assert.equal(f.control.dataset.displayMode, 'ON');
    assert.equal(f.control.dataset.savedRevision, '9');
  }
});

test('one connection per document, and destroy stops reading and restores the default', async () => {
  const f = fixture();
  await f.connection.read();
  f.connection.destroy(); unconnected(f);
  f.page('settings'); await f.connection.read();
  assert.equal(f.reads.length, 1); unconnected(f);
});


test('a read answered after an adopted management view cannot overwrite it', async () => {
  // The owner saves OFF in sign-in method management while a settings-page read
  // is still in flight. Its older response must not restore the previous mode.
  const f = fixture({ defer: true, view: { mode: 'ON', revision: '7' } });
  const pending = f.connection.read();
  assert.deepEqual(f.reads.length, 1);
  f.connection.observe({ view: { mode: 'OFF', revision: '9' } });
  f.release(); await pending;
  assert.equal(f.control.dataset.displayMode, 'OFF');
  assert.equal(f.control.dataset.savedRevision, '9');
  assert.equal(f.value.textContent, 'OFF');
});
