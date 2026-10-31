/** Approved Linux loopback HTTP composition with synthetic identities. The Host
 * header models canonical transport; this does not prove production TLS. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { Wallet } from 'ethers';
import { createAuthService } from '../server/auth-service.mjs';
import { createAuthService as createStandaloneService } from '../server/v2/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { createOriginContinuation, originContinuationKey } from '../server/origin-continuation.mjs';
for (const [profile, createService] of [['linked', createAuthService], ['standalone', createStandaloneService]])
test(`${profile}: authenticated fixed context preserves transport login and rejects wrong tenant, Host and CSRF`, async t => {
  const wallet = Wallet.createRandom(), origin = 'https://wallet.example', tenant = 'fixture', chainId = '560048';
  const m = createOriginContinuation({ schema: '8415wallet-origin-continuation/1', tenant, transportOrigin: origin,
    authorizationOrigin: origin + ':9446', revision: '1', priorStateSha256: 'a'.repeat(64), contractDigest: 'b'.repeat(64),
    principals: [{ username: 'tester', account: wallet.address.toLowerCase(), chainId }] });
  const registration = { version: 1, email: 'tester@example.invalid', verifiedAt: 1 };
  const store = new MemoryCredentialStore({ [originContinuationKey(m)]: m,
    'fixture:tester': { registration, revision: 1 },
    '@registration:fixture': { version: 1, records: [{ username: 'tester', email: registration.email, verifiedAt: 1 }] } });
  const handler = createService({ origin, tenant, store, accounts: [{ username: 'tester', wallets: [{ account: wallet.address, chainId }] }] });
  const server = createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const jar = new Map(); let csrf = '';
  async function call(path, body, overrides = {}) {
    const response = await new Promise((resolve, reject) => {
      const req = request(`http://127.0.0.1:${server.address().port}/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Host: 'wallet.example', Origin: origin,
        'X-Wallet-Tenant': tenant, 'X-Wallet-CSRF': csrf, Cookie: [...jar].map(([k,v]) => k + '=' + v).join('; '),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...overrides },
      }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(Buffer.concat(chunks).toString()) })); });
      req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
    for (const c of response.headers['set-cookie'] ?? []) { const [k,v] = c.split(';')[0].split('='); if (v) jar.set(k,v); else jar.delete(k); }
    if (response.status === 200 && response.data.csrf) csrf = response.data.csrf;
    return response;
  }
  assert.equal((await call('authorization-context')).status, 401);
  assert.equal((await call('bootstrap')).status, 200);
  const challenge = await call('challenge', { method: 'wallet', account: wallet.address, chainId });
  assert.equal(challenge.status, 200); assert.equal(challenge.data.origin, origin);
  assert.equal(challenge.data.message.includes(':9446'), false);
  const proof = await call('proof', { id: challenge.data.id, account: wallet.address, chainId, signature: await wallet.signMessage(challenge.data.message) });
  assert.equal(proof.status, 200); assert.equal(proof.data.origin, origin);
  const context = await call('authorization-context'); assert.equal(context.status, 200);
  assert.equal(context.data.authorizationOrigin, origin + ':9446'); assert.equal(context.data.transportOrigin, origin);
  assert.equal(context.data.continuation.digest, m.digest); assert.equal(context.data.account, wallet.address);
  for (const headers of [{ 'X-Wallet-Tenant': 'other' }, { Host: 'wallet.example:9446' }, { 'X-Wallet-CSRF': 'wrong' }])
    assert.ok([401,403].includes((await call('authorization-context', undefined, headers)).status));
  assert.equal((await call('logout', {})).status, 200);
  assert.equal((await call('authorization-context')).status, 401);
});
