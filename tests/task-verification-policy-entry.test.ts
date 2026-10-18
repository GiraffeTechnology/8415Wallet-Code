/** Source-prepared integration tests. Execution belongs to the authorized Linux owner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectTaskVerificationPolicySettings, type PolicySettingsEntryOptions,
  type PolicySettingsMountOptions } from '../web/task-verification-policy-entry.mjs';

function fixture({ initialOpen = false, missingHost = false } = {}) {
  const host = { hidden: true }, management = { hidden: false }, events: string[] = [];
  const listeners = new Set<(open: boolean) => void>();
  let mounted: PolicySettingsMountOptions | null = null, client: unknown = null, adapter: unknown = null;
  const document = { getElementById: (id: string) => id === 'auth-management' ? management :
    id === 'task-verification-policy-settings' && !missingHost ? host : null };
  const args: PolicySettingsEntryOptions = { document, window: {}, walletLogin: {},
    currentAccountClient() { if (client instanceof Error) throw client; return client; },
    createTaskVerificationPolicyClient() { events.push('adapter'); return adapter; },
    subscribeAccountSettings(listener) { listeners.add(listener); listener(initialOpen); return () => listeners.delete(listener); },
    mountTaskVerificationPolicy(options) {
      mounted = options; events.push('mount');
      return { show() { events.push('show'); }, hide() { events.push('hide'); }, destroy() { events.push('destroy'); } };
    },
  };
  return { args, events, host, listeners, mounted: () => { assert.ok(mounted); return mounted; },
    setClient(value: unknown) { client = value; }, setAdapter(value: unknown) { adapter = value; },
    publish(open: boolean) { for (const listener of listeners) listener(open); } };
}

test('real account-settings lifecycle opens and synchronously hides the policy controller', () => {
  const f = fixture(), entry = connectTaskVerificationPolicySettings(f.args);
  assert.ok(entry); assert.equal(f.mounted().host, f.host);
  assert.deepEqual(f.events, ['mount', 'hide']);
  assert.equal(f.host.hidden, true);
  f.publish(true); assert.equal(f.host.hidden, false);
  f.publish(false); assert.equal(f.host.hidden, true);
  assert.deepEqual(f.events, ['mount', 'hide', 'show', 'hide']);
  entry.destroy(); f.publish(true);
  assert.equal(f.listeners.size, 0); assert.equal(f.events.at(-1), 'destroy'); assert.equal(f.host.hidden, true);
});

test('late module startup reads the current open state and duplicate startup adds no handlers', () => {
  const f = fixture({ initialOpen: true });
  const entry = connectTaskVerificationPolicySettings(f.args);
  assert.ok(entry);
  assert.equal(connectTaskVerificationPolicySettings(f.args), entry);
  assert.deepEqual(f.events, ['mount', 'show']); assert.equal(f.listeners.size, 1);
  entry.destroy(); entry.destroy(); assert.equal(f.events.filter(x => x === 'destroy').length, 1);
  const remounted = connectTaskVerificationPolicySettings(f.args); assert.ok(remounted); remounted.destroy();
  assert.equal(f.events.filter(x => x === 'mount').length, 2);
});

test('missing settings entry never creates a detached demonstration control', () => {
  const f = fixture({ missingHost: true });
  assert.equal(connectTaskVerificationPolicySettings(f.args), null);
  assert.deepEqual(f.events, []); assert.equal(f.listeners.size, 0);
});

test('only the current account client may supply a policy adapter; no ambient or stale fallback', () => {
  const f = fixture(), entry = connectTaskVerificationPolicySettings(f.args);
  assert.ok(entry);
  const read = f.mounted().getPolicyClient;
  assert.equal(read(), null);
  f.setClient(new Error('LOGIN_REQUIRED')); assert.equal(read(), null);
  f.setClient({}); assert.equal(read(), null);
  const adapterA = Object.freeze({ read() {}, change() {} });
  f.setAdapter(adapterA); f.setClient({ taskVerification() {}, account() {} }); assert.equal(read(), adapterA);
  const adapterB = Object.freeze({ read() {}, change() {} }); f.setAdapter(adapterB);
  assert.equal(read(), adapterA, 'Factory is cached once for the actual authenticated client');
  f.setClient(null); assert.equal(read(), null);
  f.setClient({ taskVerification() {}, account() {} }); assert.equal(read(), adapterB);
  assert.equal(f.events.filter(value => value === 'adapter').length, 2);
  entry.destroy();
});

test('failed subscription removes the controller rather than leaving detached handlers', () => {
  const f = fixture(); f.args.subscribeAccountSettings = () => { throw new Error('subscription refused'); };
  assert.throws(() => connectTaskVerificationPolicySettings(f.args), /subscription refused/);
  assert.deepEqual(f.events, ['mount', 'destroy']);
});

test('unavailable strict bridge stays unavailable and factory exceptions are not retried per read', () => {
  const f = fixture(); let attempts = 0;
  f.args.createTaskVerificationPolicyClient = () => { attempts++; throw new Error('wire decoder unavailable'); };
  const entry = connectTaskVerificationPolicySettings(f.args); assert.ok(entry);
  f.setClient({ taskVerification() {}, account() {} });
  const read = f.mounted().getPolicyClient;
  assert.equal(read(), null); assert.equal(read(), null);
  assert.equal(attempts, 1);
  entry.destroy();
});

test('actual page mounts the policy module within existing account settings and retains task entry', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const start = html.indexOf('<section id="auth-management"');
  const host = html.indexOf('<section id="task-verification-policy-settings"');
  const password = html.indexOf('<section id="auth-password-settings"');
  assert.ok(start >= 0 && host > start && password > host);
  assert.equal(html.match(/id="task-verification-policy-settings"/g)?.length, 1);
  assert.equal(html.match(/src="task-verification-policy-startup\.mjs"/g)?.length, 1);
  assert.match(html, /src="task-ui\.mjs"/);
  const startup = readFileSync(new URL('../web/task-verification-policy-startup.mjs', import.meta.url), 'utf8');
  assert.match(startup, /from '\.\/task-verification-policy-ui\.mjs'/);
  assert.match(startup, /currentAccountClient, subscribeAccountSettings/);
  assert.match(startup, /connectTaskVerificationPolicySettings\(/);
  assert.match(startup, /from '\.\/task-verification-policy-client\.mjs'/);
});
