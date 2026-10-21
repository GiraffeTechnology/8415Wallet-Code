const change = require('./method-change-test-ui.cjs');
// Real browser/service registration and migration. Synthetic wallets and fake mail only.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const { once } = require('node:events');
const { chromium } = require('playwright-core'); const { Wallet, getBytes } = require('ethers');
const { installScreenNavigation } = require('./screen-navigation.cjs');
async function run() {
  const root = path.resolve(__dirname, '../..'), out = path.resolve(process.env.AUTH_UI_OUTPUT || '/tmp/8415-auth-methods-ui-evidence');
  const { createAuthService } = await import('../../server/auth-service.mjs'); const { MemoryCredentialStore } = await import('../../server/store.mjs');
  const { hashPassword } = await import('../../server/crypto.mjs'); const { LOCALES, CATALOGS } = await import('../../web/i18n.mjs');
  const oldWallet = new Wallet(`0x${'0'.repeat(63)}1`), newWallet = new Wallet(`0x${'0'.repeat(63)}2`);
  const password = 'synthetic-registration-password', passwordHash = await hashPassword(password), email = 'new-user@example.invalid';
  const config = JSON.parse(fs.readFileSync(path.join(root, 'web/release-config.json'), 'utf8')); let profile = 'v2', auth, mail = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/auth/')) return auth(req, res);
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/web/release-config.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ...config, profile })); }
    const full = path.resolve(root, req.url === '/' ? 'web/index.html' : req.url.slice(1));
    if (!full.startsWith(`${root}/web/`) && !full.startsWith(`${root}/dist/browser/`)) { res.writeHead(404); return res.end(); }
    try { res.setHeader('Content-Type', full.endsWith('.html') ? 'text/html' : full.endsWith('.css') ? 'text/css' : full.endsWith('.json') ? 'application/json' : full.endsWith('.jpg') ? 'image/jpeg' : full.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'); res.end(fs.readFileSync(full)); }
    catch { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`;
  let browser; const evidence = [];
  try {
    fs.mkdirSync(out, { recursive: true }); browser = await chromium.launch({ executablePath: process.env.WALLET_BROWSER_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (profile of ['v2', 'v3']) for (const width of [1440, 390]) {
      const store = new MemoryCredentialStore(); mail = [];
      auth = createAuthService({ origin, tenant: config.tenant.id, store, accounts: [{ username: 'legacy-user', passwordHash, wallets: [{ account: oldWallet.address, chainId: '1' }] }], sendOtp: async message => { mail.push(message); return { accepted: true }; } });
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, isMobile: width === 390 });
      const errors = [], external = [], authRequests = [];
      context.on('request', request => { if (!request.url().startsWith(`${origin}/`)) external.push(request.url()); if (request.url().includes('/auth/')) authRequests.push(new URL(request.url()).pathname); });
      await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
      await context.exposeFunction('__registrationSign', async ({ message, account }) => {
        const signer = account.toLowerCase() === oldWallet.address.toLowerCase() ? oldWallet : account.toLowerCase() === newWallet.address.toLowerCase() ? newWallet : null;
        assert.ok(signer); return signer.signMessage(getBytes(message));
      });
      await context.addInitScript(({ actor }) => {
        const listeners = new Map(), state = globalThis.__registrationTest = { actor, calls: [] };
        globalThis.ethereum = { on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeListener(name, fn) { listeners.get(name)?.delete(fn); },
          async request({ method, params }) { state.calls.push(method); if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [state.actor]; if (method === 'eth_chainId') return '0x1';
            if (method === 'personal_sign') return globalThis.__registrationSign({ message: params[0], account: params[1] }); throw Error('Unexpected synthetic provider method'); } };
        state.changeAccount = actor => { state.actor = actor; for (const fn of listeners.get('accountsChanged') ?? []) fn(); };
      }, { actor: newWallet.address });
      const page = installScreenNavigation(await context.newPage()); page.on('pageerror', error => errors.push(error.message));
      const post = async (button, endpoint, expectedStatus = 200) => { const wait = page.waitForResponse(r => r.url().endsWith(`/auth/${endpoint}`)); await page.click(button); const response = await wait; assert.equal(response.status(), expectedStatus, 'Registration endpoint must return its expected status'); return response.json(); };
      const openRegistration = async () => {
        if (!await page.locator('#public-home').isVisible()) await page.locator('.foundation-public-nav [data-public-route="home"]').click();
        await page.locator('#public-home [data-public-route="register"]').click();
      };
      const chooseSetup = async step => {
        if (!await page.locator('#auth-management').isVisible()) await page.click('#auth-manage-open');
        if (!await page.locator('#auth-setup-menu').isVisible()) await page.click('#auth-management-back');
        await page.click(`#auth-setup-${step}-open`);
      };
      const login = async identifier => {
        if (await page.locator('#wallet-private').evaluate(node => node.hidden) && await page.locator('#auth-management-view').isVisible()) await page.locator('#auth-management-close').click();
        await page.selectOption('#wallet-login-method', 'password'); await page.fill('#auth-username', identifier); await page.fill('#auth-password', password); await page.click('#wallet-login');
        await page.waitForFunction(() => !document.getElementById('wallet-private').hidden && !document.getElementById('wallet-login').disabled); await chooseSetup('email');
      };
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'page-load', profile, width }));
      await page.goto(`${origin}/web/index.html`); await page.waitForFunction(() => document.getElementById('release-profile').textContent.includes('8415wallet'));
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'open-register', profile, width }));
      await openRegistration(); await page.fill('#auth-registration-email', email);
      for (const locale of LOCALES) { await page.selectOption('#ui-locale', locale.id); assert.equal(await page.textContent('#auth-registration-start'), CATALOGS[locale.id]['registration.send']); assert.equal(await page.inputValue('#auth-registration-email'), email); }
      assert.deepEqual(authRequests, []); assert.deepEqual(await page.evaluate(() => __registrationTest.calls), []);
      await page.selectOption('#ui-locale', 'en'); await page.keyboard.press('Escape'); assert.equal(await page.locator('#auth-registration').isVisible(), false);
      assert.equal(await page.locator('#existing-user-panel').isVisible(), true, 'Escape must return to existing-wallet choices');
      assert.equal(await page.locator('#login-panel').isVisible(), false, 'Cancelling Register must not select Login');
      assert.equal(await page.locator('#registration-panel').isVisible(), false);
      assert.equal(await page.locator('#auth-registration-email').inputValue(), '');
      assert.deepEqual(authRequests, []); assert.deepEqual(await page.evaluate(() => __registrationTest.calls), []);
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'pending-start-cancellation', profile, width }));
      // Real raw-page Escape while a successful start response is held in transport.
      await openRegistration(); await page.locator('#auth-registration-email').fill('cancelled-user@example.invalid');
      let releaseStart, seenStart, heldStartStatus;
      const startGate = new Promise(resolve => { releaseStart = resolve; });
      const startSeen = new Promise(resolve => { seenStart = resolve; });
      await page.route('**/auth/registration/start', async route => {
        const response = await route.fetch(); heldStartStatus = response.status(); seenStart(); await startGate; await route.fulfill({ response });
      });
      try {
        await page.locator('#auth-registration-start').click(); await startSeen;
        assert.equal(heldStartStatus, 200, 'Cancellation scenario holds an actual successful start response');
        await page.keyboard.press('Escape'); await page.locator('#existing-user-panel').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#registration-panel').isVisible(), false);
        assert.equal(await page.locator('#auth-registration-email').inputValue(), '');
        assert.equal(await page.locator('#auth-registration-start').isDisabled(), true);
        assert.equal(await page.locator('#wallet-private').isVisible(), false);
      } finally { releaseStart(); }
      await page.waitForLoadState('networkidle'); await page.unroute('**/auth/registration/start');
      assert.equal(await page.locator('#existing-user-panel').isVisible(), true);
      assert.equal(await page.locator('#auth-registration').isVisible(), false);
      assert.equal(await page.locator('#wallet-private').isVisible(), false);
      assert.equal(authRequests.some(value => value === '/auth/registration/verify' || value === '/auth/registration/confirm'), false);
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'open-register', profile, width }));
      await openRegistration(); await page.fill('#auth-registration-email', email);
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'pending-start-history-back', profile, width }));
      await openRegistration(); await page.locator('#auth-registration-email').fill('back-cancelled-user@example.invalid');
      let releaseBackStart, seenBackStart, backStartStatus;
      const backGate = new Promise(resolve => { releaseBackStart = resolve; });
      const backSeen = new Promise(resolve => { seenBackStart = resolve; });
      const backRequestStart = authRequests.length;
      await page.route('**/auth/registration/start', async route => {
        const response = await route.fetch(); backStartStatus = response.status(); seenBackStart();
        await backGate; await route.fulfill({ response });
      });
      try {
        await page.locator('#auth-registration-start').click(); await backSeen;
        console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 1, profile, width }));
        assert.equal(backStartStatus, 200);
        await page.evaluate(() => globalThis.history.back());
        await page.locator('#public-home').waitFor({ state: 'visible' });
        console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 2, profile, width }));
        assert.equal(await page.locator('#auth-registration').isVisible(), false);
        console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 3, profile, width }));
        assert.equal(await page.locator('#auth-registration-email').inputValue(), '');
        console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 4, profile, width }));
        assert.equal(await page.locator('#auth-registration-start').isDisabled(), true, 'Back preserves the unresolved request lock');
        console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 5, profile, width }));
        assert.equal(await page.evaluate(async () => (await import('/web/ui-lock.mjs')).walletUiBusy()), true);
        console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 6, profile, width }));
        assert.equal(await page.locator('#wallet-private').isVisible(), false);
      } finally { releaseBackStart(); }
      await page.waitForLoadState('networkidle'); await page.unroute('**/auth/registration/start');
      // Transport idleness can precede the original request's finally callback.
      // Wait for the real business-lock release; a stuck lock still times out.
      await page.waitForFunction(async () => !(await import('/web/ui-lock.mjs')).walletUiBusy());
      console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 7, profile, width }));
      assert.equal(await page.evaluate(async () => (await import('/web/ui-lock.mjs')).walletUiBusy()), false);
      console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 8, profile, width }));
      assert.equal(await page.locator('#public-home').isVisible(), true);
      console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 9, profile, width }));
      assert.equal(await page.locator('#auth-registration').isVisible(), false);
      console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 10, profile, width }));
      assert.equal(await page.locator('#wallet-private').isVisible(), false);
      console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 11, profile, width }));
      assert.equal(authRequests.slice(backRequestStart).filter(value => value === '/auth/registration/start').length, 1);
      console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 12, profile, width }));
      assert.equal(authRequests.slice(backRequestStart).some(value => value === '/auth/registration/verify' || value === '/auth/registration/confirm'), false);
      console.error(JSON.stringify({ check: 'REGISTRATION_BACK_ASSERTION', index: 13, profile, width }));
      assert.deepEqual(await page.evaluate(() => __registrationTest.calls), []);
      await openRegistration(); await page.fill('#auth-registration-email', email);
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'start-verification', profile, width }));
      await post('#auth-registration-start', 'registration/start'); assert.equal(mail.at(-1).purpose, 'registration');
      assert.deepEqual(await page.evaluate(() => __registrationTest.calls), []); assert.equal(await store.read(`@registration:${config.tenant.id}`), null);
      await page.fill('#auth-registration-code', mail.at(-1).code === '00000000' ? '11111111' : '00000000'); const refused = await post('#auth-registration-verify', 'registration/verify', 401);
      assert.equal(refused.error, 'AUTH_REFUSED');
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'verify-email', profile, width }));
      await page.fill('#auth-registration-code', mail.at(-1).code); await post('#auth-registration-verify', 'registration/verify');
      await page.waitForFunction(() => !document.getElementById('auth-registration-wallet-fields').hidden);
      assert.deepEqual(await page.evaluate(() => __registrationTest.calls), []); assert.equal(await store.read(`@registration:${config.tenant.id}`), null);
      await page.fill('#auth-registration-password', password); await page.fill('#auth-registration-password-confirm', password);
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'finish-registration', profile, width }));
      await page.click('#auth-registration-finish'); await page.waitForFunction(() => !document.getElementById('wallet-private').hidden && !document.getElementById('wallet-login').disabled);
      console.error(JSON.stringify({ check: 'REGISTRATION_STAGE', stage: 'setup-menu', profile, width }));
      await page.locator('#auth-setup-menu').waitFor({ state: 'visible' });
      assert.equal(await page.inputValue('#auth-registration-password'), ''); assert.equal(await page.locator('#auth-registration').isVisible(), false);
      await chooseSetup('recovery');
      assert.equal(await page.inputValue('#auth-reserved-email'), email); assert.equal(await page.getAttribute('#auth-reserved-email', 'readonly'), '');
      await chooseSetup('methods');
      assert.equal(await page.isChecked('#auth-enable-password'), true); assert.equal(await page.isChecked('#auth-enable-wallet'), true);
      const directory = await store.read(`@registration:${config.tenant.id}`); assert.equal(directory.records.length, 1); assert.equal(directory.records[0].email, email);
      assert.deepEqual(directory.records[0].ordinaryAccount.caFingerprints, []); assert.equal(directory.records[0].ordinaryAccount.admin, undefined);
      await chooseSetup('recovery');
      await page.fill('#auth-reserved-answer', 'synthetic private recovery phrase');
      const recovery = await change.commit(page, '#auth-recovery-enroll', { password }, () => mail.at(-1));
      assert.equal(recovery.status, 200); assert.equal(mail.at(-1).to, email); assert.equal(mail.at(-1).purpose, 'method-change'); await page.waitForFunction(() => document.getElementById('wallet-private').hidden);
      await login('NEW-USER@EXAMPLE.INVALID'); assert.match(await page.textContent('#auth-registration-account-state'), /n\*\*\*@example.invalid/);
      await page.locator('#auth-management-title').scrollIntoViewIfNeeded(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(out, `${profile}-${width}-verified-registration.png`), fullPage: false });
      await page.click('#wallet-logout'); await page.evaluate(actor => __registrationTest.changeAccount(actor), oldWallet.address); await login('legacy-user');
      assert.match(await page.textContent('#auth-registration-account-state'), /needs a verified/);
      await page.fill('#auth-registration-account-email', 'legacy@example.invalid'); await page.click('#auth-registration-account-start');
      assert.equal((await change.identity(page, { password })).status, 200);
      assert.equal(mail.at(-1).purpose, 'method-change');
      assert.equal(await page.locator('#wallet-private').evaluate(node => !node.hidden && !node.inert), true, 'email migration retains the authenticated session while its separate screen is open');
      const migration = change.changeResponse(page, 'commit'); await change.email(page, mail.at(-1).code); assert.equal((await migration).status(), 200); await page.waitForFunction(() => document.getElementById('wallet-private').hidden);
      await login('LEGACY@EXAMPLE.INVALID'); assert.match(await page.textContent('#auth-registration-account-state'), /l\*\*\*@example.invalid/);
      assert.equal((await store.read(`@registration:${config.tenant.id}`)).records.length, 2);
      await page.click('#wallet-logout'); await page.reload(); assert.equal(await page.locator('#auth-registration-account').isVisible(), false); assert.equal(await page.inputValue('#auth-registration-email'), '');
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      evidence.push({ profile, width, requiredEmailBeforeWallet: true, actualEoaProof: true, optionalPasswordAndWalletEnabled: true, emailAlias: true,
        ordinaryAccountOnly: true, coherentRecoveryEmail: true, legacyMigrationPreservesLogin: true, registrationOtpPurpose: true, sixLocalesNoExtraCalls: true, privacyAfterReload: true, noOverflow: true, realEmailSent: false });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'registration-results.json'), JSON.stringify({ synthetic: true, actualHttpService: true, emailTransport: 'in-memory fake', evidence }, null, 2)); console.log(`Passed ${evidence.length} verified-email registration/migration journeys`);
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
module.exports = { run };
if (require.main === module) run().catch(error => { change.failure(error); });
