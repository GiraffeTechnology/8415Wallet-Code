/** Synthetic Chromium UI acceptance only; no genuine wallet, signer or live OTP. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { freezeTaskPolicy, emptyTaskBudget, emptyNftListingBudget } from '../src/agent/taskContract.ts';
import { freezeNftValuationPolicy } from '../server/task-authorization.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const evidence = process.env.WALLET_TASK_EVIDENCE;
async function endpoint() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
test('synthetic desktop and mobile real-page task approval, app switch, reload, navigation and six locales', async () => {
  const port = await endpoint(), origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/controls/serve-browser.cjs'], { cwd: root, env: { ...process.env, WALLET_BROWSER_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await once(server.stdout, 'data');
  let browser;
  try { browser = await chromium.launch({ executablePath: process.env.WALLET_BROWSER_CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
      const page = await context.newPage(), errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      const account = `0x${'11'.repeat(20)}`, tenant = 'default';
      const task = freezeTaskPolicy({ schema: '8415-agent-task/1', taskId: 'synthetic-nft-sale', origin, tenant, chainId: '1', actor: account,
        expiresAt: String(Math.floor(Date.now() / 1000) + 3600), fees: { perOperationWei: '1000000000000001', totalWei: '2000000000000003' },
        intent: { kind: 'nft-sale', direction: 'sell', standard: 'ERC-721', contract: `0x${'22'.repeat(20)}`, tokenId: '9007199254740993123', quantity: '1',
          minimumProceeds: { currency: 'USD', amountMinor: '100001', minorUnit: 2, comparison: 'gt', basis: 'net' }, marketAdapters: ['synthetic-reviewed-market'] } });
      const executorIdentity = { schema: '8415-task-executor/1', agentId: 'synthetic-agent', agentVersion: '1', adapterId: 'synthetic-test-adapter', adapterVersion: '1', implementationDigest: `0x${'9'.repeat(64)}` };
      const executor = { identity: executorIdentity, digest: `0x${createHash('sha256').update(JSON.stringify(executorIdentity)).digest('hex')}` };
      const seconds = Math.floor(Date.now() / 1000);
      const valuationPolicy = freezeNftValuationPolicy({ source: 'synthetic:quote-source',
        base: { chainId: '1', token: `0x${'00'.repeat(20)}`, decimals: 18 }, quote: { currency: 'USD', decimals: 2 },
        rateDecimals: 8, priceAt: 'order-review', validFrom: String(seconds - 10), validUntil: String(seconds + 3600), maxAgeSeconds: '45' });
      const canonical = JSON.stringify({ taskPolicy: task.policy, valuationPolicy }, null, 2);
      let valuationConfigured = false, authorized = false, session;
      const view = () => ({ ...(valuationConfigured ? { valuationPolicy,
        listing: { revocationCancelsPublishedOrder: false, settlementObservationConfigured: false } } : {}), observationPolicy: null, receiptVerifier: null, observations: [], observationRevision: '0', completion: { state: 'not-attempted', fresh: false }, task, executor, authorization: authorized ? { schema: '8415-task-authorization-reference/2', taskDigest: task.digest,
        valuationPolicyDigest: valuationPolicy.digest, priceAt: valuationPolicy.policy.priceAt,
        reference: 'grant:synthetic', status: 'authorized', grantPolicyVersion: '1', credentialRevisionAtApproval: '0' } : null,
        effectiveStatus: authorized ? 'authorized' : 'pending', budget: authorized ? emptyNftListingBudget(task) : null,
        capabilities: { executable: false, adapterConfigured: false, receiptVerifierConfigured: false, missing: ['USER_CONTROLLED_SIGNER_NOT_CONNECTED', 'MARKET_PRICE_VERIFIER_NOT_CONNECTED'] } });
      await page.addInitScript(({ account }) => { window.ethereum = { on() {}, removeListener() {}, async request({ method }) {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0x1'; throw Error('No synthetic signing or transaction permission');
      } }; }, { account });
      await page.route('**/auth/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname.slice(6), body = request.postData() ? request.postDataJSON() : null;
        requests.push(path); let data;
        if (path === 'capabilities') data = { schema: '8415wallet-auth/1', origin, tenant, methods: ['password', 'totp', 'wallet', 'ca'], passwordManagement: true };
        else if (path === 'bootstrap') data = { csrf: 'c'.repeat(43) };
        else if (path === 'password') { const issuedAt = Date.now(); session = { id: 's'.repeat(43), csrf: 'c'.repeat(43), origin, tenant, username: 'synthetic', account, chainId: '1', kind: 'password', issuedAt, expiresAt: issuedAt + 900000 }; data = session; }
        else if (path === 'session') data = session;
        else if (path === 'account') data = { schema: '8415wallet-account/1', origin, tenant, username: 'synthetic', account, chainId: '1',
          methods: { password: { enabled: true, bound: true }, wallet: { enabled: true, bound: true }, ca: { enabled: false, bound: false }, totp: { enabled: true, bound: true } },
          authenticator: { enrolled: true, pending: false }, management: { freshIndependentLogin: true, reauthenticateBy: Date.now() + 300000, existingCodeRequired: true },
          registration: { required: false, complete: true, email: 'synthetic@example.invalid', emailMasked: 's***@example.invalid', emailOtpAvailable: false },
          recovery: { configured: false, emailOtpAvailable: false } };
        else if (path === 'logout') data = { loggedOut: true };
        else if (path === 'tasks/list') data = { tasks: [view()], nextCursor: null, revision: '1' };
        else if (path === 'tasks/status') data = view();
        else if (path === 'tasks/prepare') { assert.equal(valuationConfigured, true); assert.deepEqual(body.valuationPolicy, valuationPolicy.policy); data = { task, executor, valuationPolicy, observationPolicy: null, receiptVerifier: null, purpose: 'authorize-task', challengeId: `challenge:${'c'.repeat(43)}`, expiresAt: Date.now() + 120000 }; }
        else if (path === 'tasks/authorize') { assert.equal(body.taskDigest, task.digest); assert.equal(body.code, '123456'); assert.equal(body.executorDigest, executor.digest); assert.equal(body.observationPolicyDigest, null);
          assert.equal(body.valuationPolicyDigest, valuationPolicy.digest); assert.equal(body.priceAt, 'order-review'); authorized = true; data = view(); }
        else if (path === 'tasks/resume') data = { ...view(), continuation: { state: 'blocked', code: 'TASK_EXECUTION_ADAPTER_NOT_CONNECTED' } };
        else { await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"AUTH_ROUTE_REFUSED"}' }); return; }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      const login = async () => {
        await page.locator('#wallet-login-method').selectOption('password'); await page.locator('#auth-username').fill('synthetic');
        await page.locator('#auth-password').fill('SYNTHETIC_TEST_PASSWORD'); await page.locator('#wallet-login').click();
        await page.waitForFunction(() => !document.body.classList.contains('signed-out'));
      };
      await page.goto(`${origin}/web/index.html`); await login();
      await page.locator('[data-route="tasks"]').first().click(); await page.locator('.task-list-item').click();
      // An NFT task without valuation context must stay blocked, with no challenge
      // or authorization request. Configure the exact reviewed policy before retrying.
      await page.waitForFunction(() => document.getElementById('task-error').textContent === 'TASK_VALUATION_POLICY_AUTHORIZATION_REQUIRED');
      assert.equal(await page.locator('#task-authorize-fields').isVisible(), false);
      assert.equal(await page.locator('#task-authorize').isEnabled(), false);
      assert.equal(requests.filter(path => ['tasks/prepare', 'tasks/authorize'].includes(path)).length, 0);
      valuationConfigured = true; await page.locator('#task-recheck').click();
      await page.locator('#task-authorize-fields').waitFor({ state: 'visible' });
      assert.match(await page.locator('#task-summary').innerText(), /> 1000\.01 USD/);
      assert.match(await page.locator('#task-summary').innerText(), /9007199254740993123/);
      assert.ok((await page.locator('#task-summary').innerText()).includes(valuationPolicy.digest));
      const prepareCount = requests.filter(path => path === 'tasks/prepare').length;
      await page.locator('#task-code').fill('654321'); await page.locator('#task-ack').check();
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(await page.locator('#task-code').inputValue(), '');
      await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(requests.filter(path => path === 'tasks/prepare').length, prepareCount);
      assert.equal(await page.locator('#task-authorize-fields').isVisible(), true);
      const canonicalPolicy = page.locator('#task-canonical');
      // The policy is an intentionally collapsed disclosure. Inspect its exact
      // stored text, then open it through the user control before testing layout.
      assert.equal(await canonicalPolicy.textContent(), canonical);
      await canonicalPolicy.locator('..').locator('summary').click();
      await canonicalPolicy.waitFor({ state: 'visible' });
      assert.equal(await canonicalPolicy.innerText(), canonical);
      for (const locale of ['zh-Hans', 'zh-Hant', 'fr', 'es', 'ja', 'en']) {
        await page.locator('#ui-locale').selectOption(locale);
        assert.equal(await canonicalPolicy.isVisible(), true, `${locale}: canonical policy remains visible`);
        assert.equal(await canonicalPolicy.innerText(), canonical);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewport.width}:${locale}: no horizontal overflow`);
      }
      assert.equal(requests.filter(path => path === 'tasks/prepare').length, prepareCount);
      if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/task-review-${viewport.width}.png`, fullPage: true }); }
      await page.locator('#task-cancel').click(); assert.equal(await page.locator('#task-authorize-fields').isVisible(), false);
      await page.locator('#task-recheck').click(); await page.locator('#task-authorize-fields').waitFor({ state: 'visible' });
      await page.locator('[data-route="activity"]').first().click(); await page.goBack();
      await page.locator('#task-authorize-fields').waitFor({ state: 'visible' });
      await page.locator('#task-code').fill('123456'); await page.locator('#task-ack').check(); await page.locator('#task-authorize').click();
      await page.waitForFunction(() => document.getElementById('task-status').textContent.includes('continuation blocked'));
      assert.equal(await page.locator('#task-code').inputValue(), ''); assert.ok(requests.includes('tasks/resume'));
      assert.equal(requests.filter(path => path === 'tasks/authorize').length, 1);
      await page.reload(); await login();
      await page.waitForFunction(() => document.getElementById('task-status').textContent.includes('continuation blocked'));
      assert.equal(await page.locator('#task-page').isVisible(), true);
      assert.equal(requests.filter(path => path === 'tasks/authorize').length, 1);
      assert.equal(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, history: history.state })), JSON.stringify({ local: { '8415wallet.ui.locale.v1': 'en' }, session: {}, history: { walletPage: 'tasks', walletTaskDigest: task.digest } }));
      if (evidence) await page.screenshot({ path: `${evidence}/task-authorized-blocked-${viewport.width}.png`, fullPage: true });
      assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser?.close(); server.kill('SIGTERM'); }
});

