/** Real loopback HTTP; synthetic identity/store only. No signer/RPC or production data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Wallet } from 'ethers';
import { createAuthService } from '../server/v2/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
import { AccountAuthClient } from '../web/account-auth.mjs';
import { bootstrapStandaloneListing, ensureStandaloneListingCondition } from '../server/v2/listing-binding.mjs';
const signer = new Wallet('0x' + '1'.repeat(64));
const password = 'synthetic-v2-only-password';
const passwordHash = await hashPassword(password);
async function fixture(t, extra = {}) {
  let handler;
  const server = createServer((request, response) => handler(request, response));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`, tenant = 'fixture';
  const registration = { version: 1, email: 'owner@example.invalid', verifiedAt: 1 };
  const store = new MemoryCredentialStore({ 'fixture:owner': { registration }, '@registration:fixture': {
    version: 1, records: [{ username: 'owner', email: registration.email, verifiedAt: registration.verifiedAt }] } });
  handler = createAuthService({ origin, tenant, store, taskVerificationPolicyEnabled: true,
    accounts: [{ username: 'owner', passwordHash, wallets: [{ account: signer.address, chainId: '1' }] }], ...extra });
  const jar = new Map();
  const request = async (path, input = {}) => {
    const response = await fetch(`${origin}${path}`, { ...input, headers: {
      'X-Wallet-Tenant': tenant, Origin: origin, Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...input.headers } });
    for (const c of response.headers.getSetCookie()) { const [key, value] = c.split(';')[0].split('='); if (value) jar.set(key, value); else jar.delete(key); }
    return response;
  };
  const client = new AccountAuthClient({ origin, tenant, fetcher: (url, input) => request(url.pathname, input) });
  return { origin, request, client, login: () => client.adapter('password', { username: 'owner', password }).authenticate({ account: signer.address, chainId: '1' }, null) };
}
test('V2 real HTTP retains password login, account management and operational owner policy', async t => {
  const f = await fixture(t); await f.login(); const account = await f.client.account();
  assert.equal(account.account, signer.address); assert.equal(account.chainId, '1');
  assert.equal(account.forwardProgressAvailable, false);
  assert.equal(account.methods.password.enabled, true);
  assert.notEqual(account.taskHumanVerification, null);
  const forged = await f.request('/auth/assets/forward-progress', { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://wrong.example.invalid' }, body: '{}' });
  assert.equal(forged.status, 403); assert.equal((await forged.json()).error, 'AUTH_ORIGIN_REFUSED');
});
test('V2 preserves session and CSRF checks rather than returning fake chain progress', async t => {
  const f = await fixture(t);
  const unauthenticated = await f.request('/auth/assets/forward-progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.notEqual(unauthenticated.status, 200);
  await f.login();
  await assert.rejects(f.client.readForwardProgress({ asset: { chainId: '1', contract: signer.address.toLowerCase(), tokenId: '1' }, sequenceId: '0x'+'2'.repeat(64) }), /FORWARD_PROGRESS_NOT_APPLICABLE/);
});
test('V2 rejects linked reader injection at composition, never silently ignores it', () => {
  assert.throws(() => createAuthService({ forwardProgressReader: {} }), /AUTH_V2_LINKED_CAPABILITY_REFUSED/);
  assert.throws(() => createAuthService({ forwardProgressSource: {} }), /AUTH_V2_LINKED_CAPABILITY_REFUSED/);
});
test('ordinary NFT sale remains an explicit capability, not a fabricated successful runtime', async t => {
  const binding = await bootstrapStandaloneListing();
  const f = await fixture(t, binding.runtime.authOptions);
  const caps = await (await f.request('/auth/capabilities')).json();
  assert.equal(caps.taskAuthorization.listing.adapterConfigured, false);
  assert.equal(caps.taskAuthorization.listing.code, 'TASK_LISTING_NOT_CONFIGURED');
  const missing = await bootstrapStandaloneListing({ configuration: { schema: '8415-task-listing-runtime/1', enabled: true } });
  assert.equal(missing.runtime.state, 'disabled');
  assert.equal(missing.runtime.code, 'TASK_LISTING_CONFIGURATION_REQUIRED');
});
