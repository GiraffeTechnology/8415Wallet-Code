/** Synthetic owner-change regression; no production credentials, email or chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createTaskVerificationPolicyService } from '../server/task-verification-policy.mjs';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';

const protocol = '8415-task-policy-change-wire/1';
const wallet = new Wallet('0x' + '1'.repeat(64)); // Public test identity only.
const registration = { version: 1, email: 'owner@example.invalid', verifiedAt: 1 };
const reference = (change: any) => ({ protocol, changeId: change.request.changeId,
  changeDigest: change.changeDigest, expectedRevision: change.request.expectedRevision });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

function fixture(store: any = new MemoryCredentialStore({ 'fixture:alice': { revision: 1, registration } })) {
  const session = { id: 'synthetic-session', username: 'alice', account: wallet.address, chainId: '560048', revision: 1 };
  const sessions = new Set([session]); const deliveries: any[] = [];
  const options = { origin: 'https://wallet.example.invalid', tenant: 'fixture', agentId: 'test:agent', store,
    users: new Map([['alice', { username: 'alice', wallets: ['560048', '8453'].map(chainId => ({ account: wallet.address, chainId })) }]]),
    assertSession(s: typeof session) { assert.ok(sessions.has(s)); },
    credentialFor: async () => store.read('fixture:alice'), passwordFor: () => undefined,
    methodStates: () => ({ wallet: { enabled: true }, password: { enabled: false } }),
    directory: { checkCredential() {} }, sendOtp: async (message: any) => { deliveries.push(message); }, now: () => 1_800_000_000_000 };
  const service = createTaskVerificationPolicyService(options);
  const prepare = (expectedRevision = '0', mode = 'OFF') => service.prepare(session, { expectedRevision, mode, identityMethod: 'wallet' });
  const verify = async (change: any) => service.verify(session, { changeId: change.request.changeId,
    changeDigest: change.changeDigest, signature: await wallet.signMessage(change.message) });
  const confirm = (change: any) => service.confirm(session, { changeId: change.request.changeId,
    changeDigest: change.changeDigest, code: deliveries.at(-1).code });
  const newSession = (chainId = '560048') => { const s = { ...session, id: 'other-session', chainId }; sessions.add(s); return s; };
  return { options, service, session, store, deliveries, prepare, verify, confirm, newSession };
}

test('versioned status preserves default ON and exposes no pending evidence before a change', async () => {
  const f = fixture(), status = await f.service.status(f.session);
  assert.equal(status.changeProtocol, protocol); assert.equal(status.mode, 'ON'); assert.equal(status.revision, '0');
  assert.equal(status.pendingChange, null); assert.equal(status.reconciliation, null);
  assert.equal(f.deliveries.length, 0); assert.equal((await f.store.read('fixture:alice')).taskVerificationPolicies, undefined);
});

test('late qualified cancel never deletes a replacement draft and its two factors still commit', async () => {
  const f = fixture(), old = await f.prepare(), current = await f.prepare('0', 'ON');
  const cancelled = await f.service.cancelChange(f.session, reference(old));
  assert.equal(cancelled.cancelled, false); assert.equal(cancelled.reconciliation?.changeId, old.request.changeId);
  assert.equal(cancelled.reconciliation?.state, 'not-committed'); assert.equal(cancelled.reconciliation?.reason, 'replaced');
  assert.equal((await f.service.status(f.session)).pendingChange?.changeId, current.request.changeId);
  await f.verify(current); const saved = await f.confirm(current);
  assert.equal(saved.mode, 'ON'); assert.equal(saved.revision, '1');
  assert.deepEqual(saved.changes[0]!.verifiedFactors, ['wallet', 'verified-email']);
});

test('unqualified, wrong-version and forged-digest cancels cannot clear the selected draft', async () => {
  const f = fixture(), change = await f.prepare(), ref = reference(change);
  for (const body of [{}, { ...ref, protocol: 'unknown/1' }, { ...ref, extra: true }])
    await assert.rejects(f.service.cancelChange(f.session, body));
  const forged = await f.service.cancelChange(f.session, { ...ref, changeDigest: 'f'.repeat(64) });
  assert.equal(forged.cancelled, false); assert.equal(forged.reconciliation?.state, 'unknown');
  assert.equal((await f.service.status(f.session)).pendingChange?.changeId, change.request.changeId);
});

test('exact cancellation acknowledges only its own uncommitted change without changing effective policy', async () => {
  const f = fixture(), change = await f.prepare(), before = await f.store.read('fixture:alice');
  const result = await f.service.cancelChange(f.session, reference(change));
  assert.equal(result.cancelled, true); assert.equal(result.reconciliation?.state, 'not-committed');
  assert.equal(result.reconciliation?.reason, 'cancelled'); assert.equal(result.reconciliation?.automaticRetryAllowed, false);
  assert.deepEqual(await f.store.read('fixture:alice'), before);
  assert.equal((await f.service.status(f.session, reference(change))).reconciliation?.state, 'not-committed');
  assert.equal((await f.service.status(f.session)).pendingChange, null);
});

test('readback finds the exact older committed change even after a later owner save', async () => {
  const f = fixture(), first = await f.prepare(); await f.verify(first); await f.confirm(first);
  const second = await f.prepare('1', 'ON'); await f.verify(second); await f.confirm(second);
  const status = await f.service.status(f.session, reference(first));
  assert.equal(status.mode, 'ON'); assert.equal(status.revision, '2');
  assert.equal(status.reconciliation?.state, 'committed');
  assert.equal(status.reconciliation?.committedChange?.revision, '1');
  assert.equal(status.reconciliation?.committedChange?.mode, 'OFF');
  assert.equal(status.reconciliation?.committedChange?.changeDigest, first.changeDigest);
  const late = await f.service.cancelChange(f.session, reference(first));
  assert.equal(late.cancelled, false); assert.equal(late.reconciliation?.state, 'committed');
});

test('reload can query a scoped old reference; another chain gets no pending or committed match', async () => {
  const f = fixture(), change = await f.prepare(), reloaded = f.newSession();
  const pending = await f.service.status(reloaded, reference(change));
  assert.equal(pending.pendingChange, null); assert.equal(pending.reconciliation?.state, 'pending');
  const base = await f.service.status(f.newSession('8453'), reference(change));
  assert.equal(base.mode, 'ON'); assert.equal(base.reconciliation?.state, 'unknown'); assert.equal(base.pendingChange, null);
  assert.equal(JSON.stringify(pending).includes('codeHash'), false);
  assert.equal(JSON.stringify(pending).includes('factorBinding'), false);
});

test('restart does not infer failure or retry permission from an absent transient draft', async () => {
  const f = fixture(), change = await f.prepare();
  const restarted = createTaskVerificationPolicyService(f.options);
  const status = await restarted.status(f.session, reference(change));
  assert.equal(status.reconciliation?.state, 'unknown'); assert.equal(status.reconciliation?.automaticRetryAllowed, false);
  assert.equal(status.reconciliation?.committedChange, null); assert.equal(status.mode, 'ON');
});

test('committing save cannot be cancelled or replaced, and internal logout cleanup cannot abandon it', async () => {
  const f = fixture(), change = await f.prepare(); await f.verify(change);
  const gate = deferred(), entered = deferred(), transaction = f.store.transactionMany.bind(f.store);
  f.store.transactionMany = async (...args: any[]) => { entered.resolve(); await gate.promise; return transaction(...args); };
  const saving = f.confirm(change); await entered.promise;
  const pending = await f.service.status(f.session, reference(change));
  assert.equal(pending.reconciliation?.state, 'committing');
  const cancellation = await f.service.cancelChange(f.session, reference(change));
  assert.equal(cancellation.cancelled, false); assert.equal(cancellation.reconciliation?.state, 'committing');
  f.service.cancel(f.session);
  await assert.rejects(f.prepare('0', 'ON'), /CHANGE_IN_PROGRESS/);
  gate.resolve(); await saving;
  assert.equal((await f.service.status(f.session, reference(change))).reconciliation?.state, 'committed');
});

test('a replacement arriving during cancellation read is not cleared by the old response', async () => {
  const f = fixture(), old = await f.prepare(), entered = deferred(), gate = deferred();
  const read = f.store.readMany.bind(f.store); let pause = true;
  f.store.readMany = async (...args: any[]) => { const value = await read(...args);
    if (pause) { pause = false; entered.resolve(); await gate.promise; } return value; };
  const cancelling = f.service.cancelChange(f.session, reference(old)); await entered.promise;
  const next = await f.prepare('0', 'ON'); gate.resolve();
  assert.equal((await cancelling).cancelled, false);
  assert.equal((await f.service.status(f.session)).pendingChange?.changeId, next.request.changeId);
});

test('encrypted restart resolves a lost commit acknowledgement from durable audit, not browser flags', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'policy-readback-')), path = join(dir, 'state.enc'), key = randomBytes(32);
  let store: any;
  try {
    store = await openEncryptedStore(path, key); await store.transaction('fixture:alice', () => ({ revision: 1, registration }));
    const f = fixture(store), change = await f.prepare(); await f.verify(change);
    const persist = store.persist.bind(store); store.persist = async (data: any) => { await persist(data); throw Error('synthetic lost acknowledgement after durable replace'); };
    await assert.rejects(f.confirm(change), /lost acknowledgement/); await store.close();
    store = await openEncryptedStore(path, key); const restarted = fixture(store);
    const status = await restarted.service.status(restarted.session, reference(change));
    assert.equal(status.mode, 'OFF'); assert.equal(status.revision, '1'); assert.equal(status.reconciliation?.state, 'committed');
    assert.deepEqual(status.reconciliation?.committedChange?.verifiedFactors, ['wallet', 'verified-email']);
    const raw = JSON.stringify(await store.read('fixture:alice'));
    for (const forbidden of ['pendingChange', 'reconciliation', 'codeHash', 'factorBinding', f.deliveries[0].code]) assert.ok(!raw.includes(forbidden));
  } finally { if (store) await store.close(); key.fill(0); await rm(dir, { recursive: true, force: true }); }
});

test('original authenticated HTTP routes refuse cancel{} and support versioned qualified readback', async t => {
  const password = 'synthetic-policy-password', passwordHash = await hashPassword(password);
  let handler: any; const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const store = new MemoryCredentialStore({ 'fixture:alice': { registration },
    '@registration:fixture': { version: 1, records: [{ username: 'alice', email: registration.email, verifiedAt: registration.verifiedAt }] } });
  handler = createAuthService({ origin, tenant: 'fixture', store, taskVerificationPolicyEnabled: true,
    accounts: [{ username: 'alice', passwordHash, wallets: [{ account: wallet.address, chainId: '560048' }] }], sendOtp: async () => {} });
  const jar = new Map<string, string>(); let csrf = '';
  const call = async (path: string, body?: any) => {
    const r = await fetch(origin + '/auth/' + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'X-Wallet-Tenant': 'fixture', 'X-Wallet-CSRF': csrf,
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of r.headers.getSetCookie()) { const [name, value] = cookie.split(';')[0]!.split('='); if (value) jar.set(name!, value); }
    const data: any = await r.json(); if (data.csrf) csrf = data.csrf; return { status: r.status, data };
  };
  await call('bootstrap'); assert.equal((await call('password', { username: 'alice', password, account: wallet.address, chainId: '560048' })).status, 200);
  const prefix = 'account/task-verification/';
  const prepared = await call(prefix + 'prepare', { expectedRevision: '0', mode: 'OFF', identityMethod: 'wallet' });
  assert.equal(prepared.status, 200); assert.equal(prepared.data.changeProtocol, protocol);
  assert.equal((await call(prefix + 'cancel', {})).status, 400);
  const readback = await call(prefix + 'status', reference(prepared.data));
  assert.equal(readback.status, 200); assert.equal(readback.data.reconciliation.state, 'pending');
  assert.equal(readback.data.changes, undefined); assert.equal(readback.data.pendingChange.changeId, prepared.data.request.changeId);
  const cancelled = await call(prefix + 'cancel', reference(prepared.data));
  assert.equal(cancelled.status, 200); assert.equal(cancelled.data.cancelled, true);
  assert.equal((await call(prefix + 'status', reference(prepared.data))).data.reconciliation.state, 'not-committed');
  assert.equal((await call(prefix + 'status', { ...reference(prepared.data), account: wallet.address })).status, 400);
});
