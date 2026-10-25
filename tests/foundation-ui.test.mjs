/** Source and isolated presentation tests.
 * These fixtures do not establish served-site, server, signer or chain acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as i18n from '../web/i18n.mjs';
import { walletIdentityStateDisplay } from '../web/wallet-identity-display.mjs';
import { isPlatformPasswordProfile } from '../web/tenant-password-routing.mjs';
import { loginIdentifier, requestedWalletPath, authenticatedRoute } from '../web/wallet-entry.mjs';
const text = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = text('../web/index.html');
const source = text('../web/wallet-shell.mjs').replace(/^import[^\n]*\n/gm, '');
const tags = [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)];
const attrsOf = raw => new Map([...raw.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? '']));

class Element {
  id = ''; dataset = {}; attributes = new Map(); handlers = new Map(); parentElement = null;
  hidden = false; disabled = false; checked = false; value = ''; textContent = ''; children = []; files = []; className = ''; focused = false;
  classList = { toggle() {} };
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  addEventListener(name, handler) { this.handlers.set(name, [...this.handlers.get(name) ?? [], handler]); }
  dispatchEvent(event) { for (const handler of this.handlers.get(event.type) ?? []) handler(event); }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click', target: this }); }
  focus() { this.focused = true; }
  replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node);
      this.children.push(node); node.parentElement = this;
    }
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.startsWith('.') && node.className.split(' ').includes(selector.slice(1))) return node;
      if (selector.startsWith('#') && node.id === selector.slice(1)) return node;
    }
    return null;
  }
}
function fixture(initialEntry = null, platform = false) {
  const nodes = [], ids = new Map(), events = new Element(), windowEvents = new Element();
  // Model physical containment and DOM reparenting used by the independent
  // management route. Browser suites separately verify actual layout/focus.
  const stack = [], voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for (const [, closing, tagName, raw] of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/g)) {
    if (closing) {
      const index = stack.findLastIndex(node => node.tagName === tagName);
      if (index >= 0) stack.splice(index);
      continue;
    }
    const node = new Element(); node.tagName = tagName; node.attributes = attrsOf(raw);
    for (const [key, value] of node.attributes) {
      if (key === 'id') { node.id = value; ids.set(value, node); }
      if (key === 'class') node.className = value;
      if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    node.hidden = node.attributes.has('hidden'); node.disabled = node.attributes.has('disabled'); nodes.push(node);
    stack.at(-1)?.append(node); if (!voidTags.has(tagName)) stack.push(node);
  }
  const body = nodes.find(node => node.tagName === 'body');
  const match = (node, selector) => {
    const cls = selector.match(/^\.([\w-]+)/)?.[1];
    if (cls && !node.className.split(' ').includes(cls)) return false;
    return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]+)")?\]/g)].every(([, key, value]) => node.attributes.has(key) && (value === undefined || node.attributes.get(key) === value));
  };
  const document = { body, getElementById: id => ids.get(id), createElement: () => new Element(),
    querySelectorAll: selector => nodes.filter(node => match(node, selector)), querySelector: selector => nodes.find(node => match(node, selector)),
    addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) };
  const counters = { requests: 0, signatures: 0, sends: 0, avatarWrites: 0, registrationOpens: 0, registrationCloses: 0 };
  let subscriber, busy = false, currentSession = null;
  const historyCalls = [], history = { state: initialEntry ? { walletPage: initialEntry } : null,
    pushState(state, title, url) { this.state = state; historyCalls.push(['push', state, url]); if (url !== undefined && url !== '') window.location = new URL(url, window.location.href); },
    replaceState(state, title, url) { this.state = state; historyCalls.push(['replace', state, url]); if (url !== undefined && url !== '') window.location = new URL(url, window.location.href); } };
  const window = { location: new URL(platform ? 'https://8415wallet.com/v3/web/index.html' : 'https://wallet.example/web/index.html'), history,
    addEventListener: windowEvents.addEventListener.bind(windowEvents) };
  const el = id => ids.get(id);
  const login = session => { currentSession = session; el('wallet-private').hidden = !session; subscriber?.(session); };
  // Minimal existing-auth navigation contract. Real auth is covered by its own
  // retained suites, plus the exact reviewed-source identity assertion below.
  el('wallet-login-method').value = 'wallet-local';
  el('auth-registration-open').addEventListener('click', () => { counters.registrationOpens++; login(null); el('auth-registration').hidden = false; });
  el('auth-registration-close').addEventListener('click', () => { counters.registrationCloses++; login(null); el('auth-registration').hidden = true; });
  events.addEventListener('wallet:authentication-leaving', () => {
    if (!el('auth-registration').hidden) { el('auth-registration-close').click(); el('auth-registration-code').value = ''; }
  });
  class Avatar {
    snapshot() { return { status: 'empty', savedUrl: null, previewUrl: null, errorCode: null, hasDraft: false, hasSaved: false }; }
    cancel() {} setContext() {} async load() {} dispose() {}
    async select() { counters.avatarWrites++; } async save() { counters.avatarWrites++; } async remove() { counters.avatarWrites++; }
  }
  const sdk = { ...i18n, walletIdentityStateDisplay, isPlatformPasswordProfile, loginIdentifier, requestedWalletPath, authenticatedRoute, walletLogin: {
    subscribe(fn) { subscriber = fn; login(null); },
    assert() { if (!currentSession) throw Error('LOGIN_REQUIRED'); return currentSession; },
    logout() { login(null); } },
    getReleaseProfile: async () => ({ id: 'v3', tenant: { id: platform ? 'default' : 'example', label: platform ? '8415wallet' : 'Example' },
      deployment: { url: platform ? 'https://8415wallet.com/v3/web/index.html' : null }, features: { linkedResponsibilities: true } }),
    walletUiBusy: () => busy, TenantAvatarController: Avatar };
  new Function('document', 'globalThis', ...Object.keys(sdk), source)(document, window, ...Object.values(sdk));
  return { el, nodes, events, windowEvents, window, counters, historyCalls, history, login, setBusy(value) { busy = value; },
    publicRoute(name) { nodes.find(node => node.dataset.publicRoute === name).click(); },
    route(name) { nodes.find(node => node.dataset.route === name && !node.attributes.has('data-foundation-placeholder')).click(); } };
}

test('foundation mounts authenticated read-only policy status without operation entry modules', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(([, raw]) => attrsOf(raw));
  assert.deepEqual(scripts.map(attrs => attrs.get('src')), ['locale-ui.mjs', 'wallet-auth.mjs', 'wallet-shell.mjs', 'tenant-password-ui.mjs', 'about-entry.mjs', 'task-verification-policy-startup.mjs']);
  for (const script of scripts) assert.equal(script.get('type'), 'module');
  for (const path of ['app.mjs', 'external-assets.mjs', 'legacy-clearing.mjs', 'task-ui.mjs', 'task-verification-policy-startup.mjs']) {
    assert.ok(readFileSync(new URL(`../web/${path}`, import.meta.url)).byteLength > 0);
  }
  assert.match(html, /<body[^>]*data-wallet-composition="foundation"/);
  assert.match(html, /id="wallet-private" hidden inert/);
});

test('every placeholder is disabled before startup and cannot submit a form', () => {
  const placeholders = tags.map(([, name, raw]) => ({ name, attrs: attrsOf(raw) })).filter(({ attrs }) => attrs.get('data-foundation-placeholder') === 'true');
  assert.ok(placeholders.length > 50);
  for (const { name, attrs } of placeholders) {
    assert.ok(attrs.has(name === 'form' ? 'inert' : 'disabled')); assert.equal(attrs.get('aria-disabled'), 'true');
    assert.equal(attrs.has('onclick'), false); assert.equal(attrs.has('formaction'), false);
    if (name === 'button') assert.equal(attrs.get('type'), 'button');
  }
  for (const [, , raw] of tags.filter(([, name]) => name === 'form')) {
    const attrs = attrsOf(raw); assert.equal(attrs.get('data-foundation-placeholder'), 'true'); assert.ok(attrs.has('novalidate'));
  }
  const defaults = placeholders.filter(({ attrs }) => attrs.get('data-policy-source') === 'unconnected-default');
  assert.equal(defaults.length, 4);
  for (const { attrs } of defaults) {
    assert.equal(attrs.get('data-display-mode'), 'ON'); assert.equal(attrs.has('aria-checked'), false);
    assert.equal(attrs.get('aria-describedby'), 'foundation-policy-note');
    assert.equal(attrs.has('data-saved-revision'), false); assert.equal(attrs.has('data-authorization'), false);
  }
});

test('public Home, existing-user, Login, Register and Back retain the same verified pathname', async () => {
  const f = fixture(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.el('public-home').hidden, false); assert.equal(f.el('login-panel').hidden, true);
  f.publicRoute('existing'); assert.equal(f.el('existing-user-panel').hidden, false); assert.equal(f.el('login-panel').hidden, true);
  f.publicRoute('login'); assert.equal(f.el('public-home').hidden, true); assert.equal(f.el('login-panel').hidden, false);
  f.publicRoute('home');
  f.publicRoute('register'); assert.equal(f.el('auth-registration').hidden, false);
  const opens = f.counters.registrationOpens; f.el('auth-registration-code').value = 'synthetic';
  f.publicRoute('register'); assert.equal(f.counters.registrationOpens, opens); assert.equal(f.el('auth-registration-code').value, 'synthetic');
  f.publicRoute('home'); assert.equal(f.el('public-home').hidden, false); assert.equal(f.el('auth-registration').hidden, true); assert.equal(f.el('auth-registration-code').value, '');
  f.windowEvents.dispatchEvent({ type: 'popstate', state: { walletPage: 'register' } }); assert.equal(f.el('auth-registration').hidden, false);
  assert.ok(f.historyCalls.every(([, , url]) => url === undefined));
  assert.equal(f.el('wallet-private').hidden, true);
});

test('reload reopens only a known public page; arbitrary history is not wallet resolution', () => {
  const registered = fixture('register'); assert.equal(registered.el('auth-registration').hidden, false);
  const unknown = fixture('other-wallet'); assert.equal(unknown.el('public-home').hidden, false);
  const privatePage = fixture('transfer'); assert.equal(privatePage.el('public-home').hidden, false);
  for (const f of [registered, unknown, privatePage]) assert.equal(f.el('wallet-private').hidden, true);
});

test('shell routes initial setup into an independent management branch', () => {
  const f = fixture(); f.el('auth-management').hidden = false;
  f.events.dispatchEvent({ type: 'wallet:authentication-method' });
  assert.equal(f.el('public-home').hidden, true); assert.equal(f.el('login-panel').hidden, true);
  assert.equal(f.el('auth-management-view').hidden, false); assert.equal(f.el('auth-management').hidden, false);
  assert.equal(f.el('auth-login-controls').parentElement, f.el('auth-management-verification'));
  assert.equal(f.el('wallet-private').hidden, true);
});

test('direct placeholder handlers remain no-ops after removing DOM disabled markers', async () => {
  const f = fixture(); await new Promise(resolve => setImmediate(resolve));
  f.login({ account: 'synthetic-account', chainId: '1' });
  const historyBefore = JSON.stringify(f.historyCalls), countersBefore = JSON.stringify(f.counters);
  for (const node of f.nodes.filter(item => item.dataset.foundationPlaceholder === 'true')) {
    node.disabled = false; node.removeAttribute('disabled'); node.removeAttribute('aria-disabled'); node.removeAttribute('data-foundation-placeholder');
    node.files = [{ name: 'synthetic.png' }];
    // Invoke each registered handler directly, bypassing DOM event capture.
    for (const type of ['click', 'keydown', 'input', 'change', 'submit']) node.dispatchEvent({ type, target: node, key: 'Enter' });
  }
  f.el('task-authorize-form').submit(); f.el('task-authorize-form').requestSubmit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(f.historyCalls), historyBefore); assert.equal(JSON.stringify(f.counters), countersBefore);
});

test('capture stops pointer, keyboard and form events on placeholders without feedback', () => {
  const f = fixture(), node = f.el('asset-send');
  for (const type of ['click', 'keydown', 'input', 'change', 'submit']) {
    let prevented = 0, stopped = 0;
    f.events.dispatchEvent({ type, target: node, key: 'Enter', composedPath: () => [new Element(), node], preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } });
    assert.equal(prevented, 1); assert.equal(stopped, 1);
  }
  let submitPrevented = false;
  f.events.dispatchEvent({ type: 'submit', target: new Element(), submitter: node, preventDefault() { submitPrevented = true; }, stopImmediatePropagation() {} });
  assert.equal(submitPrevented, true);
  assert.equal(f.counters.requests + f.counters.signatures + f.counters.sends + f.counters.avatarWrites, 0);
});

test('private overview and settings require login; lock and logout still work', async () => {
  const f = fixture(); await new Promise(resolve => setImmediate(resolve));
  f.route('settings'); assert.equal(f.el('public-home').hidden, false);
  f.setBusy(true); f.publicRoute('register'); assert.equal(f.counters.registrationOpens, 0);
  f.setBusy(false); f.login({ account: 'synthetic-account', chainId: '1' });
  assert.equal(f.el('public-home').hidden, true); f.route('settings'); assert.equal(f.el('foundation-agent-settings').hidden, false);
  f.login(null); assert.equal(f.el('wallet-private').hidden, true); assert.equal(f.el('public-home').hidden, false);
  f.windowEvents.dispatchEvent({ type: 'pagehide' }); f.windowEvents.dispatchEvent({ type: 'pageshow', persisted: true });
  assert.equal(f.counters.avatarWrites, 0);
});

test('six existing locale choices remain ordered and every new label is authored', () => {
  assert.deepEqual(i18n.LOCALES.map(locale => locale.id), ['en', 'zh-Hans', 'zh-Hant', 'fr', 'es', 'ja']);
  const keys = ['navigation', 'home', 'login', 'register', 'rbac', 'agentSettings', 'policyNote', 'policySavedNote', 'allowAgent', 'assetScope', 'operations', 'humanVerification'];
  for (const locale of i18n.LOCALES) for (const key of keys) assert.equal(typeof i18n.CATALOGS[locale.id][`foundation.${key}`], 'string');
});

test('platform authentication candidate has an exact identity, with retained security modules', () => {
  // This pin identifies the candidate source; it does not assert runtime acceptance.
  // Account-login, method-change and raw-page browser suites retain behavioral
  // proof/cancellation/replay tests for this changed presentation.
  const auth = text('../web/wallet-auth.mjs');
  assert.equal(createHash('sha256').update(auth).digest('hex'), 'fa09a78f97da746761523d8c48fdaf03975bb5b0fcb451c15fd5c8205d94b3b7');
  for (const [path, expected] of [
    ['web/login-core.mjs', '2b6da6cdc97ccf7ca53aaa41c25b15b8482d29c604ecd5d76ce4bf9ba31c73d8'],
    ['web/account-auth.mjs', '6e7021fbe19738a0cffc5fdb5a7a809b67419bfd54e59f44d2e66a6caa5e4f80'],
    ['web/method-change-ui.mjs', '31119a18fbf541cb588b9daf531dc0e75ca46f25d8d7340e7e65d89728d209fe'],
  ]) assert.equal(createHash('sha256').update(text('../' + path)).digest('hex'), expected, path);
});

test('home has only Register/Login and management is a separate DOM branch', () => {
  const f = fixture();
  const homeButtons = f.nodes.filter(node => node.tagName === 'button' && node.closest('#public-home'));
  assert.deepEqual(homeButtons.map(node => node.dataset.publicRoute).sort(), ['existing', 'register']);
  assert.equal(f.el('auth-management-view').closest('#login-panel'), null);
  assert.equal(f.el('auth-management-view').closest('#existing-user-panel'), null);
  assert.equal(f.el('wallet-login-method').tagName, 'select');
  assert.equal(f.nodes.some(node => node.attributes.has('data-login-method')), false);
  for (const key of ['entry.existing', 'entry.unconfigured', 'entry.managementHelp', 'entry.resolverUnavailable']) {
    for (const locale of i18n.LOCALES) assert.equal(typeof i18n.CATALOGS[locale.id][key], 'string', `${locale.id}:${key}`);
  }
});

test('platform entry requires an identifier and never performs an anonymous lookup', async () => {
  const f = fixture(null, true); await new Promise(resolve => setImmediate(resolve));
  f.publicRoute('existing');
  assert.equal(f.el('existing-user-panel').hidden, false);
  assert.equal(f.el('existing-login-open').disabled, true);
  f.publicRoute('login'); assert.equal(f.el('login-panel').hidden, true);
  assert.equal(f.counters.requests + f.counters.signatures + f.counters.sends, 0);
  assert.ok(f.historyCalls.every(([, , url]) => url === undefined));
});
test('platform identifier opens real authentication without claiming wallet membership', async () => {
  const f = fixture(null, true); await new Promise(resolve => setImmediate(resolve));
  f.publicRoute('existing'); f.el('password-tenant-select').value = 'owner@example.invalid';
  // The UI button's input controller is separate; this calls the guarded route.
  f.el('existing-login-open').disabled = false;
  f.publicRoute('login');
  assert.equal(f.el('login-panel').hidden, false);
  assert.equal(f.el('auth-username').value, 'owner@example.invalid');
  assert.equal(f.el('wallet-private').hidden, true);
  assert.equal(f.counters.requests + f.counters.signatures + f.counters.sends, 0);
  assert.ok(f.historyCalls.every(([, , url]) => url === undefined));
});


test('disabled default ON keeps the Giraffe accent without enabling controls', () => {
  const css = text('../web/wallet.css');
  const generic = '[data-foundation-placeholder=true]:disabled{background:var(--canvas)!important;color:var(--muted)!important;border-color:var(--line)!important;opacity:1;cursor:default}';
  const accent = '[data-foundation-placeholder=true][data-policy-source=unconnected-default][data-display-mode=ON]:disabled{background:var(--accent)!important;color:var(--ink)!important;border-color:var(--accent)!important}';
  // The narrower, later rule overrides only ON color. The neutral placeholder
  // rule still supplies opacity and cursor; non-ON actions remain gray.
  assert.ok(css.includes(generic)); assert.ok(css.indexOf(accent) > css.indexOf(generic));
  assert.match(css, /--accent:#ffbe43;/);
  const defaults = tags.map(([, , raw]) => attrsOf(raw)).filter(attrs => attrs.get('data-policy-source') === 'unconnected-default');
  assert.equal(defaults.length, 4);
  for (const attrs of defaults) {
    assert.equal(attrs.get('data-display-mode'), 'ON');
    assert.ok(attrs.has('disabled')); assert.equal(attrs.get('aria-disabled'), 'true');
    assert.equal(attrs.get('data-foundation-placeholder'), 'true');
    assert.equal(attrs.get('aria-describedby'), 'foundation-policy-note');
    assert.equal(attrs.has('data-saved-revision'), false);
  }
});


test('all entered authentication secrets are masked without losing one-time-code autofill', () => {
  for (const id of ['auth-code', 'auth-registration-code', 'auth-registration-account-code', 'auth-existing-code', 'auth-enroll-code', 'auth-email-code', 'task-code']) {
    const attrs = tags.map(([, , raw]) => attrsOf(raw)).find(attrs => attrs.get('id') === id);
    assert.equal(attrs.get('type'), 'password', id);
    assert.equal(attrs.get('autocomplete'), 'one-time-code', id);
  }
});

test('Back leaves a pending public login once without releasing its request lock', async () => {
  const f = fixture(); await new Promise(resolve => setImmediate(resolve)); f.publicRoute('login');
  let cancelled = 0; f.events.addEventListener('wallet:authentication-leaving', () => { cancelled++; });
  f.setBusy(true);
  f.windowEvents.dispatchEvent({ type: 'popstate', state: { walletPage: 'home' } });
  assert.equal(cancelled, 1);
  assert.equal(f.el('public-home').hidden, false); assert.equal(f.el('login-panel').hidden, true);
  const requestCount = JSON.stringify(f.counters); f.publicRoute('register');
  assert.equal(JSON.stringify(f.counters), requestCount, 'Navigation cannot release the pending operation lock');
});

test('registration Escape returns to existing-wallet choices without opening Login for tenant or platform profiles', async () => {
  for (const platform of [false, true]) {
    const f = fixture(null, platform); await new Promise(resolve => setImmediate(resolve));
    f.publicRoute('register'); f.el('auth-registration-code').value = 'synthetic-unsubmitted-code';
    f.windowEvents.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(f.el('auth-registration').hidden, true);
    assert.equal(f.el('registration-panel').hidden, true);
    assert.equal(f.el('existing-user-panel').hidden, false);
    assert.equal(f.el('login-panel').hidden, true, 'Escape is not an identity-proof selection');
    assert.equal(f.el('auth-registration-code').value, '');
    assert.equal(f.el('wallet-private').hidden, true);
    assert.equal(f.counters.requests, 0); assert.equal(f.counters.signatures, 0); assert.equal(f.counters.sends, 0);
    assert.equal(f.history.state.walletPage, 'existing');
  }
});


const routedSession = name => ({ account: '0x' + '1'.repeat(40), chainId: '1', serverId: 'synthetic-session', walletRoute: { walletName: name, walletPath: '/' + name } });
test('platform Home clears a former authenticated wallet path before another login', async () => {
  const f = fixture(null, true); await new Promise(resolve => setImmediate(resolve));
  f.login(routedSession('example-one'));
  assert.equal(f.window.location.pathname, '/example-one');
  assert.equal(f.el('password-tenant-select').value, 'example-one');
  f.login(null); f.publicRoute('home');
  assert.equal(f.window.location.pathname, '/v3/web/index.html');
  assert.equal(f.el('password-tenant-select').value, '');
  f.login(routedSession('example-two'));
  assert.equal(f.window.location.pathname, '/example-two');
  assert.equal(f.el('wallet-private').hidden, false);
});
test('intentional registration leaves a previous wallet path before authenticating the new account', async () => {
  const f = fixture(null, true); await new Promise(resolve => setImmediate(resolve));
  f.window.location = new URL('https://8415wallet.com/example-one');
  f.publicRoute('register');
  assert.equal(f.window.location.pathname, '/v3/web/index.html');
  f.login(routedSession('user-new-account'));
  assert.equal(f.window.location.pathname, '/user-new-account');
  assert.equal(f.el('password-tenant-select').value, 'user-new-account');
  assert.equal(f.el('auth-username').value, 'user-new-account');
  f.login(null);
  assert.equal(f.window.location.pathname, '/user-new-account');
  assert.equal(f.el('password-tenant-select').value, 'user-new-account');
});


test('brand marks composite without a white tile and preserve surrounding images', () => {
  const css = text('../web/wallet.css');
  assert.match(css, /\.brand-logo,\.login-intro>img\{background:transparent;mix-blend-mode:multiply\}/);
  assert.equal((html.match(/src="assets\/giraffe-original\.jpg"/g) ?? []).length, 2);
  assert.doesNotMatch(css, /(?:^|\})\s*img\s*\{[^}]*mix-blend-mode/);
  assert.doesNotMatch(css, /\.tenant-avatar(?:\s+img)?\{[^}]*mix-blend-mode/);
});
