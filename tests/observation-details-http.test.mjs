/** Synthetic loopback HTTP authentication and observation-route boundaries, not live-chain acceptance.
 * No browser, injected UI provider, real
 * wallet key, password, TOTP, transaction signing or broadcast is used here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Wallet } from 'ethers';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';

async function fixture(t) {
  const wallet = Wallet.createRandom(), chainId = '560048', tenant = 'synthetic';
  const now = () => 1900000000000;
  const registration = { version: 1, email: 'tester@example.invalid', verifiedAt: 1 };
  const store = new MemoryCredentialStore({
    [`${tenant}:tester`]: { registration, revision: 1 },
    [`@registration:${tenant}`]: { version: 1, records: [{ username: 'tester', email: registration.email, verifiedAt: registration.verifiedAt }] },
  });
  let handler, sideEffects = 0;
  const server = createServer((req, res) => handler(req, res));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Read-only route rejection tests need no task grant or test-asset exemption.
  const forbiddenSideEffect = () => { sideEffects++; assert.fail('authentication and grant approval cannot sign or send a transaction'); };
  handler = createAuthService({
    origin, tenant, store, now,
    accounts: [{ username: 'tester', wallets: [{ account: wallet.address, chainId }] }],
    taskExecution: { verify: forbiddenSideEffect, send: forbiddenSideEffect, recover: forbiddenSideEffect },
    taskExecutorIdentity: { schema: '8415-task-executor/1', agentId: 'synthetic:agent', agentVersion: '1',
      adapterId: 'synthetic:adapter', adapterVersion: '1', implementationDigest: `0x${'3'.repeat(64)}` },
    taskObservationPolicy: { minimumConfirmations: '2' },
  });
  function client() {
    const jar = new Map(); let csrf = '';
    async function call(path, body, overrides = {}) {
      const response = await fetch(`${origin}/auth/${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { Origin: origin, 'X-Wallet-Tenant': tenant, 'X-Wallet-CSRF': csrf,
          Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...overrides },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0], split = pair.indexOf('='), name = pair.slice(0, split), value = pair.slice(split + 1);
        if (value) jar.set(name, value); else jar.delete(name);
      }
      const data = await response.json();
      if (response.ok && data.csrf) csrf = data.csrf;
      return { status: response.status, data, headers: response.headers };
    }
    async function login() {
      assert.equal((await call('bootstrap')).status, 200);
      const challenge = await call('challenge', { method: 'wallet', account: wallet.address, chainId });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.data.origin, origin); assert.equal(challenge.data.tenant, tenant);
      assert.equal(challenge.data.chainId, chainId); assert.equal(challenge.data.account, wallet.address);
      assert.match(challenge.data.message, /urn:8415wallet:purpose:login/);
      const proof = { account: wallet.address, chainId, id: challenge.data.id,
        signature: await wallet.signMessage(challenge.data.message) };
      const result = await call('proof', proof);
      assert.equal(result.status, 200); assert.equal(result.data.kind, 'wallet');
      assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
      return { result, proof };
    }
    return { call, login };
  }
  return { client, sideEffects: () => sideEffects };
}

test('observation source and details share original authenticated cookie CSRF and origin boundary', async t => {
  const f = await fixture(t), c = f.client();
  for (const path of ['tasks/observation-source','tasks/observation-details']) {
    assert.equal((await c.call(path, {})).status, 401);
  }
  await c.login();
  for (const path of ['tasks/observation-source','tasks/observation-details']) {
    assert.equal((await c.call(path, {}, { 'X-Wallet-CSRF': 'untrusted' })).status, 401);
    assert.equal((await c.call(path, {}, { Origin: 'https://other.example.invalid' })).status, 403);
    assert.equal((await c.call(path, {}, { 'X-Wallet-Tenant': 'other' })).status, 403);
  }
  assert.equal(f.sideEffects(), 0);
});

test('authenticated observation routes dispatch to strict internal methods rather than generic handler', async t => {
  const f = await fixture(t), c = f.client(); await c.login();
  for (const path of ['tasks/observation-source','tasks/observation-details']) {
    const result = await c.call(path, {});
    assert.equal(result.status, 400);
    assert.notEqual(result.data.error, 'TASK_ROUTE_NOT_FOUND');
    assert.notEqual(result.data.error, 'TASK_OBSERVATION_SOURCE_UNSUPPORTED');
  }
  await c.call('logout', {});
  assert.equal((await c.call('tasks/observation-source', {})).status, 401);
  assert.equal(f.sideEffects(), 0);
});
