// Synthetic Chromium regression only. Every request is fulfilled from local
// fixtures/files or aborted; no production site, login, credential or mail is used.
// Build first: npm run wallet:browser:build
// Optional immutable baseline: TENANT_UI_SOURCE_REF=<local snapshot commit>
// Optional evidence: TENANT_UI_OUTPUT=/tmp/8415-tenant-password-ui
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const { installScreenNavigation } = require('./screen-navigation.cjs');

const root = path.resolve(__dirname, '../..');
const tenants = ['synthetic-alpha', 'synthetic-beta', 'synthetic-gamma'];
const buttons = ['auth-initial-open', 'auth-manage-open'];
const setupEntries = [
  { id: 'auth-setup-totp-open', label: 'Authenticator' },
  { id: 'auth-setup-password-open', label: 'Account password' },
];
const sourceRef = process.env.TENANT_UI_SOURCE_REF || null;
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const cache = new Map();
function source(relative) {
  if (!cache.has(relative)) cache.set(relative, sourceRef && relative.startsWith('web/')
    ? execFileSync('git', ['show', `${sourceRef}:${relative}`], { cwd: root, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    : fs.readFileSync(path.join(root, relative)));
  return cache.get(relative);
}
function profile(tenant, url) {
  return { schema: '8415wallet-release/1', product: '8415wallet', platform: '8415wallet.com',
    profile: tenant === 'synthetic-alpha' ? 'v2' : 'v3', tenant: { id: tenant, label: tenant },
    deployment: { environment: url ? 'other' : 'unconfigured', url } };
}
function routes(urlFor = tenant => `https://${tenant}.8415wallet.com:9446/web/index.html`, ready = true) {
  return { schema: '8415wallet-password-routing/1', entries: tenants.map(tenant => ({ tenant,
    profile: tenant === 'synthetic-alpha' ? 'v2' : 'v3', url: urlFor(tenant), passwordManagementReady: ready })) };
}
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 30)));

