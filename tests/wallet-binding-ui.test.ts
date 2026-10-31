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
    methods: { password: { bound: !options.passwordless }, wallet: { enabled: !!options.bound } }, authenticator: { enrolled: !!options.enrolled }, recovery: { configured: !!options.recovery, questionId: 'recovery-phrase' },
    walletBindingManagement: 'same-account-v1', walletBinding: { account: `0x${'1'.repeat(40)}`, chainId: '1', bound: !!options.bound }, caBindingManagement: 'combined-v1', caBindings: { fingerprints: options.bound ? ['a'.repeat(64)] : [] },
    management: { reauthenticateBy: Date.now() + 300_000 } };
  const calls: any[] = [], signatures: any[] = []; let intent: any, valid = true;
  const client = { async change(action: string, input: any = {}) {
    calls.push({ action, input: structuredClone(input) });
    if (action === 'start') { intent = structuredClone(input); return { ...state, changeId: 'c'.repeat(43), action: intent.action, factor: input.identityMethod,
      message: `Purpose: ${intent.action}; no login or transaction authority\nOrigin: ${state.origin}\nAccount: ${state.account}`,
      emailMasked: 'v***@example.invalid', expiresAt: state.management.reauthenticateBy }; }
    if (action === 'verify') { await options.verifyGate?.(); return { changeId: 'c'.repeat(43), digits: 8, emailMasked: 'v***@example.invalid', expiresAt: state.management.reauthenticateBy }; }
    if (action === 'confirm') { await options.confirmGate?.(); const expiry = Date.now() + 110_000; return { changeProof: 'p'.repeat(43), action: options.wrongAction ?? intent.action, expiresAt: expiry, walletMessage: options.badMessage ? 'unbound' : [`Origin: ${state.origin}`, `Tenant: ${state.tenant}`, `Account: ${state.account}`, `Chain ID: ${state.chainId}`, `Purpose: ${intent.action}; no login or transaction authority`, `Request: ${'c'.repeat(43)}`, `Nonce: ${'n'.repeat(43)}`, 'Proof purpose: same-account wallet binding possession only', `Exact binding: ${'a'.repeat(64)}`, `New wallet: ${state.account}`, `Proof expires: ${new Date(expiry).toISOString()}`].join('\n'),
      newEmailRequired: !!options.newEmail, ...(options.newEmail ? { emailMasked: 'n***@example.invalid' } : {}),
      ...(intent.action.startsWith('totp.') && intent.action !== 'totp.unbind' ? { secret: SECRET, uri: `otpauth://totp/synthetic?secret=${SECRET}` } : {}) }; }
    if (action === 'commit') return { updated: true, loggedOut: true, action: intent.action };
    return { cancelled: true };
  } };
  const provider = { async request(request: any) { if(request.method === 'eth_chainId') return options.wrongChain ? '0x2' : '0x1'; if(request.method === 'eth_accounts') return [options.wrongAccount ? `0x${'2'.repeat(40)}` : state.account]; signatures.push(request); await options.signatureGate?.(); return `0x${'1'.repeat(130)}`; } };
  const dialog = () => body.children.find(element => element.tagName === 'dialog')!;
  const field = (label: string) => all(dialog()).find(element => element.tagName === 'label' && element.children.some(child => child.textContent === label))?.children.find(child => child.tagName === 'input');
  const choose = (method: string) => { const select = all(dialog()).find(element => element.tagName === 'select')!; select.value = method; select.fire('change'); };
  const submit = () => all(dialog()).find(element => element.tagName === 'form')!.fire('submit');
  const begin = (input: any) => authorizeMethodChange({ client, intent: input, state, provider, isCurrent: () => valid });
  const email = async () => { await spin(() => !!dialog() && !!field('Eight-digit email code')); field('Eight-digit email code')!.value = '12345678'; submit(); };
  t.after(() => { cancelMethodChangeUi(); (globalThis as any).document = previous; setLocale('en', { document: null, persist: false }); });
  return { state, client, provider, calls, signatures, begin, choose, submit, field, dialog, email, revoke: () => { valid = false; }, isCurrent: () => valid };
}

async function authorized(f:any, action='wallet.initial') {const pending=f.begin({action});f.choose('password');f.field('Original password')!.value='synthetic';f.submit();await f.email();return pending;}
const commit=(f:any,proof:any)=>commitMethodChange({client:f.client,state:f.state,proof,provider:f.provider,isCurrent:f.isCurrent});
test('same-account rebind UI signs only exact challenge after combined proof, once',async t=>{
 const f=fixture(t),proof=await authorized(f);assert.equal(f.signatures.length,0);await commit(f,proof);assert.equal(f.signatures.length,1);
 const message=Buffer.from(f.signatures[0].params[0].slice(2),'hex').toString();assert.equal(message,proof.walletMessage);assert.equal(f.signatures[0].params[1],f.state.account);
 assert.equal(f.calls.filter(c=>c.action==='commit').length,1);await assert.rejects(commit(f,proof),/AUTH_BUSY/);
});
test('unbind UI needs combined proof but no new signer prompt',async t=>{const f=fixture(t,{bound:true}),proof=await authorized(f,'wallet.unbind');await commit(f,proof);assert.equal(f.signatures.length,0);assert.equal(f.calls.filter(c=>c.action==='commit').length,1);});
for(const variant of ['wrongChain','wrongAccount'])test(`rebind UI rejects provider ${variant}`,async t=>{const f=fixture(t,{[variant]:true}),proof=await authorized(f);await assert.rejects(commit(f,proof),/LOGIN_CHALLENGE_BINDING_REFUSED/);assert.equal(f.signatures.length,0);assert.equal(f.calls.filter(c=>c.action==='commit').length,0);});
test('rebind UI rejects mutated challenge before wallet prompt',async t=>{const f=fixture(t),proof=await authorized(f);proof.walletMessage+='altered';await assert.rejects(commit(f,proof),/LOGIN_CHALLENGE_BINDING_REFUSED/);assert.equal(f.signatures.length,0);});
test('rebind UI closes while wallet prompt pending without committing late signature',async t=>{
 let release:()=>void=()=>{},entered:()=>void=()=>{};const wait=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const f=fixture(t,{signatureGate:async()=>{entered();await wait;}}),proof=await authorized(f);const pending=commit(f,proof);await ready;cancelMethodChangeUi();release();await assert.rejects(pending,/LOGIN_CANCELLED/);assert.equal(f.calls.filter(c=>c.action==='commit').length,0);
});
test('rebind UI current identity changes while signature pending cannot commit',async t=>{
 let release:()=>void=()=>{},entered:()=>void=()=>{};const wait=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const f=fixture(t,{signatureGate:async()=>{entered();await wait;}}),proof=await authorized(f);const pending=commit(f,proof);await ready;f.revoke();release();await assert.rejects(pending,/LOGIN_CANCELLED/);assert.equal(f.calls.filter(c=>c.action==='commit').length,0);
});
test('same-account-only UI rejects replacement or added identity fields before sending',async t=>{const f=fixture(t);for(const intent of [{action:'wallet.replace'},{action:'wallet.initial',newAccount:`0x${'2'.repeat(40)}`}])await assert.rejects(f.begin(intent),/AUTH_CHANGE_INPUT_REFUSED/);assert.equal(f.calls.length,0);});
