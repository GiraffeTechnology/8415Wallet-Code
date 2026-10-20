/** Source regressions for the local UI bridge contract. NOT runtime/API acceptance.
 * Registered by the existing TypeScript npm-test glob. No build prerequisite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskVerificationPolicyController, validateTaskVerificationPolicyView, mountTaskVerificationPolicy,
  type PolicyView, type PolicySnapshot } from '../web/task-verification-policy-ui.mjs';
import { POLICY_CATALOGS, POLICY_LOCALES, policyText } from '../web/locales/task-verification-policy.mjs';
import { setLocale } from '../web/i18n.mjs';

const context = { origin: 'https://wallet.example.invalid', tenant: 'synthetic',
  account: '0x1111111111111111111111111111111111111111', chainId: '1' };
const initialSession = { id: 1, serverId: 'synthetic-session', ...context };
function view(overrides: Partial<PolicyView> = {}): PolicyView {
  return { mode: 'ON', revision: '7', context: { ...context }, scopeKey: 'synthetic-policy-scope',
    walletLabel: 'My synthetic wallet', agentId: 'synthetic-agent', agentLabel: 'My Agent',
    scopeLabel: 'Previously authorized synthetic asset only', permissions: [{ id: 'transfer', label: 'Transfer' }],
    canChange: true, changeState: 'settled', ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const drain = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
type Input = { binding: unknown; signal: AbortSignal; expectedRevision?: string; expectedScopeKey?: string; mode?: 'ON' | 'OFF' };
type Hook = (input: Input) => unknown | Promise<unknown>;
function fixture() {
  let session: typeof initialSession | null = { ...initialSession }, generation = 1;
  let saved = view(), available = true, readHook: Hook | null = null, changeHook: Hook | null = null;
  let checkHook: (() => Promise<void>) | null = null;
  const listeners = new Set<() => void>(), calls: { read: Input[]; change: Input[] } = { read: [], change: [] };
  const states: PolicySnapshot[] = [];
  const walletLogin = {
    capture() { assert.ok(session); return Object.freeze({ generation }); },
    assert(binding?: { generation: number }) { assert.ok(session); if (binding) assert.equal(binding.generation, generation); return session; },
    async check() { walletLogin.assert(); if (checkHook) await checkHook(); walletLogin.assert(); },
    subscribe(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); },
  };
  const client = {
    async read(input: Input) { calls.read.push(input); return readHook ? readHook(input) : saved; },
    async change(input: Input) {
      calls.change.push(input);
      if (changeHook) return changeHook(input);
      assert.ok(input.mode); saved = view({ mode: input.mode, revision: (BigInt(saved.revision) + 1n).toString() });
      return { notAnAuthoritativeView: true };
    },
  };
  const getPolicyClient = () => available ? client : null;
  const controller = new TaskVerificationPolicyController({ walletLogin, getPolicyClient, onChange: state => states.push(state) });
  return { controller, walletLogin, getPolicyClient, calls, states,
    setView(next: PolicyView) { saved = next; }, setRead(hook: Hook | null) { readHook = hook; },
    setChange(hook: Hook | null) { changeHook = hook; }, setCheck(hook: (() => Promise<void>) | null) { checkHook = hook; },
    unavailable() { available = false; },
    logout() { session = null; generation++; for (const listener of listeners) listener(); },
    switchAccount() {
      session = { ...initialSession, id: 2, account: '0x2222222222222222222222222222222222222222' };
      generation++; for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

test('valid projection is copied, frozen and bound to the authenticated account', () => {
  const raw = view(); const decoded = validateTaskVerificationPolicyView(raw, initialSession);
  assert.deepEqual(decoded, raw); assert.notEqual(decoded, raw);
  assert.ok(Object.isFrozen(decoded)); assert.ok(Object.isFrozen(decoded.context));
  assert.ok(decoded.permissions); assert.ok(Object.isFrozen(decoded.permissions)); assert.ok(Object.isFrozen(decoded.permissions[0]));
});
for (const field of ['origin', 'tenant', 'account', 'chainId'] as const) {
  test(`projection rejects wrong ${field}`, () => {
    const raw = view({ context: { ...context, [field]: field === 'account' ? '0x2222222222222222222222222222222222222222' : 'other' } });
    assert.throws(() => validateTaskVerificationPolicyView(raw, initialSession));
  });
}
test('projection rejects server-session absence, invalid modes and invalid revisions', () => {
  assert.throws(() => validateTaskVerificationPolicyView(view(), { ...initialSession, serverId: undefined }));
  for (const mode of ['AUTO', '', null, false]) assert.throws(() => validateTaskVerificationPolicyView({ ...view(), mode }, initialSession));
  for (const revision of [7, '07', '-1', '', '1.0', (1n << 256n).toString()]) {
    assert.throws(() => validateTaskVerificationPolicyView({ ...view(), revision }, initialSession));
  }
});
test('projection refuses extra fields, accessors and sparse or duplicate permissions', () => {
  assert.throws(() => validateTaskVerificationPolicyView({ ...view(), credential: 'must not be copied' }, initialSession));
  let accessed = false; const raw = view(); Object.defineProperty(raw, 'mode', { enumerable: true, get() { accessed = true; return 'ON'; } });
  assert.throws(() => validateTaskVerificationPolicyView(raw, initialSession)); assert.equal(accessed, false);
  const sparse = new Array(1);
  assert.throws(() => validateTaskVerificationPolicyView({ ...view(), permissions: sparse }, initialSession));
  assert.throws(() => validateTaskVerificationPolicyView(view({ permissions: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }), initialSession));
});
test('projection keeps raw identifiers exact and refuses control-character spoofing', () => {
  const raw = view({ scopeLabel: '<script>literal only</script>', walletLabel: 'My {wallet}' });
  assert.equal(validateTaskVerificationPolicyView(raw, initialSession).scopeLabel, raw.scopeLabel);
  assert.throws(() => validateTaskVerificationPolicyView(view({ agentLabel: 'A\u202eB' }), initialSession));
});
test('unknown is an explicit projection state, never a default OFF state', () => {
  assert.equal(validateTaskVerificationPolicyView(view({ changeState: 'unknown' }), initialSession).changeState, 'unknown');
  const missingMode: Record<string, unknown> = { ...view() }; delete missingMode.mode;
  assert.throws(() => validateTaskVerificationPolicyView(missingMode, initialSession));
  assert.throws(() => validateTaskVerificationPolicyView({ ...view(), changeState: undefined }, initialSession));
});
test('constructor performs no read or write; repeated show cannot duplicate reads', async () => {
  const f = fixture(); assert.equal(f.calls.read.length, 0); assert.equal(f.calls.change.length, 0);
  const waiting = deferred<PolicyView>(); f.setRead(() => waiting.promise);
  const first = f.controller.show(), second = f.controller.show(); await drain();
  assert.equal(f.calls.read.length, 1); waiting.resolve(view()); await Promise.all([first, second]);
  assert.equal(f.controller.snapshot().phase, 'ready'); f.controller.destroy();
});
test('draft switch does not mutate the server; cancelling a draft preserves saved state', async () => {
  const f = fixture(); await f.controller.show(); f.controller.choose('OFF');
  assert.equal(f.controller.snapshot().phase, 'review'); assert.equal(f.controller.snapshot().view?.mode, 'ON');
  assert.equal(f.calls.change.length, 0); await f.controller.cancel();
  assert.equal(f.controller.snapshot().draftMode, null); assert.equal(f.calls.change.length, 0); f.controller.destroy();
});
for (const mode of ['ON', 'OFF'] as const) {
  test(`${mode} requires the change ceremony and authoritative readback`, async () => {
    const f = fixture(); f.setView(view({ mode: mode === 'ON' ? 'OFF' : 'ON' }));
    await f.controller.show(); f.controller.choose(mode); await f.controller.save();
    assert.equal(f.calls.change.length, 1); assert.equal(f.calls.change[0]?.mode, mode);
    assert.equal(f.calls.change[0]?.expectedRevision, '7');
    assert.equal(f.calls.change[0]?.expectedScopeKey, 'synthetic-policy-scope');
    assert.equal(f.calls.read.length, 3, 'initial, fresh preflight and post-change read');
    assert.equal(f.controller.snapshot().view?.mode, mode); assert.equal(f.controller.snapshot().notice, 'saved');
    f.controller.destroy();
  });
}
test('stale reviewed revision prevents any mutation and discards the draft', async () => {
  const f = fixture(); await f.controller.show(); f.controller.choose('OFF'); f.setView(view({ revision: '8' }));
  await f.controller.save(); assert.equal(f.calls.change.length, 0);
  assert.equal(f.controller.snapshot().notice, 'changed'); assert.equal(f.controller.snapshot().draftMode, null);
  assert.equal(f.controller.snapshot().view?.revision, '8'); f.controller.destroy();
});
test('changed permission scope is re-reviewed, even when mode is unchanged', async () => {
  const f = fixture(); await f.controller.show(); f.controller.choose('OFF');
  f.setView(view({ revision: '8', scopeKey: 'different-scope', permissions: [{ id: 'receive', label: 'Receive' }] }));
  await f.controller.save(); assert.equal(f.calls.change.length, 0);
  assert.equal(f.controller.snapshot().view?.scopeKey, 'different-scope'); f.controller.destroy();
});
test('read downgrade or same-revision mode change fails closed', async () => {
  for (const bad of [view({ revision: '6' }), view({ mode: 'OFF' })]) {
    const f = fixture(); await f.controller.show(); f.setView(bad); await f.controller.refresh();
    assert.equal(f.controller.snapshot().view, null); assert.equal(f.controller.snapshot().phase, 'unavailable');
    assert.equal(f.calls.change.length, 0); f.controller.destroy();
  }
});
test('unknown read or missing change capability cannot enable a draft', async () => {
  const f = fixture(); f.setView(view({ changeState: 'unknown' })); await f.controller.show();
  f.controller.choose('OFF'); await f.controller.save(); assert.equal(f.calls.change.length, 0);
  assert.equal(f.controller.snapshot().phase, 'unknown'); f.controller.destroy();
  const g = fixture(); g.setView(view({ canChange: false })); await g.controller.show();
  g.controller.choose('OFF'); await g.controller.save(); assert.equal(g.calls.change.length, 0); g.controller.destroy();
});
test('double save and repeated show during verification cannot restart a change', async () => {
  const f = fixture(), pending = deferred<unknown>(); await f.controller.show();
  f.setChange(() => pending.promise); f.controller.choose('OFF'); const save = f.controller.save();
  await drain(); assert.equal(f.calls.change.length, 1); void f.controller.save(); void f.controller.show();
  await drain(); assert.equal(f.calls.change.length, 1); assert.equal(f.calls.read.length, 2);
  f.setView(view({ mode: 'OFF', revision: '8' })); pending.resolve(null); await save;
  assert.equal(f.controller.snapshot().notice, 'saved'); f.controller.destroy();
});
test('a returned change value is not optimistic policy state', async () => {
  const f = fixture(); await f.controller.show();
  f.setChange(() => view({ mode: 'OFF', revision: '999' })); f.controller.choose('OFF'); await f.controller.save();
  assert.equal(f.controller.snapshot().view?.mode, 'ON'); assert.equal(f.controller.snapshot().view?.revision, '7');
  assert.notEqual(f.controller.snapshot().notice, 'saved'); f.controller.destroy();
});
test('change timeout causes reconciliation and never an automatic retry', async () => {
  const f = fixture(); await f.controller.show();
  f.setChange(() => { f.setView(view({ changeState: 'unknown' })); throw new Error('PRIVATE_BACKEND_DETAIL'); });
  f.controller.choose('OFF'); await f.controller.save();
  assert.equal(f.calls.change.length, 1); assert.equal(f.controller.snapshot().phase, 'unknown');
  assert.equal(f.controller.snapshot().notice, null); assert.doesNotMatch(JSON.stringify(f.controller.snapshot()), /PRIVATE_BACKEND_DETAIL/);
  f.controller.choose('OFF'); await f.controller.save(); await f.controller.refresh();
  assert.equal(f.calls.change.length, 1); assert.equal(f.controller.snapshot().phase, 'unknown');
  f.setView(view({ mode: 'OFF', revision: '8' })); await f.controller.refresh();
  assert.equal(f.controller.snapshot().phase, 'ready'); assert.equal(f.calls.change.length, 1); f.controller.destroy();
});
test('failed post-change read never restores the old policy as current', async () => {
  const f = fixture(); await f.controller.show();
  f.setChange(() => { f.setRead(() => { throw new Error('PRIVATE_FAILURE'); }); });
  f.controller.choose('OFF'); await f.controller.save();
  assert.equal(f.controller.snapshot().phase, 'unknown'); assert.equal(f.controller.snapshot().view, null); f.controller.destroy();
});
test('wrong-account late read is discarded after switch', async () => {
  const f = fixture(), pending = deferred<PolicyView>(); f.setRead(() => pending.promise);
  const first = f.controller.show(); await drain(); f.switchAccount(); pending.resolve(view());
  await first; await drain(); assert.equal(f.controller.snapshot().view, null); assert.equal(f.calls.change.length, 0); f.controller.destroy();
});
test('logout clears identity and scope before late results arrive', async () => {
  const f = fixture(), pending = deferred<PolicyView>(); await f.controller.show();
  f.setRead(() => pending.promise); const refresh = f.controller.refresh(); await drain(); f.logout();
  assert.equal(f.controller.snapshot().view, null); pending.resolve(view()); await refresh; await drain();
  assert.equal(f.controller.snapshot().view, null); f.controller.destroy();
});
test('account switch during asynchronous auth check prevents a policy request', async () => {
  const f = fixture(), pending = deferred<void>(); f.setCheck(() => pending.promise);
  const loading = f.controller.show(); await drain(); f.logout(); pending.resolve(undefined); await loading; await drain();
  assert.equal(f.calls.read.length, 0); assert.equal(f.calls.change.length, 0); f.controller.destroy();
});
test('adapter replacement during a read refuses a late response', async () => {
  const f = fixture(), pending = deferred<PolicyView>(); f.setRead(() => pending.promise);
  const loading = f.controller.show(); await drain(); f.unavailable(); pending.resolve(view()); await loading;
  assert.equal(f.controller.snapshot().view, null); f.controller.destroy();
});
test('navigation cancels pending verification; reopening waits and reads server state once', async () => {
  const f = fixture(), pending = deferred<unknown>(); await f.controller.show();
  f.setChange(() => pending.promise); f.controller.choose('OFF'); const saving = f.controller.save(); await drain();
  assert.equal(f.calls.change.length, 1); f.controller.hide();
  assert.equal(f.calls.change[0]?.signal.aborted, true); assert.equal(f.controller.snapshot().view, null);
  const showing = f.controller.show(); await drain(); assert.equal(f.calls.read.length, 2);
  f.setView(view({ mode: 'OFF', revision: '8' })); pending.resolve(null); await Promise.all([saving, showing]);
  assert.equal(f.calls.change.length, 1); assert.equal(f.controller.snapshot().view?.mode, 'OFF');
  assert.equal(f.calls.read.length, 3); f.controller.destroy();
});
test('cancel during a change does not assert cancellation or start another write', async () => {
  const f = fixture(), pending = deferred<unknown>(); await f.controller.show();
  f.setChange(() => pending.promise); f.controller.choose('OFF'); const saving = f.controller.save(); await drain();
  const cancel = f.controller.cancel(); await drain();
  assert.equal(f.controller.snapshot().phase, 'reconciling'); assert.equal(f.controller.snapshot().view, null);
  assert.equal(f.calls.change[0]?.signal.aborted, true); f.controller.choose('ON'); await f.controller.save();
  f.setView(view({ changeState: 'unknown' })); pending.resolve(null); await Promise.all([saving, cancel]);
  assert.equal(f.controller.snapshot().phase, 'unknown'); assert.equal(f.calls.change.length, 1); f.controller.destroy();
});
test('unavailable bridge creates no policy call and no fabricated saved ON default', async () => {
  const f = fixture(); f.unavailable(); await f.controller.show();
  assert.equal(f.controller.snapshot().phase, 'unavailable'); assert.equal(f.controller.snapshot().view, null);
  assert.equal(f.calls.read.length, 0); assert.equal(f.calls.change.length, 0); f.controller.destroy();
});
test('destroy removes the session listener and discards late reads', async () => {
  const f = fixture(), pending = deferred<PolicyView>(); f.setRead(() => pending.promise);
  const loading = f.controller.show(); await drain(); f.controller.destroy();
  assert.equal(f.listenerCount(), 0); pending.resolve(view()); await loading;
  assert.equal(f.controller.snapshot().phase, 'hidden'); assert.equal(f.controller.snapshot().view, null);
});

class Element {
  id = ''; className = ''; hidden = false; disabled = false; type = ''; isConnected = true;
  parentElement: Element | null = null; children: Element[] = []; style: Record<string, string> = {};
  private ownText = ''; private attributes = new Map<string, string>();
  private handlers = new Map<string, Set<() => void>>();
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.ownText = value; this.replaceChildren(); }
  append(...children: Element[]) { for (const child of children) { child.parentElement = this; child.isConnected = this.isConnected; this.children.push(child); } }
  replaceChildren(...children: Element[]) { for (const child of this.children) { child.parentElement = null; child.isConnected = false; } this.children = []; this.append(...children); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
  querySelectorAll(selector: string): Element[] { return selector === '*' ? this.children.flatMap(child => [child, ...child.querySelectorAll('*')]) : []; }
  addEventListener(type: string, handler: () => void) { let set = this.handlers.get(type); if (!set) { set = new Set(); this.handlers.set(type, set); } set.add(handler); }
  removeEventListener(type: string, handler: () => void) { this.handlers.get(type)?.delete(handler); }
  emit(type: string) { for (const handler of this.handlers.get(type) ?? []) handler(); }
  click() { if (!this.disabled) this.emit('click'); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; this.isConnected = false; }
}
function mounted() {
  const f = fixture(); f.controller.destroy();
  const host = new Element(), window = new Element(); host.id = 'task-verification-policy-settings';
  const document = Object.assign(new Element(), { visibilityState: 'visible', documentElement: { lang: 'en' },
    createElement: () => new Element(), getElementById: (id: string) => [host, ...host.querySelectorAll('*')].find(element => element.id === id) });
  const options = { document, window, walletLogin: f.walletLogin, getPolicyClient: f.getPolicyClient };
  const api = mountTaskVerificationPolicy(options); assert.ok(api);
  const byId = (id: string) => { const item = document.getElementById(`task-verification-policy-${id}`); assert.ok(item); return item; };
  return { ...f, host, window, document, options, api, byId };
}
test('mount is idempotent and supplies an accessible switch with saved and draft states', async () => {
  const f = mounted(); assert.equal(mountTaskVerificationPolicy(f.options), f.api); assert.equal(f.host.children.length, 1);
  await f.api.show(); const toggle = f.byId('toggle');
  assert.equal(toggle.getAttribute('role'), 'switch'); assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(toggle.style.background, 'var(--accent)'); toggle.click();
  assert.equal(toggle.getAttribute('aria-checked'), 'false'); assert.equal(toggle.style.background, 'var(--line)');
  assert.equal(f.api.snapshot().view?.mode, 'ON'); assert.equal(f.calls.change.length, 0);
  assert.match(f.byId('draft').textContent, /two independent/); f.api.destroy();
});
test('six authored locale catalogs have equal keys and language switching is presentation-only', async () => {
  assert.deepEqual(POLICY_LOCALES, ['en', 'zh-Hans', 'zh-Hant', 'fr', 'es', 'ja']);
  const english = POLICY_CATALOGS.en; assert.ok(english); const keys = Object.keys(english).sort();
  for (const locale of POLICY_LOCALES) {
    const catalog = POLICY_CATALOGS[locale]; assert.ok(catalog); assert.deepEqual(Object.keys(catalog).sort(), keys);
    for (const key of keys) assert.equal(typeof policyText(key, { email: 'm***@example.invalid' }, locale), 'string');
  }
  const f = mounted(); await f.api.show(); f.byId('toggle').click();
  const reads = f.calls.read.length, changes = f.calls.change.length;
  for (const locale of POLICY_LOCALES) {
    setLocale(locale, { document: f.document, persist: false });
    assert.equal(f.byId('title').textContent, policyText('title', {}, locale));
    assert.equal(f.api.snapshot().draftMode, 'OFF'); assert.equal(f.calls.read.length, reads); assert.equal(f.calls.change.length, changes);
    assert.ok(f.host.textContent.includes(context.account));
  }
  setLocale('en', { document: f.document, persist: false }); f.api.destroy();
});
test('DOM renders only allowlisted facts, no raw context, scope key or error details', async () => {
  const f = mounted(); f.setView(view({ walletLabel: '<b>literal-wallet</b>' })); await f.api.show();
  assert.ok(f.host.textContent.includes('<b>literal-wallet</b>'));
  for (const hidden of [context.origin, 'synthetic-policy-scope', 'synthetic-session']) assert.ok(!f.host.textContent.includes(hidden));
  f.setRead(() => { throw new Error('PRIVATE_ENDPOINT_SECRET'); }); f.byId('refresh').click(); await drain();
  assert.ok(!f.host.textContent.includes('PRIVATE_ENDPOINT_SECRET')); assert.ok(!f.host.textContent.includes(context.account));
  f.api.destroy();
});
test('visibility loss clears context; restoration rereads instead of restoring browser state', async () => {
  const f = mounted(); await f.api.show(); f.byId('toggle').click();
  f.document.visibilityState = 'hidden'; f.document.emit('visibilitychange');
  assert.equal(f.api.snapshot().view, null); assert.equal(f.api.snapshot().draftMode, null);
  assert.ok(!f.host.textContent.includes(context.account));
  f.setView(view({ mode: 'OFF', revision: '8' })); f.document.visibilityState = 'visible'; f.document.emit('visibilitychange'); await drain();
  assert.equal(f.api.snapshot().view?.mode, 'OFF'); assert.equal(f.calls.change.length, 0); f.api.destroy();
});
test('window focus does not cancel a draft or pending human ceremony', async () => {
  const f = mounted(), pending = deferred<unknown>(); await f.api.show(); f.byId('toggle').click();
  f.window.emit('focus'); await drain(); assert.equal(f.api.snapshot().draftMode, 'OFF'); assert.equal(f.calls.read.length, 1);
  f.setChange(() => pending.promise); f.byId('save').click(); await drain(); f.window.emit('focus'); await drain();
  assert.equal(f.calls.change.length, 1); assert.equal(f.calls.change[0]?.signal.aborted, false);
  f.setView(view({ mode: 'OFF', revision: '8' })); pending.resolve(null); await drain(); f.api.destroy();
});

test('missing inventory is explicit, not an extra gate on a source-qualified owner setting', () => {
  const decoded = validateTaskVerificationPolicyView(view({ permissions: null, canChange: false }), initialSession);
  assert.equal(decoded.permissions, null); assert.equal(decoded.canChange, false);
  const qualified = validateTaskVerificationPolicyView(view({ permissions: null, canChange: true }), initialSession);
  assert.equal(qualified.permissions, null); assert.equal(qualified.canChange, true);
});