async function run() {
  const out = path.resolve(process.env.TENANT_UI_OUTPUT || '/tmp/8415-tenant-password-ui');
  fs.mkdirSync(out, { recursive: true });
  let browser;
  const evidence = [], failures = [];
  const check = (condition, message) => { if (!condition) throw Error(message); };
  async function scenario(name, test) {
    try { const details = await test(); evidence.push({ name, passed: true, ...details }); console.log(`PASS ${name}`); }
    catch (error) { failures.push({ name, error: error.message }); evidence.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
  }
  async function fixture({ url, config, routing = routes(), holdConfig = false, failConfig = false, holdCapabilities = false, automaticNavigation = true }) {
    const configGate = gate(), capabilitiesGate = gate(), configSeen = gate(), capabilitiesSeen = gate();
    if (!holdConfig) configGate.resolve(); if (!holdCapabilities) capabilitiesGate.resolve();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block' });
    context.setDefaultTimeout(10000);
    const requests = [], auth = [], unexpected = [], errors = [], fulfilled = [];
    await context.addInitScript(() => {
      globalThis.__tenantProviderCalls = [];
      globalThis.ethereum = { on() {}, removeListener() {}, request({ method }) {
        globalThis.__tenantProviderCalls.push(method); return Promise.reject(Error('Synthetic navigation must not call a provider'));
      } };
    });
    await context.route('**/*', async route => {
      const request = route.request(), actual = new URL(request.url()); requests.push(request.url());
      const finish = async value => { fulfilled.push(request.url()); return route.fulfill(value); };
      // The fixture must never leak network traffic, even for a surprising URL.
      if (actual.origin !== new URL(url).origin) { unexpected.push(request.url()); return route.abort(); }
      if (actual.pathname === '/favicon.ico') return finish({ status: 204, body: '' });
      if (actual.pathname.endsWith('/web/release-config.json')) {
        configSeen.resolve(); await configGate.promise;
        return finish({ status: failConfig ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failConfig ? { error: 'SYNTHETIC_CONFIG_UNAVAILABLE' } : config) });
      }
      if (actual.pathname === '/.well-known/8415wallet-password-routing.json' || actual.pathname.endsWith('/web/tenant-password-routing.json')) {
        return finish({ status: 200, contentType: 'application/json', body: JSON.stringify(routing) });
      }
      if (actual.pathname.startsWith('/auth/')) {
        auth.push({ path: actual.pathname, method: request.method(), origin: actual.origin, tenant: request.headers()['x-wallet-tenant'] });
        if (actual.pathname === '/auth/capabilities') {
          capabilitiesSeen.resolve(); await capabilitiesGate.promise;
          return finish({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema: '8415wallet-auth/1',
            tenant: config.tenant.id, origin: actual.origin, methods: ['password', 'wallet'], passwordManagement: true, methodManagement: 'combined-v1' }) });
        }
        unexpected.push(request.url()); return route.abort();
      }
      const match = actual.pathname.match(/\/(web\/.*|dist\/browser\/.*)$/);
      if (!match || request.method() !== 'GET' || match[1].split('/').some(part => part === '..' || part === '.')) {
        unexpected.push(request.url()); return route.abort();
      }
      try { return finish({ status: 200, contentType: mime[path.extname(match[1])] || 'application/octet-stream', body: source(match[1]) }); }
      catch { unexpected.push(request.url()); return route.abort(); }
    });
    const page = await context.newPage();
    // The original journeys retain their helper. Public-entry regressions must
    // use the unwrapped page: silently opening Login would hide a routing defect.
    if (automaticNavigation) installScreenNavigation(page);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await configSeen.promise;
    // Ensure the actual application listeners are installed, without reaching
    // into auth state or removing hidden/inert/disabled protections.
    await page.evaluate(() => import(new URL('./wallet-auth.mjs', location.href)));
    const state = () => page.evaluate(ids => ({
      closed: document.getElementById('auth-management').hidden,
      selector: !document.getElementById('platform-password-tenants').hidden,
      buttons: ids.map(id => ({ id, disabled: document.getElementById(id).disabled, hidden: document.getElementById(id).hidden,
        expanded: document.getElementById(id).getAttribute('aria-expanded') })),
      privateHidden: document.getElementById('wallet-private').hidden,
      privateInert: document.getElementById('wallet-private').inert,
      passwordHidden: document.getElementById('auth-password-fields').hidden,
      passwordDisabled: document.getElementById('auth-password-save').disabled,
      enrollmentHidden: document.getElementById('auth-enrollment').hidden,
      enrollmentDisabled: document.getElementById('auth-enroll-start').disabled,
      methodsHidden: document.getElementById('auth-method-states').hidden,
      methodsDisabled: document.getElementById('auth-methods-save').disabled,
      method: document.getElementById('wallet-login-method').value,
      providerCalls: globalThis.__tenantProviderCalls,
    }), buttons);
    const releaseConfig = async () => { configGate.resolve(); await page.waitForLoadState('networkidle'); await settle(page); };
    const safety = async () => {
      assert.deepEqual(unexpected, [], 'No unexpected or off-origin request'); assert.deepEqual(errors, [], 'No uncaught page errors');
      const value = await state(); assert.deepEqual(value.providerCalls, [], 'No provider operations');
      check(value.privateHidden && value.privateInert && value.passwordHidden && value.passwordDisabled,
        'Navigation must not authenticate, remove the private inert lock, or enable password writes');
      check(value.enrollmentHidden && value.enrollmentDisabled && value.methodsHidden && value.methodsDisabled,
        'Unsigned navigation must not enable authenticator or sign-in-method writes');
      assert.equal(await page.locator('#wallet-private').isVisible(), false, 'Private wallet must remain visually hidden');
      check(auth.every(row => row.path === '/auth/capabilities' && row.method === 'GET' && row.origin === new URL(url).origin && row.tenant === config.tenant.id), 'Capabilities must remain tenant-bound and same-origin');
    };
    const close = async () => { configGate.resolve(); capabilitiesGate.resolve(); await context.close(); };
    return { context, page, auth, requests, state, releaseConfig, safety, close, capabilitiesGate, capabilitiesSeen, fulfilled, tenant: config.tenant.id };
  }

  async function visibleHome(f) {
    assert.equal(await f.page.locator('#public-home').isVisible(), true, 'Real unsigned homepage must be visible');
    const actions = await f.page.locator('#public-home [data-public-route]').evaluateAll(nodes => nodes.map(node => ({
      route: node.dataset.publicRoute, text: node.textContent.trim(),
    })));
    assert.deepEqual(actions.sort((a, b) => a.route.localeCompare(b.route)), [
      { route: 'existing', text: 'Login' }, { route: 'register', text: 'Register' },
    ], 'Home must offer only Register and Login, with Login entering the existing-wallet hierarchy');
    for (const id of ['existing-user-panel', 'auth-setup-menu', 'login-panel', 'registration-panel', 'auth-management-view', 'auth-management']) {
      assert.equal(await f.page.locator(`#${id}`).isVisible(), false, `${id} must not be exposed on Home`);
    }
    check((await f.state()).closed, 'Returning Home must close management, not merely hide its ancestor');
    await f.safety();
  }

  async function visibleExisting(f, tenant) {
    assert.equal(await f.page.locator('#public-home').isVisible(), false);
    assert.equal(await f.page.locator('#existing-user-panel').isVisible(), true, 'Existing-wallet screen must actually be visible');
    assert.equal(await f.page.locator('#auth-setup-menu').isVisible(), false, 'Setup choices belong to the next screen');
    assert.equal(await f.page.locator('#login-panel').isVisible(), false, 'Existing-wallet choice must not open Login automatically');
    assert.equal(await f.page.locator('#existing-tenant-context').isVisible(), true, 'Current wallet context must be visible');
    assert.ok((await f.page.locator('#existing-tenant-context').textContent()).includes(tenant), 'Context must identify the verified synthetic tenant');
    for (const id of ['existing-login-open', 'auth-initial-open']) {
      assert.equal(await f.page.locator(`#${id}`).isVisible(), true, `${id} must be a visible next step`);
      assert.equal(await f.page.locator(`#${id}`).isEnabled(), true, `${id} requires a verified local profile`);
    }
    assert.equal(await f.page.locator('#existing-user-panel [data-public-route="home"]').isVisible(), true, 'Existing-wallet screen needs a real Back to Home control');
    check((await f.state()).closed, 'Existing-wallet screen must not open management'); await f.safety();
  }

  async function visibleSetup(f) {
    assert.equal(await f.page.locator('#public-home').isVisible(), false);
    assert.equal(await f.page.locator('#auth-setup-menu').isVisible(), true, 'Authentication setup menu must actually be visible');
    assert.equal(await f.page.locator('#login-panel').isVisible(), false, 'Setup choice must precede the identity-proof screen');
    assert.equal(await f.page.locator('#auth-management-view').isVisible(), true, 'Authentication settings must have their own visible page');
    assert.equal(await f.page.locator('#auth-management-view').evaluate(node => !!node.closest('#login-panel, #public-home, #existing-user-panel')), false,
      'Authentication management must not be nested inside Login, Home or the existing-wallet screen');
    assert.equal(await f.page.locator('#auth-management-verification').isVisible(), false, 'Identity proof must follow an explicit operation choice');
    assert.ok((await f.page.locator('#auth-management-tenant-context').textContent()).includes(f.tenant), 'Management must retain the verified wallet context');
    for (const { id, label } of setupEntries) {
      const button = f.page.locator(`#auth-setup-menu #${id}`);
      assert.equal(await button.count(), 1, `${id} belongs inside the setup menu`);
      assert.equal(await button.isVisible(), true); assert.equal(await button.isEnabled(), true);
      assert.equal((await button.textContent()).trim(), label, 'Setup choices must describe different actions');
    }
    assert.equal(await f.page.locator('#auth-setup-menu button:visible').count(), 2, 'Unsigned initialization offers only authenticator and first-password setup');
    for (const id of ['auth-setup-methods-open', 'auth-setup-email-open', 'auth-setup-recovery-open']) {
      assert.equal(await f.page.locator(`#${id}`).isVisible(), false, 'Existing-account management requires a verified server account');
    }
    assert.equal(await f.page.locator('#auth-management-close').isVisible(), true, 'Settings needs a real return control');
    assert.equal(await f.page.locator('#auth-management-back').isVisible(), false, 'Operation Back appears after choosing an operation');
    assert.equal(await f.page.locator('#auth-manage-open').isVisible(), false, 'Existing-method management must not be an unsigned setup-menu choice');
    check(!(await f.state()).closed, 'The independent settings menu must be an open management view'); await f.safety();
  }

  async function visibleManagement(f, method = 'wallet') {
    for (const id of ['public-home', 'existing-user-panel', 'auth-setup-menu']) {
      assert.equal(await f.page.locator(`#${id}`).isVisible(), false, `${id} must not overlay identity verification`);
    }
    assert.equal(await f.page.locator('#login-panel').isVisible(), false, 'Binding and changes must not use the Login page');
    assert.equal(await f.page.locator('#auth-management-view').isVisible(), true, 'The independent management page must actually be visible');
    assert.equal(await f.page.locator('#auth-management').isVisible(), true, 'Management content must actually be visible');
    assert.equal(await f.page.locator('#auth-management-verification').isVisible(), true, 'Selected unsigned operation must request identity proof');
    assert.equal(await f.page.locator('#wallet-login-method').isVisible(), true, 'Shared identity controls must be visible in the management verification step');
    assert.equal(await f.page.locator('#auth-login-controls').evaluate(node => !!node.closest('#auth-management-verification')), true,
      'Identity verification must stay within the independent management page');
    assert.equal(await f.page.locator('#auth-management-back').isVisible(), true, 'Selected operation needs a real Back to choices control');
    const state = await f.state(); check(!state.closed, 'Management must be open');
    assert.equal(state.method, method, 'Setup must use the existing independent registered-wallet login path');
    await f.safety();
  }

  const returnHome = f => f.page.locator('.foundation-public-nav [data-public-route="home"]').click();
  async function enterSetup(f, tenant) {
    await visibleHome(f);
    await f.page.locator('#public-home [data-public-route="existing"]').click(); await visibleExisting(f, tenant);
    await f.page.locator('#auth-initial-open').click(); await visibleSetup(f);
  }

  try {
    browser = await chromium.launch({ executablePath: process.env.WALLET_BROWSER_CHROMIUM || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'] });

    // Successful public journeys use only real, visible clicks on an unwrapped
    // page. No helper opens Login and no script changes hidden/inert or auth state.
    for (const tenant of ['synthetic-alpha', 'synthetic-beta']) for (const { id } of setupEntries) {
      await scenario(`real existing-wallet hierarchy ${tenant} ${id}`, async () => {
        const url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
        const f = await fixture({ url, config: profile(tenant, url), automaticNavigation: false });
        try {
          await f.releaseConfig(); await enterSetup(f, tenant); assert.deepEqual(f.auth, [], 'Selecting a screen must not start authentication');
          await f.page.locator('#auth-management-close').click(); await visibleExisting(f, tenant);
          await f.page.locator('#existing-user-panel [data-public-route="home"]').click(); await visibleHome(f);
          await enterSetup(f, tenant); assert.deepEqual(f.auth, [], 'Back and re-entry must remain read-only local navigation');
          await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle');
          await visibleManagement(f); assert.equal(f.auth.length, 1, 'One setup choice permits one capability lookup only');
          await f.page.screenshot({ path: path.join(out, `hierarchy-${tenant}-${id}.png`), fullPage: true });

          await f.page.locator('#auth-management-close').click(); await settle(f.page);
          check((await f.state()).closed, 'Close must dismiss the actual panel');
          assert.equal(await f.page.locator('#auth-management').isVisible(), false);
          await returnHome(f); await enterSetup(f, tenant);
          await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle');
          await visibleManagement(f); assert.equal(f.auth.length, 2, 'Reopening must not duplicate capability lookups');
          await f.page.keyboard.press('Escape'); await settle(f.page);
          check((await f.state()).closed, 'Escape must cancel reopened management');
          await returnHome(f); await enterSetup(f, tenant);
          await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle');
          await visibleManagement(f); assert.equal(f.auth.length, 3);
          await returnHome(f); await visibleHome(f);
          assert.equal(f.auth.length, 3, 'Home cancellation must not send login or account-change requests');
          return { automaticNavigation: false, realHierarchy: true, repeatedSetupChoices: 3,
            backCloseEscapeAndHome: true, independentManagementVisible: true, capabilitiesOnly: true };
        } finally { await f.close(); }
      });
    }

    for (const { id } of setupEntries) await scenario(`setup replaces unproved password selection ${id}`, async () => {
      const tenant = 'synthetic-alpha', url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
      const f = await fixture({ url, config: profile(tenant, url), automaticNavigation: false });
      try {
        await f.releaseConfig(); await visibleHome(f);
        await f.page.locator('#public-home [data-public-route="existing"]').click(); await visibleExisting(f, tenant);
        await f.page.locator('#existing-login-open').click();
        assert.equal(await f.page.locator('#login-panel').isVisible(), true, 'Log in must expose the real identity screen');
        check((await f.state()).closed, 'Ordinary Log in must not open management'); assert.deepEqual(f.auth, []);
        await f.page.locator('#wallet-login-method').selectOption('password');
        await returnHome(f); await enterSetup(f, tenant); assert.deepEqual(f.auth, []);
        await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle'); await visibleManagement(f);
        assert.equal(f.auth.length, 1); await returnHome(f); await visibleHome(f);
        return { automaticNavigation: false, ordinaryLoginNavigation: true, selectionIsNotCredentialProof: true, registeredWalletPath: true };
      } finally { await f.close(); }
    });

    for (const { id } of setupEntries) await scenario(`independent management Back clears selected proof ${id}`, async () => {
      const tenant = 'synthetic-alpha', url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
      const f = await fixture({ url, config: profile(tenant, url), automaticNavigation: false });
      try {
        await f.releaseConfig(); await enterSetup(f, tenant); assert.deepEqual(f.auth, []);
        await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle'); await visibleManagement(f);
        assert.equal(f.auth.length, 1);
        await f.page.locator('#wallet-login-method').selectOption('password');
        assert.equal(await f.page.locator('#login-panel').isVisible(), false, 'Method changes must remain in independent management');
        assert.equal(await f.page.locator('#auth-management-verification').isVisible(), true);
        await f.page.locator('#auth-password').fill('synthetic-unsubmitted-proof');
        assert.equal(f.auth.length, 1, 'Choosing a proof method must not authenticate');
        await f.page.locator('#auth-management-back').click(); await visibleSetup(f);
        assert.equal(await f.page.locator('#auth-password').inputValue(), '', 'Back must clear unsubmitted proof');
        assert.equal(await f.page.locator('#auth-code').inputValue(), '', 'Back must clear authenticator input');
        assert.equal(f.auth.length, 1, 'Back must not write or fetch authentication');
        await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle'); await visibleManagement(f);
        assert.equal(f.auth.length, 2, 'A new explicit selection may make one capability lookup only');
        await f.page.locator('#auth-management-close').click(); await visibleExisting(f, tenant);
        assert.equal(await f.page.locator('#auth-management-view').isVisible(), false);
        assert.equal(await f.page.locator('#auth-login-controls').evaluate(node => !!node.closest('#auth-login-host')), true,
          'Closing independent management must restore shared identity controls to their Login host');
        await f.safety();
        return { automaticNavigation: false, independentManagementPage: true, methodSelectionStaysInManagement: true,
          backClearsProof: true, closeRestoresLoginHost: true };
      } finally { await f.close(); }
    });

    for (const { id } of setupEntries) await scenario(`setup dismiss pending capabilities ${id}`, async () => {
      const tenant = 'synthetic-alpha', url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
      const f = await fixture({ url, config: profile(tenant, url), holdCapabilities: true, automaticNavigation: false });
      try {
        await f.releaseConfig(); await enterSetup(f, tenant); assert.deepEqual(f.auth, []);
        await f.page.locator(`#${id}`).click(); await f.capabilitiesSeen.promise; await visibleManagement(f);
        await returnHome(f); await visibleHome(f);
        f.capabilitiesGate.resolve(); await f.page.waitForLoadState('networkidle'); await settle(f.page);
        await visibleHome(f); assert.equal(f.auth.length, 1, 'Late capability response must not reopen or restart setup');
        await enterSetup(f, tenant); await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle');
        await visibleManagement(f); assert.equal(f.auth.length, 2); await returnHome(f); await visibleHome(f);
        return { automaticNavigation: false, staleResponseDiscarded: true, realHierarchyReopen: true, capabilitiesOnly: true };
      } finally { await f.close(); }
    });

    await scenario('management browser Back and Forward restore choices only', async () => {
      const tenant = 'synthetic-beta', url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
      const f = await fixture({ url, config: profile(tenant, url), automaticNavigation: false });
      try {
        await f.releaseConfig(); await enterSetup(f, tenant);
        await f.page.locator('#auth-setup-password-open').click(); await f.page.waitForLoadState('networkidle');
        await visibleManagement(f); assert.equal(f.auth.length, 1);
        await f.page.locator('#wallet-login-method').selectOption('password');
        await f.page.locator('#auth-password').fill('synthetic-history-proof');
        await f.page.goBack(); await settle(f.page); await visibleExisting(f, tenant);
        assert.equal(await f.page.locator('#auth-password').inputValue(), '', 'Browser Back must clear unsubmitted proof');
        await f.page.goForward(); await settle(f.page); await visibleSetup(f);
        assert.equal(f.auth.length, 1, 'Forward must restore choices without replaying an operation');
        await f.page.goBack(); await settle(f.page); await visibleExisting(f, tenant);
        assert.equal(f.auth.length, 1, 'History restoration must not create duplicate entries or auth requests');
        await f.safety();
        return { automaticNavigation: false, browserBackForward: true, operationNotReplayed: true, historyNotDuplicated: true };
      } finally { await f.close(); }
    });

    for (const action of ['initial', 'manage']) await scenario(`real fragment visible ${action}`, async () => {
      const endpoint = 'https://synthetic-beta.8415wallet.com:9446/web/index.html';
      const f = await fixture({ url: `${endpoint}#auth-${action}`, config: profile('synthetic-beta', endpoint), holdConfig: true, automaticNavigation: false });
      try {
        await visibleHome(f); assert.deepEqual(f.auth, []);
        await f.releaseConfig(); await visibleSetup(f);
        assert.equal(f.page.url(), endpoint, 'Existing fragment must be consumed without changing destination');
        assert.deepEqual(f.auth, [], 'A fragment opens only the choices; it must not choose or authenticate a method');
        await f.page.locator('#auth-setup-password-open').click(); await f.page.waitForLoadState('networkidle');
        await visibleManagement(f); assert.equal(f.auth.length, 1, 'Explicit fragment-destination choice permits one capability lookup');
        await f.page.locator('#auth-management-close').click(); await returnHome(f); await visibleHome(f);
        await settle(f.page); assert.equal(f.auth.length, 1);
        return { automaticNavigation: false, fragmentConsumed: true, independentManagementVisible: true, explicitChoiceRequired: true, noAuthentication: true };
      } finally { await f.close(); }
    });

    for (const { id } of setupEntries) await scenario(`hierarchy rejects queued profile entry ${id}`, async () => {
      const tenant = 'synthetic-alpha', url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
      const f = await fixture({ url, config: profile(tenant, url), holdConfig: true, automaticNavigation: false });
      try {
        await visibleHome(f); await f.page.locator('#public-home [data-public-route="existing"]').click();
        assert.equal(await f.page.locator('#existing-user-panel').isVisible(), true, 'Presentation entry stays usable while profile loads');
        for (const entry of ['existing-login-open', 'auth-initial-open', ...setupEntries.map(entry => entry.id)]) {
          assert.equal(await f.page.locator(`#${entry}`).isEnabled(), false, 'Local continuation requires a verified profile');
          await f.page.dispatchEvent(`#${entry}`, 'click');
        }
        await settle(f.page); check((await f.state()).closed, 'Programmatic early entry must remain closed');
        assert.equal(await f.page.locator('#login-panel').isVisible(), false);
        assert.equal(await f.page.locator('#auth-setup-menu').isVisible(), false);
        assert.deepEqual(f.auth, []); await f.safety();
        await f.releaseConfig(); await visibleExisting(f, tenant);
        assert.deepEqual(f.auth, [], 'Profile resolution must not replay rejected clicks');
        await f.page.locator('#auth-initial-open').click(); await visibleSetup(f);
        await f.page.locator(`#${id}`).click(); await f.page.waitForLoadState('networkidle'); await visibleManagement(f);
        assert.equal(f.auth.length, 1); await returnHome(f); await visibleHome(f);
        return { automaticNavigation: false, pendingEntryDiscarded: true, explicitContinuationRequired: true };
      } finally { await f.close(); }
    });

    for (const failure of ['unavailable', 'location-mismatch']) await scenario(`hierarchy profile refusal ${failure}`, async () => {
      const endpoint = 'https://synthetic-alpha.8415wallet.com:9446/web/index.html';
      const url = failure === 'location-mismatch' ? endpoint.replace(':9446', ':19446') : endpoint;
      const f = await fixture({ url, config: profile('synthetic-alpha', endpoint), holdConfig: true,
        failConfig: failure === 'unavailable', automaticNavigation: false });
      try {
        await visibleHome(f); await f.page.locator('#public-home [data-public-route="existing"]').click();
        await f.releaseConfig();
        for (const id of ['existing-login-open', 'auth-initial-open', ...setupEntries.map(entry => entry.id)]) {
          assert.equal(await f.page.locator(`#${id}`).isEnabled(), false, 'Refused profile must not enable local continuation');
          await f.page.dispatchEvent(`#${id}`, 'click');
        }
        await settle(f.page); check((await f.state()).closed, 'Failed profile must not open management');
        assert.equal(await f.page.locator('#existing-user-panel').isVisible(), true);
        assert.equal(await f.page.locator('#auth-setup-menu').isVisible(), false);
        assert.equal(await f.page.locator('#login-panel').isVisible(), false);
        assert.deepEqual(f.auth, []); await f.safety(); await returnHome(f); await visibleHome(f);
        return { automaticNavigation: false, failClosed: true, queuedEntry: false, exactLocationBound: true };
      } finally { await f.close(); }
    });

    await scenario('platform identifier reaches local Login without anonymous membership lookup', async () => {
      const url = 'https://8415wallet.com:9446/v3/web/index.html';
      const f = await fixture({ url, config: profile('default', url), automaticNavigation: false });
      try {
        await f.releaseConfig(); await visibleHome(f);
        await f.page.locator('#public-home [data-public-route="existing"]').click();
        assert.equal(await f.page.locator('#existing-user-panel').isVisible(), true);
        assert.equal(await f.page.locator('#password-tenant-select').isVisible(), true);
        const responses = [];
        assert.equal(await f.page.locator('#existing-login-open').isEnabled(), false, 'Empty intent must not open Login');
        assert.equal(await f.page.locator('#password-tenant-continue').isEnabled(), false);
        await f.page.dispatchEvent('#existing-login-open', 'click');
        await f.page.dispatchEvent('#password-tenant-continue', 'click'); await settle(f.page);
        assert.equal(await f.page.locator('#login-panel').isVisible(), false);
        for (const identifier of [...tenants, 'unknown-wallet', 'reader@example.invalid', '0x' + '1'.repeat(40)]) {
          await f.page.locator('#password-tenant-select').fill(identifier);
          assert.equal(await f.page.locator('#password-tenant-continue').getAttribute('href'), null, 'Public intent cannot construct an authenticated destination');
          assert.equal(await f.page.locator('#password-tenant-continue').getAttribute('aria-disabled'), 'false');
          assert.equal(await f.page.locator('#existing-login-open').isEnabled(), true, 'Valid public intent must reach the real local Login surface');
          responses.push(await f.page.locator('#password-tenant-status').textContent());
          await f.page.locator('#password-tenant-continue').click(); await settle(f.page);
          assert.equal(await f.page.locator('#login-panel').isVisible(), true, 'Continue must open the real Login surface');
          check((await f.state()).closed, 'Login entry must not open credential management');
          assert.equal(await f.page.locator('#auth-setup-menu').isVisible(), false);
          assert.equal(f.page.url(), url, 'No navigation before authenticated identity supplies a canonical wallet path');
          assert.deepEqual(f.auth, [], 'Opening Login must not query membership, bootstrap authentication or write');
          await f.safety(); await returnHome(f); await visibleHome(f);
          await f.page.locator('#public-home [data-public-route="existing"]').click();
        }
        assert.equal(new Set(responses).size, 1, 'Known names, unknown names, emails and addresses must not disclose membership');
        await f.page.locator('#password-tenant-select').fill('');
        assert.equal(await f.page.locator('#existing-login-open').isEnabled(), false, 'Cleared intent disables continuation again');
        await f.page.locator('#auth-initial-open').click();
        assert.equal(await f.page.locator('#auth-management-view').isVisible(), true, 'Platform may expose the neutral management menu');
        const unavailable = (await f.page.locator('#auth-management-status').textContent()).trim();
        assert.ok(unavailable.length > 0, 'Platform must explain the unavailable trusted resolver');
        for (const { id } of setupEntries) {
          await f.page.locator(`#${id}`).click(); await settle(f.page);
          assert.equal(await f.page.locator('#auth-management-status').textContent(), unavailable, 'Every setup choice must preserve the same resolver-unavailable response');
          assert.equal(await f.page.locator('#auth-management-verification').isVisible(), false, 'Unresolved platform must not expose local identity proof');
          assert.equal(await f.page.locator('#wallet-login-method').isVisible(), false);
          assert.deepEqual(f.auth, [], 'Neutral platform management must never query auth capabilities or perform writes');
          await f.safety(); await f.page.locator('#auth-management-back').click();
        }
        await f.page.locator('#auth-management-close').click();
        assert.equal(f.page.url(), url, 'Identifier entry must not synthesize a tenant destination');
        assert.ok(!f.requests.some(request => /8415wallet-password-routing|tenant-password-routing\.json/.test(request)), 'No anonymous tenant-directory request');
        assert.deepEqual(f.auth, []); await f.safety(); await returnHome(f); await visibleHome(f);
        return { automaticNavigation: false, localLoginAvailable: true, noAnonymousResolution: true, noDirectoryRequests: true, noMembershipDisclosure: true };
      } finally { await f.close(); }
    });

    await scenario('homepage registration remains a separate real route', async () => {
      const tenant = 'synthetic-alpha', url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
      const f = await fixture({ url, config: profile(tenant, url), automaticNavigation: false });
      try {
        await f.releaseConfig(); await visibleHome(f);
        await f.page.locator('#public-home [data-public-route="register"]').click();
        assert.equal(await f.page.locator('#auth-registration').isVisible(), true, 'Register must open the actual registration surface');
        check((await f.state()).closed, 'Registration must not open management'); assert.deepEqual(f.auth, []);
        await f.safety(); await returnHome(f); await visibleHome(f);
        assert.equal(await f.page.locator('#auth-registration').isVisible(), false);
        return { automaticNavigation: false, separateRegistration: true, noRegistrationRequest: true };
      } finally { await f.close(); }
    });

    await scenario('native login dropdown clears credentials without authenticating', async () => {
      const tenant = 'synthetic-alpha', url = `https://${tenant}.8415wallet.com:9446/web/index.html`;
      const f = await fixture({ url, config: profile(tenant, url), automaticNavigation: false });
      try {
        await f.releaseConfig(); await visibleHome(f);
        await f.page.locator('#public-home [data-public-route="existing"]').click(); await visibleExisting(f, tenant);
        await f.page.locator('#existing-login-open').click();
        const select = f.page.locator('#wallet-login-method');
        assert.equal(await select.evaluate(node => node.tagName), 'SELECT', 'Login method must be a native dropdown');
        assert.equal(await select.isVisible(), true);
        assert.equal(await f.page.getByRole('combobox', { name: 'Choose a method for this login' }).count(), 1, 'Native dropdown needs its associated accessible label');
        assert.equal(await f.page.locator('.login-method-tabs:visible').count(), 0, 'Redundant method tabs must not remain in the real layout');
        for (const method of ['wallet-local', 'password', 'totp', 'wallet', 'ca']) {
          await select.selectOption(method);
          assert.equal(await f.page.locator('#account-login-fields').isVisible(), ['password', 'totp'].includes(method));
          assert.equal(await f.page.locator('#auth-password-label').isVisible(), method === 'password');
          assert.equal(await f.page.locator('#auth-code-label').isVisible(), method === 'totp');
          assert.equal(await f.page.locator('#auth-recovery-label').isVisible(), method === 'totp');
          assert.equal(await f.page.locator('#auth-password').inputValue(), '', 'Switching methods clears password input');
          assert.equal(await f.page.locator('#auth-code').inputValue(), '', 'Switching methods clears authenticator input');
          assert.equal(await f.page.locator('#auth-recovery').isChecked(), false, 'Switching methods clears the recovery-code mode');
          if (method === 'password') await f.page.locator('#auth-password').fill('synthetic-placeholder-never-send');
          if (method === 'totp') {
            await f.page.locator('#auth-code').fill('123456'); await f.page.locator('#auth-recovery').check();
          }
          assert.deepEqual(f.auth, [], 'Selecting a login method must not send any auth request'); await f.safety();
        }
        // Exercise the native keyboard route, not only selectOption automation.
        await select.focus(); await select.press('Home'); await select.press('ArrowDown'); await select.press('Tab');
        assert.equal(await select.inputValue(), 'password', 'Native keyboard selection must expose the password method');
        assert.equal(await f.page.locator('#auth-password-label').isVisible(), true);
        await f.page.locator('#auth-password').fill('synthetic-cancelled-never-send');
        await returnHome(f); await visibleHome(f);
        assert.equal(await f.page.locator('#auth-password').inputValue(), '', 'Leaving Login must clear password input');
        assert.equal(await f.page.locator('#auth-code').inputValue(), '', 'Leaving Login must clear authenticator input');
        assert.deepEqual(f.auth, []); await f.safety();
        return { automaticNavigation: false, nativeAccessibleDropdown: true, keyboardSelection: true,
          selectedInputsOnly: true, transientsCleared: true, noAutomaticAuthentication: true };
      } finally { await f.close(); }
    });

    for (const tenant of ['default', 'synthetic-alpha']) for (const button of buttons) {
      await scenario(`delayed ${tenant} ${button}`, async () => {
        const url = tenant === 'default' ? 'https://8415wallet.com:9446/v3/web/index.html' : 'https://synthetic-alpha.8415wallet.com:9446/web/index.html';
        const f = await fixture({ url, config: profile(tenant, url), holdConfig: true });
        try {
          const before = await f.state();
          // Real click if exposed, then an adversarial programmatic event. A
          // disabled button alone must not substitute for the handler's guard.
          if (!before.buttons.find(row => row.id === button).disabled) await f.page.click(`#${button}`);
          await f.page.dispatchEvent(`#${button}`, 'click'); await settle(f.page);
          const pending = await f.state(), pendingAuth = f.auth.length;
          await f.releaseConfig(); const after = await f.state();
          await f.page.screenshot({ path: path.join(out, `${tenant}-${button}.png`), fullPage: true });
          const observations = { pending, after, auth: f.auth };
          const problems = [];
          if (!before.buttons.every(row => row.disabled)) problems.push('entry buttons were enabled before verified config');
          if (!pending.closed) problems.push('management opened while config pending');
          if (pendingAuth !== 0) problems.push('auth request before config');
          if (tenant === 'default') {
            if (!after.closed || !after.selector || after.buttons.some(row => row.disabled)) problems.push('apex did not retain its closed neutral entry and tenant identifier surface');
            if (f.auth.length) problems.push('apex requested auth capabilities');
            await f.page.click('#auth-initial-open');
            check(!(await f.state()).closed, 'Platform may open only the neutral management menu');
            await f.page.click('#auth-setup-password-open'); await settle(f.page);
            assert.deepEqual(f.auth, [], 'Platform menu and choices must not request capabilities without trusted tenant context');
            assert.equal(await f.page.locator('#auth-management-verification').isVisible(), false);
            await f.page.click('#auth-management-close');
          } else {
            if (!after.closed || after.selector || after.buttons.some(row => row.disabled)) problems.push('tenant resolution did not enable a closed local entry');
            // The private Settings entry is not a signed-out navigation route.
            // Both handlers were probed above; the genuine public entry opens it.
            await f.page.click('#auth-initial-open'); await f.page.waitForLoadState('networkidle');
            check(!(await f.state()).closed, 'Resolved tenant entry must open local panel');
            await f.page.click('#auth-management-close'); check((await f.state()).closed, 'Close must dismiss panel');
            await f.page.click('#auth-initial-open'); await f.page.waitForLoadState('networkidle');
            check(!(await f.state()).closed, 'Repeated entry must reopen');
            await f.page.keyboard.press('Escape'); check((await f.state()).closed, 'Escape must dismiss reopened panel');
          }
          await f.safety();
          if (problems.length) throw Error(`${problems.join('; ')}; observed=${JSON.stringify(observations)}`);
          return { pendingClosed: true, pendingAuthRequests: 0, apexSelector: tenant === 'default', localReopen: tenant !== 'default' };
        } finally { await f.close(); }
      });
    }
    for (const button of buttons) await scenario(`failed config ${button}`, async () => {
      const url = 'https://synthetic-alpha.8415wallet.com:9446/web/index.html';
      const f = await fixture({ url, config: profile('synthetic-alpha', url), failConfig: true });
      try {
        await f.releaseConfig(); await f.page.dispatchEvent(`#${button}`, 'click'); await settle(f.page);
        const state = await f.state();
        check(state.closed && !state.selector && state.buttons.every(row => row.disabled), 'Rejected release config must leave both entry buttons disabled and panel closed');
        assert.deepEqual(f.auth, []); await f.safety(); return { failClosed: true };
      } finally { await f.close(); }
    });

    for (const variant of ['original', 'alternate-port', 'nested-path', 'default-https', 'explicit-default-https']) {
      const target = tenant => variant === 'alternate-port' ? `https://${tenant}.8415wallet.com:19446/web/index.html`
        : variant === 'nested-path' ? `https://${tenant}.8415wallet.com:9446/tenant/${tenant}/web/index.html`
          : variant === 'default-https' ? `https://${tenant}.8415wallet.com/web/index.html`
            : variant === 'explicit-default-https' ? `https://${tenant}.8415wallet.com:443/web/index.html` : `https://${tenant}.8415wallet.com:9446/web/index.html`;
      await scenario(`platform directory privacy ${variant}`, async () => {
        const url = 'https://8415wallet.com:9446/v3/web/index.html';
        const f = await fixture({ url, config: profile('default', url), routing: routes(target) });
        try {
          await f.releaseConfig(); check((await f.state()).selector, 'Apex must show owner-known name entry');
          assert.equal(await f.page.locator('#password-tenant-select').evaluate(node => node.tagName), 'INPUT');
          const responses = [];
          for (const tenant of [...tenants, 'unknown-wallet', 'not-listed']) for (const action of ['initial', 'manage']) {
            await f.page.fill('#password-tenant-select', tenant);
            // This retained compatibility selector is intentionally hidden in
            // the new hierarchy. Probe both values adversarially without making
            // it visible or presenting this as a user navigation journey.
            await f.page.locator('#password-tenant-action').evaluate((node, value) => {
              node.value = value; node.dispatchEvent(new Event('change', { bubbles: true }));
            }, action);
            assert.equal(await f.page.getAttribute('#password-tenant-continue', 'href'), null);
            assert.equal(await f.page.getAttribute('#password-tenant-continue', 'aria-disabled'), 'false', 'Valid public intent enables only local Login, not a directory destination');
            responses.push(await f.page.textContent('#password-tenant-status'));
          }
          assert.equal(new Set(responses).size, 1, 'Known/unknown/action variants must have indistinguishable results');
          await f.page.locator('#password-tenant-continue').click(); await settle(f.page);
          assert.equal(await f.page.locator('#login-panel').isVisible(), true);
          assert.equal(f.page.url(), url, 'Anonymous directory variations cannot supply navigation authority');
          assert.ok(!f.requests.some(request => /8415wallet-password-routing|tenant-password-routing\\.json/.test(request)));
          assert.deepEqual(f.auth, []); await f.safety(); return { namesNotResolved: true, noDirectoryRequests: true };
        } finally { await f.close(); }
      });
      for (const tenant of tenants) for (const action of ['initial', 'manage']) await scenario(`destination ${variant} ${tenant} ${action}`, async () => {
        const endpoint = target(tenant), f = await fixture({ url: `${endpoint}#auth-${action}`, config: profile(tenant, endpoint), holdConfig: true });
        try {
          check((await f.state()).closed, 'Fragment panel must remain closed until config verifies'); assert.deepEqual(f.auth, []);
          await f.releaseConfig();
          check(!(await f.state()).closed, 'Verified destination fragment must open its local panel');
          assert.equal(f.page.url(), new URL(endpoint).href, 'Consumed fragment must be removed without changing the configured endpoint');
          assert.deepEqual(f.auth, [], 'Fragment must open choices without selecting an operation');
          await f.page.click('#auth-setup-password-open'); await f.page.waitForLoadState('networkidle');
          assert.equal(f.auth.length, 1, 'Explicit destination operation must make only one local capability lookup');
          await f.page.click('#auth-management-close'); await settle(f.page); check((await f.state()).closed, 'Close must stay closed after fragment consumption');
          assert.equal(f.page.url(), new URL(endpoint).href); await f.safety(); return { exactDestination: true, fragmentConsumed: true, noAuthentication: true };
        } finally { await f.close(); }
      });
    }

    for (const [name, bad] of Object.entries({
      'cross-tenant': 'https://synthetic-gamma.8415wallet.com:9446/web/index.html',
      'foreign-host': 'https://attacker.invalid:9446/web/index.html',
      query: 'https://synthetic-beta.8415wallet.com:9446/web/index.html?tenant=synthetic-alpha',
      hash: 'https://synthetic-beta.8415wallet.com:9446/web/index.html#auth-initial',
      credentials: 'https://user:synthetic@synthetic-beta.8415wallet.com:9446/web/index.html',
      insecure: 'http://synthetic-beta.8415wallet.com:9446/web/index.html',
    })) await scenario(`platform ignores untrusted directory ${name}`, async () => {
      const url = 'https://8415wallet.com:9446/v3/web/index.html', routing = routes(); routing.entries[1].url = bad;
      const f = await fixture({ url, config: profile('default', url), routing });
      try {
        await f.releaseConfig(); await f.page.fill('#password-tenant-select', 'synthetic-beta');
        assert.equal(await f.page.getAttribute('#password-tenant-continue', 'href'), null);
        assert.equal(await f.page.getAttribute('#password-tenant-continue', 'aria-disabled'), 'false', 'Valid public intent enables only local Login, not a directory destination');
        await f.page.locator('#password-tenant-continue').click(); await settle(f.page);
        assert.equal(await f.page.locator('#login-panel').isVisible(), true, 'Untrusted directory data cannot block owner-entered local Login');
        assert.equal(f.page.url(), url, 'No navigation to an untrusted directory endpoint');
        assert.ok(!f.requests.some(request => /8415wallet-password-routing|tenant-password-routing\\.json/.test(request)), 'No anonymous directory lookup');
        assert.deepEqual(f.auth, []); await f.safety(); return { navigationRefused: true, localLoginAvailable: true };
      } finally { await f.close(); }
    });

    const expected = 'https://synthetic-beta.8415wallet.com:19446/nested/web/index.html';
    for (const [name, actual] of Object.entries({
      'cross-tenant': expected.replace('synthetic-beta.', 'synthetic-gamma.') + '#auth-initial',
      'foreign-host': expected.replace('synthetic-beta.8415wallet.com', 'attacker.invalid') + '#auth-initial',
      'different-port': expected.replace(':19446', ':19447') + '#auth-initial',
      'different-path': expected.replace('/nested/', '/other/') + '#auth-initial',
      query: expected + '?tenant=synthetic-gamma#auth-initial', hash: expected + '#auth-initial?tenant=synthetic-gamma',
    })) await scenario(`destination refuses ${name}`, async () => {
      const f = await fixture({ url: actual, config: profile('synthetic-beta', expected) });
      try {
        await f.releaseConfig();
        for (const button of buttons) await f.page.dispatchEvent(`#${button}`, 'click');
        await settle(f.page); const state = await f.state();
        check(state.closed && state.buttons.every(row => row.disabled), 'Mismatched destination must keep local management closed and disabled');
        assert.equal(f.page.url(), actual); assert.deepEqual(f.auth, []); await f.safety(); return { exactBindingEnforced: true };
      } finally { await f.close(); }
    });

    await scenario('close during delayed capabilities then reopen', async () => {
      const url = 'https://synthetic-alpha.8415wallet.com:9446/web/index.html';
      const f = await fixture({ url, config: profile('synthetic-alpha', url), holdCapabilities: true });
      try {
        // Config is fulfilled, but there is no capability lookup until an action.
        await f.releaseConfig(); await f.page.click('#auth-initial-open');
        assert.deepEqual(f.auth, [], 'Opening the management menu must not start authentication');
        await f.page.click('#auth-setup-totp-open'); await f.capabilitiesSeen.promise;
        await f.page.click('#auth-management-close'); check((await f.state()).closed, 'Close must work while capabilities are pending');
        f.capabilitiesGate.resolve(); await f.page.waitForLoadState('networkidle'); check((await f.state()).closed, 'Late capabilities must not reopen dismissed panel');
        await f.page.click('#auth-initial-open'); await f.page.click('#auth-setup-password-open');
        await f.page.waitForLoadState('networkidle'); check(!(await f.state()).closed, 'Reopen after dismissal must still work');
        await f.page.click('#auth-management-close'); await f.safety(); return { staleResponseDiscarded: true, reopen: true };
      } finally { await f.close(); }
    });

    for (const button of buttons) await scenario(`unconfigured standalone ${button}`, async () => {
      const url = 'https://8415wallet.com:9446/web/index.html';
      const f = await fixture({ url, config: profile('default', null) });
      try {
        await f.releaseConfig(); check(!(await f.state()).selector, 'Unconfigured standalone retains local management');
        if (button === 'auth-initial-open') await f.page.click('#auth-initial-open');
        else await f.page.dispatchEvent('#auth-manage-open', 'click'); // Private compatibility handler, not a user route.
        await f.page.waitForLoadState('networkidle'); check(!(await f.state()).closed, 'Verified standalone config must retain its management menu');
        assert.deepEqual(f.auth, [], 'Standalone menu cannot select a proof or authenticate');
        assert.equal(await f.page.locator('#auth-setup-methods-open').isVisible(), false, 'A private compatibility event must not expose authenticated method management');
        await f.safety(); return { standalonePreserved: true, compatibilityHandlerOnly: button === 'auth-manage-open' };
      } finally { await f.close(); }
    });
  } finally {
    await browser?.close();
    fs.writeFileSync(path.join(out, 'tenant-password-results.json'), JSON.stringify({ synthetic: true,
      sourceRef: sourceRef || 'working-tree', allNetworkRequestsIntercepted: true,
      actualAuthenticationService: false, browserStarted: !!browser, passed: evidence.length - failures.length, failed: failures.length, evidence }, null, 2));
  }
  console.log(JSON.stringify({ passed: evidence.length - failures.length, failed: failures.length, output: out }));
  assert.equal(failures.length, 0, `${failures.length} tenant-password browser regressions failed`);
}
module.exports = { run };
if (require.main === module) run().catch(error => { require('./method-change-test-ui.cjs').failure(error); });
