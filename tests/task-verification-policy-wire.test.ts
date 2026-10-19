/** Verified-92b wire-shape fixtures. Synthetic only; not live server acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createTaskVerificationPolicyWire } from '../web/task-verification-policy-wire.mjs';
import { createTaskVerificationPolicyClient } from '../web/task-verification-policy-client.mjs';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = { origin: 'https://wallet.example.invalid', tenant: 'synthetic', username: 'owner',
  account: '0x' + '1'.repeat(40), chainId: '560048', agentId: 'synthetic:agent' };
const session = { ...scope, serverId: 'synthetic-session' }, account = { ...scope };
const common = { scope, label: 'Per-operation human verification', appliesTo: 'still-valid-in-scope-authorizations',
  grantsAuthority: false, factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
  factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'] };
const initial = () => ({ schema: '8415-task-human-verification/1', ...common, mode: 'ON', revision: '0', changeCount: 0, lastChange: null });
const wire = createTaskVerificationPolicyWire({ crypto: webcrypto });
function fixture(mode: 'ON' | 'OFF' = 'OFF', identityMethod: 'password' | 'wallet' = 'password') {
  const request = { schema: '8415-task-human-verification-change/2', scope, mode, expectedRevision: '0',
    credentialRevision: 7, changeId: 'c'.repeat(43), nonce: 'n'.repeat(43), issuedAt: 1000, expiresAt: 301000 };
  const changeDigest = hash(request);
  const message = [`8415wallet owner policy change: Per-operation human verification ${mode}`,
    `Scope: ${JSON.stringify(scope)}`, 'Applies only to still-valid, in-scope authorizations; no new task authority.',
    mode === 'OFF' ? 'Preparation, signing, submission, continuation and receipts will not ask again within existing authority.' :
      'Future not-yet-submitted operations use ON verification. Existing submitted/unknown attempts are reconciled without resubmission.',
    'Revision: 0', 'Credential revision: 7', `Change: ${request.changeId}`, `Nonce: ${request.nonce}`, `Digest: ${changeDigest}`,
    'Expires at: 301000', 'Purpose: policy change only; no login, recovery, or transaction signature.'].join('\n');
  const response = { request, changeDigest, identityMethod, emailMasked: 'o***@example.invalid',
    ...(identityMethod === 'wallet' ? { message } : {}) };
  const options = { session, account, mode, identityMethod, now: 2000, reviewed: { revision: '0', scopeKey: hash(scope) } };
  const verified = { changeId: request.changeId, changeDigest, emailMasked: response.emailMasked, digits: 8, expiresAt: request.expiresAt };
  const audit = { revision: '1', previousRevision: '0', mode, changeId: request.changeId, changeDigest,
    scopeDigest: hash(scope), credentialRevision: 7, verifiedFactors: [identityMethod, 'verified-email'], changedAt: 3000 };
  const committed = { schema: '8415-task-human-verification/2', ...common, mode, revision: '1', enforcedFromRevision: '1', changeCount: 1, lastChange: audit };
  return { request, response, options, verified, audit, committed, message };
}
test('exact untouched v1 default is readable, with unknown permission inventory and no change capability', async () => {
  const value = await wire.status(initial(), session, account);
  assert.equal(value.view.mode, 'ON'); assert.equal(value.view.revision, '0');
  assert.equal(value.view.permissions, null); assert.equal(value.view.canChange, false);
  assert.equal(value.view.scopeKey, hash(scope)); assert.equal(value.lastChange, null);
});
for (const mode of ['ON', 'OFF'] as const) for (const method of ['password', 'wallet'] as const) {
  test(`exact ${mode}/${method} challenge, email response and committed two-factor audit bind together`, async () => {
    const f = fixture(mode, method), prepared = await wire.prepared(f.response, f.options);
    assert.equal(prepared.message, method === 'wallet' ? f.message : null);
    assert.equal(wire.verified(f.verified, prepared, 2500).digits, 8);
    assert.equal(await wire.committed(f.committed, prepared), f.committed);
    const decoded = await wire.status(f.committed, session, account);
    assert.equal(decoded.view.mode, mode); assert.equal(decoded.view.canChange, false);
  });
}
test('wrong origin, tenant, username, account, chain or unknown fields refuse', async () => {
  for (const changes of [{ origin: 'https://other.example.invalid' }, { tenant: 'other' }, { username: 'other' },
    { account: '0x' + '2'.repeat(40) }, { chainId: '1' }]) {
    await assert.rejects(wire.status({ ...initial(), scope: { ...scope, ...changes } }, session, account));
  }
  await assert.rejects(wire.status({ ...initial(), changes: [] }, session, account));
  await assert.rejects(wire.status({ ...initial(), schema: 'unrecognized/3' }, session, account));
  await assert.rejects(wire.status({ ...initial(), revision: '00' }, session, account));
  await assert.rejects(wire.status({ ...initial(), changeCount: 1 }, session, account));
});
test('scope audit digest, revision chain and factor substitution refuse', async () => {
  const f = fixture();
  for (const delta of [{ scopeDigest: '0'.repeat(64) }, { previousRevision: '1' }, { changeId: 'bad' },
    { verifiedFactors: [] }, { verifiedFactors: ['totp', 'verified-email'] }]) {
    await assert.rejects(wire.status({ ...f.committed, lastChange: { ...f.audit, ...delta } }, session, account));
  }
});
test('canonical signed bytes, digest, lifetime, mode and complete scope cannot be substituted', async () => {
  const f = fixture('OFF', 'wallet');
  await assert.rejects(wire.prepared({ ...f.response, message: f.message + '\nExtra authority' }, f.options));
  await assert.rejects(wire.prepared({ ...f.response, changeDigest: '0'.repeat(64) }, f.options));
  await assert.rejects(wire.prepared({ ...f.response, request: { ...f.request, mode: 'ON' } }, f.options));
  await assert.rejects(wire.prepared(f.response, { ...f.options, now: 301000 }));
  await assert.rejects(wire.prepared(f.response, { ...f.options, reviewed: { revision: '0', scopeKey: '0'.repeat(64) } }));
});
test('email substitution and expiry refuse; committed audit is not reusable proof', async () => {
  const f = fixture(), prepared = await wire.prepared(f.response, f.options);
  assert.throws(() => wire.verified({ ...f.verified, emailMasked: 'other***@example.invalid' }, prepared, 2500));
  assert.throws(() => wire.verified(f.verified, prepared, 301000));
  await assert.rejects(wire.committed({ ...f.committed, lastChange: { ...f.audit, changeDigest: '0'.repeat(64) } }, prepared));
});
test('accessors and sparse factor arrays refuse without executing getters', async () => {
  let called = 0; const malicious = { ...initial() };
  Object.defineProperty(malicious, 'mode', { enumerable: true, get() { called++; return 'ON'; } });
  await assert.rejects(wire.status(malicious, session, account)); assert.equal(called, 0);
  await assert.rejects(wire.status({ ...initial(), factorsForOFF: new Array(2) }, session, account));
});
test('production factory performs exact read-only status and cannot dispatch a policy mutation', async () => {
  const calls: string[] = [], binding = {}, abort = new AbortController();
  const client = { async account() { return { ...account, taskHumanVerification: initial() }; }, async taskVerification(action: string) { calls.push(action); return initial(); } };
  const bridge = createTaskVerificationPolicyClient({ client, walletLogin: { assert(candidate: unknown) { assert.equal(candidate, binding); return session; } },
    document: {}, window: { crypto: webcrypto } });
  assert.ok(bridge);
  const value = await bridge.read({ binding, signal: abort.signal }) as { canChange: boolean; permissions: unknown };
  assert.equal(value.canChange, false); assert.equal(value.permissions, null);
  await assert.rejects(bridge.change({ binding, signal: abort.signal, expectedRevision: '0', expectedScopeKey: hash(scope), mode: 'OFF' }));
  assert.deepEqual(calls, ['status', 'status']);
});
test('server-disabled account policy entry makes no policy request and invents no saved mode', async () => {
  let calls = 0; const binding = {}, abort = new AbortController();
  const bridge = createTaskVerificationPolicyClient({
    client: { async account() { return { ...account, taskHumanVerification: null }; }, async taskVerification() { calls++; throw new Error('UNREACHABLE'); } },
    walletLogin: { assert() { return session; } }, document: {}, window: { crypto: webcrypto },
  });
  assert.ok(bridge); await assert.rejects(bridge.read({ binding, signal: abort.signal }), /ADAPTER_UNAVAILABLE/);
  assert.equal(calls, 0);
});
