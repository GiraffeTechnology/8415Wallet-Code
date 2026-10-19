/** Read-only foundation integration. Execute only on an approved Linux server. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTaskVerificationPolicyClient } from '../web/task-verification-policy-client.mjs';

function fixture() {
  const session = { serverId: 'synthetic-session', origin: 'https://wallet.example.invalid',
    tenant: 'example', account: '0x1111111111111111111111111111111111111111', chainId: '1' };
  const scope = { origin: session.origin, tenant: session.tenant, username: 'synthetic',
    account: session.account, chainId: session.chainId, agentId: 'synthetic-agent' };
  const calls = [];
  let active = true, accountEnabled = true;
  const account = { ...scope, taskHumanVerification: {} };
  const status = { schema: '8415-task-human-verification/1', scope, mode: 'ON', revision: '0',
    label: 'Per-operation human verification', appliesTo: 'still-valid-in-scope-authorizations',
    grantsAuthority: false, factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
    factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'], changeCount: 0, lastChange: null };
  const binding = Object.freeze({ id: 'synthetic-binding' });
  const walletLogin = { assert(value) { if (!active || value !== binding) throw Error('LOGIN_SESSION_CHANGED'); return session; } };
  const client = { async account() { calls.push('account'); return { ...account, taskHumanVerification: accountEnabled ? {} : null }; },
    async taskVerification(action) { calls.push(action); return status; } };
  const adapter = createTaskVerificationPolicyClient({ client, walletLogin, document: {}, window: { crypto: globalThis.crypto } });
  return { adapter, binding, calls, status, session, scope, account,
    deactivate() { active = false; }, disableService() { accountEnabled = false; } };
}

test('mounted foundation bridge reads authoritative initial ON without inventing permissions or change authority', async () => {
  const f = fixture(), view = await f.adapter.read({ binding: f.binding });
  assert.equal(view.mode, 'ON'); assert.equal(view.revision, '0');
  assert.equal(view.canChange, false); assert.equal(view.permissions, null);
  assert.deepEqual(f.calls, ['account', 'status']);
});

test('authoritative saved OFF is retained by the read-only connection instead of resetting ON', async () => {
  const f = fixture();
  const scopeDigest = createHash('sha256').update(JSON.stringify(f.scope)).digest('hex');
  Object.assign(f.status, { schema: '8415-task-human-verification/2', mode: 'OFF', revision: '1',
    enforcedFromRevision: '1', changeCount: 1, lastChange: { revision: '1', previousRevision: '0', mode: 'OFF',
      changeId: 'c'.repeat(43), changeDigest: 'd'.repeat(64), scopeDigest,
      credentialRevision: 1, verifiedFactors: ['password', 'verified-email'], changedAt: 1 } });
  const view = await f.adapter.read({ binding: f.binding });
  assert.equal(view.mode, 'OFF'); assert.equal(view.revision, '1'); assert.equal(view.canChange, false);
  assert.deepEqual(f.calls, ['account', 'status']);
});

test('direct change through the mounted read bridge cannot dispatch prepare, factors or confirmation', async () => {
  const f = fixture(), view = await f.adapter.read({ binding: f.binding });
  await assert.rejects(f.adapter.change({ binding: f.binding, expectedRevision: view.revision,
    expectedScopeKey: view.scopeKey, mode: 'OFF' }), /TASK_VERIFICATION_REVISION_CONFLICT/);
  assert.ok(f.calls.every(action => ['account', 'status'].includes(action)));
});

test('disabled backend policy stays unavailable without probing status or fabricating a saved default', async () => {
  const f = fixture(); f.disableService();
  await assert.rejects(f.adapter.read({ binding: f.binding }), /TASK_POLICY_ADAPTER_UNAVAILABLE/);
  assert.deepEqual(f.calls, ['account']);
});

test('account or chain substitution and invalidated login cannot become a current policy view', async () => {
  for (const field of ['account', 'chainId']) {
    const f = fixture(); f.status.scope = { ...f.scope, [field]: field === 'account' ? '0x2222222222222222222222222222222222222222' : '8453' };
    await assert.rejects(f.adapter.read({ binding: f.binding }), /TASK_POLICY_WIRE_REFUSED/);
  }
  const f = fixture(); f.deactivate();
  await assert.rejects(f.adapter.read({ binding: f.binding }), /LOGIN_SESSION_CHANGED/);
  assert.deepEqual(f.calls, []);
});
