/** Deterministic management-dialog lifecycle tests, not physical-browser acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeMethodChange, commitMethodChange, cancelMethodChangeUi } from '../web/method-change-ui.mjs';
import { setLocale } from '../web/i18n.mjs';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
class Element {
  tagName: string; children: Element[] = []; parentElement: Element | null = null; handlers = new Map<string, Function[]>();
  attributes = new Map<string, string>(); textContent = ''; value = ''; type = ''; hidden = false; open = false; checked = false;
  isConnected = true; className = ''; id = '';
  constructor(tag: string) { this.tagName = tag; }
  append(child: Element) { this.children.push(child); child.parentElement = this; if (this.tagName === 'select' && this.children.length === 1) this.value = child.value; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(name: string, handler: Function) { const values = this.handlers.get(name) ?? []; values.push(handler); this.handlers.set(name, values); }
  fire(name: string) { for (const handler of this.handlers.get(name) ?? []) handler({ preventDefault() {} }); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  focus() {}
  remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}
function all(root: Element): Element[] { return [root, ...root.children.flatMap(all)]; }
async function spin(predicate: () => boolean) { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail('Expected dialog transition did not occur'); }
function fixture(t: any, options: any = {}) {
  const previous = (globalThis as any).document, body = new Element('body');
  (globalThis as any).document = { body, activeElement: null, createElement: (tag: string) => new Element(tag) };
  const state = { origin: 'https://wallet.example.invalid', tenant: 'xiongan', account: `0x${'1'.repeat(40)}`, chainId: '1',
    methods: { password: { bound: !options.passwordless }, wallet: { enabled: true } }, authenticator: { enrolled: !!options.enrolled }, recovery: { configured: !!options.recovery, questionId: 'recovery-phrase' },
    caBindingManagement: 'combined-v1', caBindings: { fingerprints: options.bound ? ['a'.repeat(64)] : [] },
    management: { reauthenticateBy: Date.now() + 300_000 } };
  const calls: any[] = [], signatures: any[] = []; let intent: any, valid = true;
  const client = { async change(action: string, input: any = {}) {
    calls.push({ action, input: structuredClone(input) });
    if (action === 'start') { intent = structuredClone(input); return { ...state, changeId: 'c'.repeat(43), action: intent.action, factor: input.identityMethod,
      message: `Purpose: ${intent.action}; no login or transaction authority\nOrigin: ${state.origin}\nAccount: ${state.account}`,
      emailMasked: 'v***@example.invalid', expiresAt: state.management.reauthenticateBy }; }
    if (action === 'verify') { await options.verifyGate?.(); return { changeId: 'c'.repeat(43), digits: 8, emailMasked: 'v***@example.invalid', expiresAt: state.management.reauthenticateBy }; }
    if (action === 'confirm') { await options.confirmGate?.(); const expiry = Date.now() + 110_000; return { changeProof: 'p'.repeat(43), action: options.wrongAction ?? intent.action, expiresAt: expiry, caMessage: options.badMessage ? 'unbound' : [`Origin: ${state.origin}`, `Tenant: ${state.tenant}`, `Account: ${state.account}`, `Chain ID: ${state.chainId}`, `Purpose: ${intent.action}; no login or transaction authority`, `Request: ${'c'.repeat(43)}`, `Nonce: ${'n'.repeat(43)}`, 'Proof purpose: new CA binding possession only', `Old certificate: ${intent.oldFingerprint ?? 'none'}`, `New certificate: ${intent.newFingerprint}`, `Proof expires: ${new Date(expiry).toISOString()}`].join('\n'),
      newEmailRequired: !!options.newEmail, ...(options.newEmail ? { emailMasked: 'n***@example.invalid' } : {}),
      ...(intent.action.startsWith('totp.') && intent.action !== 'totp.unbind' ? { secret: SECRET, uri: `otpauth://totp/synthetic?secret=${SECRET}` } : {}) }; }
    if (action === 'commit') return { updated: true, loggedOut: true, action: intent.action };
    return { cancelled: true };
  } };
  const provider = { async request(request: any) { signatures.push(request); await options.signatureGate?.(); return `0x${'1'.repeat(130)}`; } };
  const dialog = () => body.children.find(element => element.tagName === 'dialog')!;
  const field = (label: string) => all(dialog()).find(element => element.tagName === 'label' && element.children.some(child => child.textContent === label))?.children.find(child => child.tagName === 'input');
  const choose = (method: string) => { const select = all(dialog()).find(element => element.tagName === 'select')!; select.value = method; select.fire('change'); };
  const submit = () => all(dialog()).find(element => element.tagName === 'form')!.fire('submit');
  const begin = (input: any) => authorizeMethodChange({ client, intent: input, state, provider, isCurrent: () => valid });
  const email = async () => { await spin(() => !!dialog() && !!field('Eight-digit email code')); field('Eight-digit email code')!.value = '12345678'; submit(); };
  t.after(() => { cancelMethodChangeUi(); (globalThis as any).document = previous; setLocale('en', { document: null, persist: false }); });
  return { state, client, calls, signatures, begin, choose, submit, field, dialog, email, revoke: () => { valid = false; }, isCurrent: () => valid };
}


async function authorized(f: any, action = 'ca.initial') {
  const pending = f.begin({ action, ...(action !== 'ca.initial' ? { oldFingerprint: 'a'.repeat(64) } : {}), ...(action !== 'ca.unbind' ? { newFingerprint: 'b'.repeat(64) } : {}) });
  f.choose('password'); f.field('Original password')!.value = 'synthetic'; f.submit(); await f.email(); return pending;
}
function bridge(gate?: () => Promise<void>) {
  const calls: any[] = []; return { calls, version: '8415wallet-ca/1', async signChallenge(value: any) {
    calls.push(value); await gate?.(); return { signature: 'synthetic-signature', certificateChain: 'synthetic-certificate', algorithm: 'RSA-PSS-SHA256' };
  } };
}
for (const action of ['ca.initial', 'ca.replace']) test(`${action} uses combined proof then signs exact bound CA message once`, async t => {
  const f = fixture(t, { bound: action === 'ca.replace' }), proof = await authorized(f, action), caBridge = bridge();
  await commitMethodChange({ client: f.client, state: f.state, proof, caBridge, isCurrent: f.isCurrent });
  assert.equal(caBridge.calls.length, 1); assert.equal(caBridge.calls[0].message, proof.caMessage); assert.ok(Object.isFrozen(caBridge.calls[0]));
  assert.deepEqual(f.calls.find(c => c.action === 'commit').input, { changeProof: proof.changeProof, signature: 'synthetic-signature', certificateChain: 'synthetic-certificate', algorithm: 'RSA-PSS-SHA256' });
  await assert.rejects(commitMethodChange({ client: f.client, state: f.state, proof, caBridge, isCurrent: f.isCurrent }), /AUTH_BUSY/);
  assert.equal(caBridge.calls.length, 1);
});
test('CA unbind targets exact existing certificate and requires no new bridge signing', async t => {
  const f = fixture(t, { bound: true }), proof = await authorized(f, 'ca.unbind'), caBridge = bridge();
  await commitMethodChange({ client: f.client, state: f.state, proof, caBridge, isCurrent: f.isCurrent });
  assert.equal(caBridge.calls.length, 0); assert.equal(f.calls[0].input.oldFingerprint, 'a'.repeat(64));
  assert.deepEqual(f.calls.find(c => c.action === 'commit').input, { changeProof: proof.changeProof });
});
for (const reason of ['cancel', 'context', 'duplicate']) test(`late hardware proof cannot commit after ${reason}`, async t => {
  const f = fixture(t), proof = await authorized(f); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), caBridge = bridge(() => gate);
  const pending = commitMethodChange({ client: f.client, state: f.state, proof, caBridge, isCurrent: f.isCurrent });
  const rejected = reason === 'duplicate' ? null : assert.rejects(pending, /LOGIN_CANCELLED/);
  await spin(() => caBridge.calls.length === 1);
  if (reason === 'cancel') cancelMethodChangeUi();
  if (reason === 'context') f.revoke();
  if (reason === 'duplicate') await assert.rejects(commitMethodChange({ client: f.client, state: f.state, proof, caBridge, isCurrent: f.isCurrent }), /AUTH_BUSY/);
  release(); if (rejected) await rejected; else await pending;
  assert.equal(f.calls.filter(c => c.action === 'commit').length, reason === 'duplicate' ? 1 : 0);
});
test('unsupported CA bridge cannot submit a binding', async t => {
  const f = fixture(t), proof = await authorized(f);
  await assert.rejects(commitMethodChange({ client: f.client, state: f.state, proof, caBridge: {}, isCurrent: f.isCurrent }), /LOGIN_CA_BRIDGE_REQUIRED/);
  assert.equal(f.calls.some(c => c.action === 'commit'), false);
});
test('mismatched CA server message rejected before bridge use', async t => {
  const f = fixture(t, { badMessage: true }); await assert.rejects(authorized(f), /LOGIN_CHALLENGE_BINDING_REFUSED/);
});
test('unknown old fingerprint and unavailable capability rejected before prompting', async t => {
  const f = fixture(t, { bound: true });
  await assert.rejects(f.begin({ action: 'ca.unbind', oldFingerprint: 'c'.repeat(64) }), /AUTH_CHANGE_INPUT_REFUSED/);
  f.state.caBindingManagement = null as any;
  await assert.rejects(f.begin({ action: 'ca.unbind', oldFingerprint: 'a'.repeat(64) }), /AUTH_CHANGE_INPUT_REFUSED/);
  assert.equal(f.calls.length, 0); assert.equal(f.dialog(), undefined);
});

test('expired CA proof never asks hardware to sign', async t => {
  const f = fixture(t), proof = await authorized(f), caBridge = bridge(); proof.expiresAt = Date.now() - 1;
  await assert.rejects(commitMethodChange({ client: f.client, state: f.state, proof, caBridge, isCurrent: f.isCurrent }), /AUTH_SETUP_EXPIRED/);
  assert.equal(caBridge.calls.length, 0); assert.equal(f.calls.some(c => c.action === 'commit'), false);
});
test('changed account binding refuses hardware signing even with a live caller', async t => {
  const f = fixture(t), proof = await authorized(f), caBridge = bridge(); f.state.account = `0x${'2'.repeat(40)}`;
  await assert.rejects(commitMethodChange({ client: f.client, state: f.state, proof, caBridge, isCurrent: f.isCurrent }), /LOGIN_CHALLENGE_BINDING_REFUSED/);
  assert.equal(caBridge.calls.length, 0);
});
test('certificate lifecycle controls have authored labels in every existing locale', async () => {
  const path = '../web/locales/auth-management.mjs';
  const { default: locales } = await import(path) as { default: Record<string, Record<string, string>> };
  for (const catalog of Object.values(locales)) for (const key of ['ca.title', 'ca.help', 'ca.old', 'ca.new', 'ca.initial', 'ca.replace', 'ca.unbind', 'ca.invalid', 'ca.failed', 'ca.checkState', 'oldFingerprint', 'newFingerprint'])
    { const value = catalog[`change.${key}`]; assert.ok(typeof value === 'string' && value.length > 0); }
});

test('non-CA TOTP wrong-code refusal retains proof for existing correct-code retry', async t => {
  const f = fixture(t); const pending = f.begin({ action: 'totp.initial' });
  f.choose('password'); f.field('Original password')!.value = 'synthetic'; f.submit(); await f.email(); const proof = await pending;
  const original = f.client.change.bind(f.client); let attempts = 0;
  f.client.change = async (action: string, input: any) => {
    if (action === 'commit' && ++attempts === 1) throw new Error('AUTH_CHANGE_REFUSED');
    return original(action, input);
  };
  await assert.rejects(commitMethodChange({ client: f.client, state: f.state, proof, code: '000000', isCurrent: f.isCurrent }), /AUTH_CHANGE_REFUSED/);
  assert.equal(f.calls.some(c => c.action === 'cancel'), false);
  const result = await commitMethodChange({ client: f.client, state: f.state, proof, code: '123456', isCurrent: f.isCurrent });
  assert.equal(result.updated, true); assert.equal(attempts, 2);
});
