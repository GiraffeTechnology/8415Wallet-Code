/** Synthetic HTTP transport boundary; no network, provider, credential or chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountAuthClient } from '../web/account-auth.mjs';
const origin = 'https://wallet.example.invalid', tenant = 'synthetic', account = '0x' + '1'.repeat(40);
const session = { origin, tenant, username: 'alice', account, chainId: '560048', csrf: 'synthetic-session-csrf' };
const scope = { origin, tenant, username: 'alice', account, chainId: '560048', agentId: 'synthetic-agent' };
function fixture() {
  const calls: string[] = [], request = { schema: '8415-task-human-verification-change/2', scope, mode: 'ON', expectedRevision: '0',
    credentialRevision: 0, changeId: 'c'.repeat(43), nonce: 'n'.repeat(43), issuedAt: 1900000000000, expiresAt: 1900000300000 };
  let rebound = false, mode = 'ON';
  const status = () => ({ schema: '8415-task-human-verification/2', scope: rebound ? { ...scope, agentId: 'different-agent' } : scope,
    mode, revision: '1', enforcedFromRevision: '1', changeCount: 1,
    label: 'Per-operation human verification', appliesTo: 'still-valid-in-scope-authorizations', grantsAuthority: false,
    lastChange: { revision: '1', mode, changeDigest: 'd'.repeat(64), verifiedFactors: ['password', 'verified-email'] } });
  const client = new AccountAuthClient({ origin, tenant, fetcher: async (url: URL, options: any) => {
    const path = url.pathname.slice('/auth/'.length); calls.push(path);
    const body = options.body ? JSON.parse(options.body) : {};
    let data: any;
    if (path === 'capabilities') data = { schema: '8415wallet-auth/1', origin, tenant, methods: ['password'] };
    else if (path === 'bootstrap') data = { csrf: 'synthetic-preauth' };
    else if (path === 'password') data = session;
    else if (path === 'account/task-verification/prepare') {
      request.mode = body.mode;
      data = { request, changeDigest: 'd'.repeat(64), identityMethod: 'password', emailMasked: 'a***@example.invalid' };
    } else if (path === 'account/task-verification/verify') data = { changeId: request.changeId, changeDigest: 'd'.repeat(64),
      digits: 8, emailMasked: 'a***@example.invalid', expiresAt: request.expiresAt };
    else if (path === 'account/task-verification/confirm') { mode = request.mode; data = status(); }
    else if (path === 'account/task-verification/cancel') data = { cancelled: true };
    else if (path === 'logout') data = { loggedOut: true };
    else data = status();
    return { ok: true, text: async () => JSON.stringify(data) };
  } });
  return { client, calls, rebound() { rebound = true; },
    async login() { await client.adapter('password', { username: 'alice', password: 'synthetic' }).authenticate({ account, chainId: '560048' }, null); },
    body: () => ({ changeId: request.changeId, changeDigest: 'd'.repeat(64) }) };
}
for (const mode of ['ON', 'OFF']) test('client confirms exact prepared ' + mode + ' scope and next revision', async () => {
  const f = fixture(); await f.login();
  await f.client.taskVerification('prepare', { mode, expectedRevision: '0', identityMethod: 'password' });
  await f.client.taskVerification('verify', { ...f.body(), password: 'synthetic' });
  assert.equal((await f.client.taskVerification('confirm', { ...f.body(), code: '12345678' })).mode, mode);
  await assert.rejects(f.client.taskVerification('confirm', { ...f.body(), code: '12345678' }), /BINDING_REFUSED/);
});
test('client refuses direct ON before transport and rejects cross-agent confirmation', async () => {
  const f = fixture(); await f.login(); const before = f.calls.length;
  await assert.rejects(f.client.taskVerification('on', { expectedRevision: '0' }), /AUTH_ROUTE_REFUSED/);
  assert.equal(f.calls.length, before);
  await f.client.taskVerification('prepare', { mode: 'ON', expectedRevision: '0', identityMethod: 'password' }); f.rebound();
  await assert.rejects(f.client.taskVerification('confirm', { ...f.body(), code: '12345678' }), /BINDING_REFUSED/);
});
