/** Synthetic loopback HTTPS/mTLS authentication and grant boundaries, not live-chain acceptance.
 * No browser, injected UI provider, real
 * wallet key, password, TOTP, transaction signing or broadcast is used here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { Wallet } from 'ethers';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { createTaskTestAssetAuthorization } from '../server/task-test-asset-authorization.mjs';
import { certificates, service } from './helpers/task-https-fixture.mjs';

async function fixture(t, { scoped = true } = {}) {
  const wallet = Wallet.createRandom(), recipient = Wallet.createRandom().address.toLowerCase();
  const actor = wallet.address.toLowerCase(), chainId = '560048', tenant = 'synthetic';
  const now = () => 1900000000000;
  const registration = { version: 1, email: 'tester@example.invalid', verifiedAt: 1 };
  const store = new MemoryCredentialStore({
    [`${tenant}:tester`]: { registration, revision: 1 },
    [`@registration:${tenant}`]: { version: 1, records: [{ username: 'tester', email: registration.email, verifiedAt: registration.verifiedAt }] },
  });
  let handler, sideEffects = 0;
  const certs = await certificates(t);
  const { url: origin } = await service(t, certs, (req, res) => {
    assert.equal(req.socket.authorized, true);
    assert.equal(req.socket.getPeerCertificate().fingerprint256.replaceAll(':', '').toLowerCase(), certs.wallet.fingerprint);
    handler(req, res);
  });
  const mode = scoped ? await createTaskTestAssetAuthorization({
    inventory: { schema: '8415-agent-test-assets/1', chainId, origin, tenant,
      expiresAt: '2000000000', wallets: [actor, recipient], assets: [] },
    authorizedWallets: [actor, recipient].map(account => ({ account, chainId })), now,
  }) : null;
  const forbiddenSideEffect = () => { sideEffects++; assert.fail('authentication and grant approval cannot sign or send a transaction'); };
  handler = createAuthService({
    origin, tenant, store, now,
    accounts: [{ username: 'tester', wallets: [{ account: wallet.address, chainId }] }],
    taskTestAuthorization: mode,
    taskExecution: { verify: forbiddenSideEffect, send: forbiddenSideEffect, recover: forbiddenSideEffect },
    taskExecutorIdentity: { schema: '8415-task-executor/1', agentId: 'synthetic:agent', agentVersion: '1',
      adapterId: 'synthetic:adapter', adapterVersion: '1', implementationDigest: `0x${'3'.repeat(64)}` },
    taskObservationPolicy: { minimumConfirmations: '2' },
  });
  function client() {
    const jar = new Map(); let csrf = '';
    async function call(path, body, overrides = {}) {
      const response = await new Promise((resolve, reject) => {
        const request = httpsRequest(`${origin}/auth/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { Origin: origin, 'X-Wallet-Tenant': tenant, 'X-Wallet-CSRF': csrf,
            Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...overrides },
          cert: certs.wallet.certBytes, key: certs.wallet.keyBytes, ca: certs.caBytes,
          rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false,
          checkServerIdentity(host, certificate) {
            return checkServerIdentity(host, certificate) ||
              (certificate.fingerprint256?.replaceAll(':', '').toLowerCase() !== certs.journal.fingerprint
                ? Error('TEST_HTTPS_PEER_REFUSED') : undefined);
          },
        }, incoming => {
          const chunks = [];
          incoming.on('data', chunk => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () => {
            try {
              const status = incoming.statusCode;
              assert.ok(status < 300 || status >= 400, 'test HTTPS client refuses redirects');
              const headers = new Headers();
              for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
              resolve({ status, headers, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
            } catch (error) { reject(error); }
          });
        });
        request.on('error', reject);
        request.setTimeout(5000, () => request.destroy(Error('TEST_HTTPS_TIMEOUT')));
        request.end(body === undefined ? undefined : JSON.stringify(body));
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0], split = pair.indexOf('='), name = pair.slice(0, split), value = pair.slice(split + 1);
        if (value) jar.set(name, value); else jar.delete(name);
      }
      const { data } = response;
      if (response.status >= 200 && response.status < 300 && data.csrf) csrf = data.csrf;
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
      assert.match(result.headers.get('set-cookie'), /; Secure/);
      return { result, proof };
    }
    return { call, login };
  }
  const policy = { schema: '8415-agent-task/1', taskId: 'synthetic:api-native', tenant, origin, chainId, actor,
    expiresAt: '1950000000', fees: { perOperationWei: '100000', totalWei: '100000' },
    intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId, actor, recipient, valueWei: '1' } } };
  const authorization = prepared => ({ challengeId: prepared.challengeId, taskDigest: prepared.task.digest,
    executorDigest: prepared.executor.digest, observationPolicyDigest: prepared.observationPolicy.digest, code: '' });
  return { client, policy, authorization, sideEffects: () => sideEffects, actor, chainId };
}

test('API-only real HTTPS login proof and native test grant require no browser or password/TOTP input', async t => {
  const f = await fixture(t), c = f.client(); await c.login();
  const session = await c.call('session'); assert.equal(session.status, 200);
  assert.equal(session.data.account.toLowerCase(), f.actor); assert.equal(session.data.chainId, f.chainId);
  const prepared = await c.call('tasks/prepare', { policy: f.policy }); assert.equal(prepared.status, 200);
  assert.equal(prepared.data.approvalFactor, 'server-test-scope'); assert.equal(prepared.data.purpose, 'authorize-task');
  const approved = await c.call('tasks/authorize', f.authorization(prepared.data));
  assert.equal(approved.status, 200); assert.equal(approved.data.effectiveStatus, 'authorized');
  assert.equal(approved.data.capabilities.executable, false);
  const read = await c.call('tasks/status', { taskDigest: prepared.data.task.digest });
  assert.equal(read.status, 200); assert.equal(read.data.authorization.taskDigest, prepared.data.task.digest);
  // A new display service is not silently enabled by a task grant or a login.
  const unopened = await c.call('assets/forward-progress', {
    asset: { chainId: f.chainId, contract: `0x${'4'.repeat(40)}`, tokenId: '1' }, sequenceId: `0x${'5'.repeat(64)}`,
  });
  assert.equal(unopened.status, 503); assert.equal(unopened.data.error, 'FORWARD_PROGRESS_NOT_ENABLED');
  assert.equal(f.sideEffects(), 0);
});

test('tenant and Origin headers alone cannot create task authority; real sessions still require CSRF and origin', async t => {
  const f = await fixture(t), c = f.client();
  assert.equal((await c.call('tasks/prepare', { policy: f.policy })).status, 401);
  await c.login();
  assert.equal((await c.call('tasks/prepare', { policy: f.policy }, { 'X-Wallet-CSRF': 'untrusted' })).status, 401);
  assert.equal((await c.call('tasks/prepare', { policy: f.policy }, { Origin: 'https://other.example.invalid' })).status, 403);
  assert.equal((await c.call('tasks/prepare', { policy: f.policy }, { 'X-Wallet-Tenant': 'other' })).status, 403);
  assert.equal(f.sideEffects(), 0);
});

test('an API caller cannot select the server test exemption when no matching server scope exists', async t => {
  const f = await fixture(t, { scoped: false }), c = f.client(); await c.login();
  const forged = await c.call('tasks/prepare', { policy: f.policy, approvalFactor: 'server-test-scope' });
  assert.notEqual(forged.status, 200);
  const prepared = await c.call('tasks/prepare', { policy: f.policy }); assert.equal(prepared.status, 200);
  assert.equal(prepared.data.approvalFactor, 'preoperational-default-on');
  assert.equal((await c.call('tasks/authorize', f.authorization(prepared.data))).status, 200);
  assert.equal(f.sideEffects(), 0);
});

test('API login proof cannot be replayed in a new bootstrap and logout removes task access', async t => {
  const f = await fixture(t), c = f.client(), { proof } = await c.login();
  const other = f.client(); assert.equal((await other.call('bootstrap')).status, 200);
  assert.equal((await other.call('proof', proof)).status, 401);
  assert.equal((await c.call('logout', {})).status, 200);
  assert.equal((await c.call('tasks/prepare', { policy: f.policy })).status, 401);
  assert.equal(f.sideEffects(), 0);
});
