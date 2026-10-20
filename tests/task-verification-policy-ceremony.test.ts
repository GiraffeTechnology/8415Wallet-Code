/** Synthetic dialog/transport-seam tests only; not API-wire or factor acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTaskVerificationPolicyChange } from '../web/task-verification-policy-ceremony.mjs';
import { createTaskVerificationPolicyClient } from '../web/task-verification-policy-client.mjs';

type UiEvent = { preventDefault(): void };
class Node {
  children: Node[] = []; parentElement: Node | null = null; isConnected = true;
  type = ''; id = ''; className = ''; hidden = false; disabled = false; required = false;
  style: Record<string, string> = {};
  autocomplete = ''; inputMode = ''; pattern = ''; minLength = 0; maxLength = 0; method = '';
  private inputValue = ''; private ownText = ''; private attrs = new Map<string, string>();
  private handlers = new Map<string, Set<(event: UiEvent) => void>>();
  readonly tag: string;
  constructor(tag: string) { this.tag = tag; }
  get value(): string { return this.inputValue || (this.tag === 'select' ? this.children[0]?.value ?? '' : ''); }
  set value(value: string) { this.inputValue = value; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.ownText = value; this.replaceChildren(); }
  append(...children: Node[]) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  replaceChildren() { for (const child of this.children) { child.isConnected = false; child.parentElement = null; } this.children = []; }
  querySelectorAll(selector: string): Node[] { return selector === '*' ? this.children.flatMap(child => [child, ...child.querySelectorAll('*')]) : []; }
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  removeAttribute(key: string) { this.attrs.delete(key); }
  getAttribute(key: string) { return this.attrs.get(key) ?? null; }
  addEventListener(type: string, handler: (event: UiEvent) => void) { let set = this.handlers.get(type); if (!set) { set = new Set(); this.handlers.set(type, set); } set.add(handler); }
  emit(type: string) { for (const handler of this.handlers.get(type) ?? []) handler({ preventDefault() {} }); }
  showModal() {} focus() {} close() { this.emit('close'); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.isConnected = false; }
}
const drain = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const context = { origin: 'https://wallet.example.invalid', tenant: 'synthetic',
  account: '0x1111111111111111111111111111111111111111', chainId: '1' };
function setup({ mode = 'OFF', walletOnly = false } = {}) {
  let time = 1000, cancelled = false, timerId = 0;
  const timers = new Map<number, () => void>();
  const document = { body: new Node('body'), activeElement: null, createElement: (tag: string) => new Node(tag) };
  const window = { setTimeout(callback: () => void) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id: number) { timers.delete(id); } };
  const abort = new AbortController(), binding = { id: 1 }, session = { ...context, serverId: 'synthetic-session' };
  const calls: { action: string; keys: string[]; mode?: unknown }[] = [], signed: unknown[] = [];
  const account = { ...context, registration: { complete: true, emailOtpAvailable: true },
    methods: { password: { bound: !walletOnly, enabled: !walletOnly }, wallet: { bound: true, enabled: true } },
    // These existing method-management gates must not become a third factor.
    management: { freshIndependentLogin: false, existingCodeRequired: true },
    authenticator: { enrolled: true }, recovery: { configured: true } };
  const walletLogin = { assert(candidate: unknown) { assert.equal(candidate, binding); assert.equal(cancelled, false); return session; },
    async check() { assert.equal(cancelled, false); },
    provider() { return { async request(value: unknown) { signed.push(value); return '0x' + '11'.repeat(65); } }; } };
  // Deliberately not a proposed wire encoding: the source-owned decoder seam
  // supplies opaque values and remains unavailable in normal startup.
  const prepared = { changeId: 'synthetic-change-id', changeDigest: 'synthetic-change-digest', identityMethod: walletOnly ? 'wallet' : 'password',
    emailMasked: 'm***@example.invalid', issuedAt: 1000, expiresAt: 301000,
    message: walletOnly ? 'SYNTHETIC EXACT POLICY MESSAGE; not a transaction' : null };
  let rejectPrepare = false, rejectConfirm = false, commits = 0, confirms = 0;
  const client = { async account() { return account; },
    async taskVerification(action: string, body: Record<string, unknown>) {
      calls.push({ action, keys: Object.keys(body), ...(action === 'prepare' ? { mode: body.mode } : {}) });
      if (action === 'prepare') { if (rejectPrepare) throw new Error('PREPARE_REFUSED'); return { synthetic: 'prepared' }; }
      if (action === 'verify') {
        if (walletOnly) assert.equal(typeof body.signature, 'string'); else assert.equal(body.password, 'synthetic-password');
        return { synthetic: 'email-challenge' };
      }
      if (action === 'confirm') { confirms++; assert.equal(body.code, '12345678'); if (rejectConfirm) throw new Error('UNKNOWN_CONFIRM_OUTCOME'); return { synthetic: 'committed' }; }
      if (action === 'cancel') {
        assert.deepEqual(body, { protocol: '8415-task-policy-change-wire/1',
          changeId: prepared.changeId, changeDigest: prepared.changeDigest, expectedRevision: '7' });
        return { cancelled: true };
      }
      throw new Error('UNEXPECTED_ACTION');
    } };
  const reviewed = { mode: mode === 'OFF' ? 'ON' : 'OFF', revision: '7', walletLabel: 'Synthetic wallet', context,
    agentLabel: 'Synthetic Agent', agentId: 'synthetic-agent', scopeLabel: 'Existing valid grants only' };
  const decoders = { prepared() { return prepared; }, verified() { return { ...prepared, digits: 8 }; }, committed(value: unknown) { return value; } };
  const options = { document, window, walletLogin, client, binding, signal: abort.signal, reviewed, mode, decoders,
    now: () => time, onConfirmDispatch() { confirms += 0; }, onCommitted() { commits++; } };
  const find = (tag: string) => { const element = document.body.querySelectorAll('*').find(node => node.tag === tag); assert.ok(element, tag); return element; };
  return { document, window, walletLogin, client, binding, abort, prepared, reviewed, options, calls, signed, find,
    commits: () => commits, confirms: () => confirms,
    expire() { time = 301000; for (const callback of [...timers.values()]) callback(); },
    logout() { cancelled = true; abort.abort(); },
    rejectPrepare() { rejectPrepare = true; }, rejectConfirm() { rejectConfirm = true; },
  };
}
async function identity(f: ReturnType<typeof setup>) {
  await drain(); const password = f.find('input'); password.value = 'synthetic-password';
  f.find('form').emit('submit'); await drain(); assert.equal(password.value, '');
  assert.equal(f.signed.length, 0); assert.deepEqual(f.calls.map(call => call.action), ['prepare']);
  f.find('form').emit('submit'); await drain(); return password;
}
async function email(f: ReturnType<typeof setup>) {
  const code = f.find('input'); assert.equal(code.type, 'password'); assert.equal(code.maxLength, 8);
  code.value = '12345678'; f.find('form').emit('submit'); await drain(); assert.equal(code.value, '');
}

for (const mode of ['ON', 'OFF']) test(`${mode}: password then verified email, no third factor or retired on route`, async () => {
  const f = setup({ mode }); const result = runTaskVerificationPolicyChange(f.options);
  await identity(f); await email(f); await result;
  assert.deepEqual(f.calls.map(call => call.action), ['prepare', 'verify', 'confirm']);
  assert.equal(f.calls[0]?.mode, mode); assert.deepEqual(f.calls[0]?.keys, ['expectedRevision', 'identityMethod', 'mode']);
  assert.deepEqual(f.calls[1]?.keys, ['changeId', 'changeDigest', 'password']);
  assert.equal(f.signed.length, 0); assert.equal(f.commits(), 1); assert.equal(f.document.body.children.length, 0);
});
test('wallet factor signs only the decoder-approved policy message, then requires email', async () => {
  const f = setup({ walletOnly: true }); const result = runTaskVerificationPolicyChange(f.options);
  await drain(); f.find('form').emit('submit'); await drain();
  assert.equal(f.signed.length, 0); assert.equal(f.find('pre').textContent, f.prepared.message);
  f.find('form').emit('submit'); await drain();
  assert.equal(f.signed.length, 1); assert.deepEqual(f.calls.map(call => call.action), ['prepare', 'verify']);
  const request = f.signed[0] as { method: string; params: string[] };
  assert.equal(request.method, 'personal_sign'); assert.equal(request.params[1], context.account);
  assert.equal(Buffer.from(request.params[0]!.slice(2), 'hex').toString(), f.prepared.message);
  await email(f); await result; assert.equal(f.commits(), 1);
});
test('invalid email code stays local and never dispatches confirm', async () => {
  const f = setup(); const pending = runTaskVerificationPolicyChange(f.options); const rejection = assert.rejects(pending);
  await identity(f); const code = f.find('input'); code.value = '123'; f.find('form').emit('submit'); await drain();
  assert.equal(f.confirms(), 0); f.abort.abort(); await rejection;
  assert.equal(code.value, ''); assert.equal(f.calls.filter(call => call.action === 'cancel').length, 1);
});
test('cancelled identity prompt clears input and never prepares a change', async () => {
  const f = setup(); const pending = runTaskVerificationPolicyChange(f.options); const rejection = assert.rejects(pending);
  await drain(); const password = f.find('input'); password.value = 'synthetic-password'; f.abort.abort(); await rejection;
  assert.equal(password.value, ''); assert.equal(f.calls.length, 0); assert.equal(f.document.body.children.length, 0);
});
test('expiry clears the email input and sends only one cancellation', async () => {
  const f = setup(); const pending = runTaskVerificationPolicyChange(f.options); const rejection = assert.rejects(pending);
  await identity(f); const code = f.find('input'); code.value = '12345678'; f.expire(); await rejection;
  assert.equal(code.value, ''); assert.equal(f.confirms(), 0);
  assert.deepEqual(f.calls.map(call => call.action), ['prepare', 'verify', 'cancel']);
});
test('logout cannot cancel another account session and clears the dialog', async () => {
  const f = setup(); const pending = runTaskVerificationPolicyChange(f.options); const rejection = assert.rejects(pending);
  await identity(f); f.logout(); await rejection;
  assert.equal(f.calls.some(call => call.action === 'cancel'), false); assert.equal(f.document.body.children.length, 0);
});
test('confirm uncertainty is not retried or labelled a committed change', async () => {
  const f = setup(); f.rejectConfirm(); const pending = runTaskVerificationPolicyChange(f.options); const rejection = assert.rejects(pending);
  await identity(f); await email(f); await rejection;
  assert.equal(f.confirms(), 1); assert.equal(f.commits(), 0);
  assert.deepEqual(f.calls.map(call => call.action), ['prepare', 'verify', 'confirm', 'cancel']);
});
test('prepare rejection clears identity value without signing or submitting another factor', async () => {
  const f = setup(); f.rejectPrepare(); const pending = runTaskVerificationPolicyChange(f.options); const rejection = assert.rejects(pending);
  await drain(); const password = f.find('input'); password.value = 'synthetic-password';
  f.find('form').emit('submit'); await rejection; assert.equal(password.value, '');
  // No decoded reference exists: a guessed/session-wide cancel could delete another draft.
  assert.deepEqual(f.calls.map(call => call.action), ['prepare']); assert.equal(f.signed.length, 0);
});
test('duplicate ceremony is rejected while the first human prompt is active', async () => {
  const f = setup(); const pending = runTaskVerificationPolicyChange(f.options); const rejection = assert.rejects(pending);
  await drain(); await assert.rejects(runTaskVerificationPolicyChange(f.options), /TASK_POLICY_CEREMONY_BUSY/);
  f.abort.abort(); await rejection; assert.equal(f.calls.length, 0);
});
test('factory refuses an explicitly absent source decoder', () => {
  const f = setup();
  assert.equal(createTaskVerificationPolicyClient({ client: f.client, walletLogin: f.walletLogin,
    document: f.document, window: f.window, wire: null }), null);
  assert.equal(f.calls.length, 0);
});
test('cancelling exact ON review clears password and releases the lock without either factor submission', async () => {
  const f = setup({ mode: 'ON' }), pending = runTaskVerificationPolicyChange(f.options), rejection = assert.rejects(pending);
  await drain(); const password = f.find('input'); password.value = 'synthetic-password';
  f.find('form').emit('submit'); await drain(); assert.equal(password.value, '');
  assert.deepEqual(f.calls.map(call => call.action), ['prepare']);
  f.abort.abort(); await rejection;
  assert.deepEqual(f.calls.map(call => call.action), ['prepare', 'cancel']);
  assert.equal(f.signed.length, 0); assert.equal(f.commits(), 0); assert.equal(f.document.body.children.length, 0);
  const replacementAbort = new AbortController();
  const next = runTaskVerificationPolicyChange({ ...f.options, signal: replacementAbort.signal });
  const cancelledAgain = assert.rejects(next); await drain(); assert.ok(f.find('form'));
  replacementAbort.abort(); await cancelledAgain;
});
test('rejected prepared mode decoder prevents wallet signing and both verification calls', async () => {
  const f = setup({ mode: 'ON', walletOnly: true });
  const pending = runTaskVerificationPolicyChange({ ...f.options, decoders: { ...f.options.decoders,
    prepared() { throw new Error('TASK_POLICY_WIRE_REFUSED'); } } });
  const rejection = assert.rejects(pending); await drain(); f.find('form').emit('submit'); await rejection;
  assert.deepEqual(f.calls.map(call => call.action), ['prepare']);
  assert.equal(f.signed.length, 0); assert.equal(f.commits(), 0);
});