/** Isolated real-DOM contract, not a claim that foundation mounts task UI. */
test('synthetic real-DOM pre-operational approval hides OTP guidance and sends only empty code', async () => {
  const port = await endpoint(), origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/controls/serve-browser.cjs'], { cwd: root, env: { ...process.env, WALLET_BROWSER_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await once(server.stdout, 'data'); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.WALLET_BROWSER_CHROMIUM ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/task-factor-fixture.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
      await page.goto(`${origin}/task-factor-fixture.html`);
      const account = `0x${'11'.repeat(20)}`;
      const task = freezeTaskPolicy({ schema: '8415-agent-task/1', taskId: 'synthetic-preoperational', origin, tenant: 'default', chainId: '1', actor: account,
        expiresAt: String(Math.floor(Date.now() / 1000) + 3600), fees: { perOperationWei: '1', totalWei: '1' },
        intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId: '1', actor: account, recipient: `0x${'22'.repeat(20)}`, valueWei: '1' } } });
      const identity = { schema: '8415-task-executor/1', agentId: 'synthetic-agent', agentVersion: '1', adapterId: 'synthetic-test-adapter', adapterVersion: '1', implementationDigest: `0x${'9'.repeat(64)}` };
      const executor = { identity, digest: `0x${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}` };
      const ids = [...readFileSync(new URL('../web/index.html', import.meta.url), 'utf8').matchAll(/id="(task-[^"]+)"/g)].map(match => match[1]);
      await page.evaluate(async ({ ids, account, task, executor, budget }) => {
        const el = id => document.getElementById(id);
        for (const id of new Set(ids)) {
          const node = document.createElement(id === 'task-authorize-form' ? 'form' : ['task-code', 'task-ack'].includes(id) ? 'input' : id === 'task-authorize' ? 'button' : 'div');
          node.id = id; document.body.append(node);
        }
        el('task-code').type = 'password'; el('task-ack').type = 'checkbox'; el('task-authorize').type = 'button'; el('task-authorize').textContent = 'Authorize';
        el('task-authorize-form').append(el('task-authorize-fields'));
        el('task-authorize-fields').append(el('task-authenticator-help'), el('task-code-label'), el('task-code'), el('task-ack'), el('task-authorize'));
        const evaluation = { state: 'NOT_EVALUATED', reason: 'pre-operational-default-on', policyRevision: '0' };
        const session = { origin: location.origin, account, chainId: '1', tenant: 'default', id: 1, serverId: 'synthetic-server' };
        let authorized = false;
        window.factorRequests = [];
        const view = () => ({ task, executor, observationPolicy: null, receiptVerifier: null, observations: [], observationRevision: '0', completion: { state: 'not-attempted', fresh: false },
          authorization: authorized ? { schema: '8415-task-authorization-reference/1', taskDigest: task.digest, reference: 'grant:synthetic', status: 'authorized', grantPolicyVersion: '1', credentialRevisionAtApproval: '0' } : null,
          effectiveStatus: authorized ? 'authorized' : 'pending', budget: authorized ? budget : null,
          ...(authorized ? { approvalFactor: 'preoperational-default-on', approvalEvaluation: evaluation } : {}),
          capabilities: { executable: false, adapterConfigured: false, receiptVerifierConfigured: false, missing: ['TASK_EXECUTION_ADAPTER_NOT_CONNECTED'] } });
        const request = async (path, body) => {
          window.factorRequests.push({ path, body });
          if (path === 'tasks/list') return { tasks: [view()], nextCursor: null, revision: '1' };
          if (path === 'tasks/status') return view();
          if (path === 'tasks/prepare') return { task, executor, observationPolicy: null, receiptVerifier: null, purpose: 'authorize-task', challengeId: `challenge:${'a'.repeat(43)}`, expiresAt: Date.now() + 120000, approvalFactor: 'preoperational-default-on', approvalEvaluation: evaluation };
          if (path === 'tasks/authorize') { if (body.code !== '') throw Error('NONEMPTY_CODE'); authorized = true; return view(); }
          if (path === 'tasks/resume') return { ...view(), continuation: { state: 'blocked', code: 'TASK_EXECUTION_ADAPTER_NOT_CONNECTED' } };
          throw Error('Unexpected fixture request');
        };
        const { mountTaskAuthorization } = await import('/web/task-authorization-ui.mjs');
        history.replaceState({ walletTaskDigest: task.digest }, '');
        window.factorUi = mountTaskAuthorization({ document, window, walletLogin: { check: async () => session, capture: () => ({}), assert: () => session, subscribe() {} }, getClient: () => ({ request }) });
        document.dispatchEvent(new CustomEvent('wallet:page', { detail: 'tasks' }));
      }, { ids, account, task, executor, budget: emptyTaskBudget(task) });
      await page.waitForFunction(() => window.factorUi.snapshot()?.phase === 'review');
      for (const id of ['task-code', 'task-code-label', 'task-authenticator-help']) assert.equal(await page.locator(`#${id}`).isVisible(), false);
      assert.equal(await page.locator('#task-code').isDisabled(), true);
      assert.equal(await page.locator('#task-code').evaluate(node => node.required), false);
      for (const locale of ['en', 'zh-Hans', 'zh-Hant', 'fr', 'es', 'ja']) {
        const expected = await page.evaluate(async locale => { const i18n = await import('/web/i18n.mjs'); i18n.setLocale(locale, { persist: false }); return i18n.t('task.approvalNotEvaluated'); }, locale);
        assert.ok((await page.locator('#task-summary').innerText()).includes(expected));
      }
      await page.evaluate(() => { document.getElementById('task-code').value = '654321'; });
      await page.locator('#task-ack').check(); await page.locator('#task-authorize').click();
      await page.waitForFunction(() => window.factorUi.snapshot()?.phase === 'authorized-blocked');
      const sent = await page.evaluate(() => window.factorRequests.filter(request => request.path === 'tasks/authorize'));
      assert.equal(sent.length, 1); assert.equal(sent[0].body.code, '');
      assert.equal(await page.locator('#task-code').inputValue(), '');
      assert.match(await page.locator('#task-summary').innerText(), /NOT_EVALUATED/);
      assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser?.close(); server.kill('SIGTERM'); }
});
