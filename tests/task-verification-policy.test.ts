/** Authored synthetic policy fixtures. No owner factors, actual email or chain calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { hashPassword } from '../server/crypto.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskVerificationPolicyService, readTaskVerificationPolicy, readCredentialTaskVerificationPolicy, taskVerificationPolicyKey } from '../server/task-verification-policy.mjs';

const wallet = new Wallet('0x' + '1'.repeat(64)); // Public synthetic fixture, never a production wallet.
const origin = 'https://wallet.example.invalid:9446', tenant = 'fixture', agentId = 'wallet:agent';
const account = wallet.address.toLowerCase();
const selectedScope = { origin, tenant, username: 'alice', account, chainId: '560048', agentId };
function fixture() {
  let time = 1_800_000_000_000, active = true;
  const session = { id: 'fixture-session', username: 'alice', account: wallet.address, chainId: '560048', revision: 1 };
  const user = { username: 'alice', wallets: [{ account: wallet.address, chainId: '560048' }] };
  const credential = { revision: 1, registration: { version: 1, email: 'alice@example.invalid', verifiedAt: time - 10000 } };
  const store = new MemoryCredentialStore({ 'fixture:alice': credential });
  const deliveries: { code: string; changeDigest: string }[] = [];
  const options = { origin, tenant, agentId, store, users: new Map([['alice', user]]),
    assertSession(value: typeof session) { assert.ok(active && value === session); },
    credentialFor: async () => store.read('fixture:alice'), passwordFor: () => undefined,
    methodStates: () => ({ wallet: { enabled: true }, password: { enabled: false } }),
    directory: { checkCredential: () => undefined },
    sendOtp: async (delivery: { code: string; changeDigest: string }) => { deliveries.push(delivery); }, now: () => time };
  const service = createTaskVerificationPolicyService(options);
  const prepare = (expectedRevision = '0', mode: 'ON' | 'OFF' = 'OFF') => service.prepare(session, { expectedRevision, identityMethod: 'wallet', mode });
  async function verified(expectedRevision = '0', mode: 'ON' | 'OFF' = 'OFF') {
    const change = await prepare(expectedRevision, mode);
    const signature = await wallet.signMessage(change.message!);
    await service.verify(session, { changeId: change.request.changeId, changeDigest: change.changeDigest, signature });
    return change;
  }
  async function off() {
    const change = await verified();
    return service.confirm(session, { changeId: change.request.changeId, changeDigest: change.changeDigest, code: deliveries.at(-1)!.code });
  }
  return { service, session, store, options, deliveries, prepare, verified, off,
    advance: (ms: number) => { time += ms; }, revokeSession: () => { active = false; } };
}

test('absence defaults ON; config/approved flags and one factor cannot create OFF', async () => {
  const f = fixture();
  assert.equal((await f.service.status(f.session)).mode, 'ON');
  await assert.rejects(f.service.prepare(f.session, { expectedRevision: '0', identityMethod: 'wallet', approved: true }), /INPUT_REFUSED/);
  const change = await f.prepare();
  await assert.rejects(f.service.confirm(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest, code: '00000000' }));
  assert.equal((await f.service.status(f.session)).mode, 'ON'); assert.equal(f.deliveries.length, 0);
});

test('policy input rejects accessors and hidden fields without evaluating them', async () => {
  const f = fixture(); let reads = 0;
  const accessor = { expectedRevision: '0', get identityMethod() { reads++; return 'wallet'; } };
  await assert.rejects(f.service.prepare(f.session, accessor), /INPUT_REFUSED/);
  assert.equal(reads, 0);
  const hidden = { expectedRevision: '0', identityMethod: 'wallet' };
  Object.defineProperty(hidden, 'approved', { value: true, enumerable: false });
  await assert.rejects(f.service.prepare(f.session, hidden), /INPUT_REFUSED/);
  const symbolic = { ...hidden, [Symbol('approved')]: true };
  await assert.rejects(f.service.prepare(f.session, symbolic), /INPUT_REFUSED/);
  assert.equal(f.deliveries.length, 0);
});

test('two established independent factors commit a single durable exact-change revision', async () => {
  const f = fixture(), state = await f.off();
  assert.equal(state.mode, 'OFF'); assert.equal(state.revision, '1'); assert.equal(state.grantsAuthority, false);
  assert.ok(state.changes[0]);
  assert.deepEqual(state.changes[0].verifiedFactors, ['wallet', 'verified-email']);
  const persisted = (await f.store.read('fixture:alice')).taskVerificationPolicies[taskVerificationPolicyKey(selectedScope)];
  assert.deepEqual(readTaskVerificationPolicy(persisted, selectedScope).changes, state.changes);
  const raw = JSON.stringify(persisted);
  for (const secret of [f.deliveries[0]!.code, 'alice@example.invalid', 'signature', 'password', 'proofHash', 'codeHash']) assert.ok(!raw.includes(secret));
});

test('established password and email code enable OFF without a third factor', async () => {
  const f = fixture(), password = 'synthetic-policy-password-only';
  const passwordHash = await hashPassword(password);
  const service = createTaskVerificationPolicyService({ ...f.options,
    passwordFor: () => passwordHash,
    methodStates: () => ({ wallet: { enabled: true }, password: { enabled: true } }) });
  const change = await service.prepare(f.session, { expectedRevision: '0', identityMethod: 'password' });
  assert.equal(change.message, undefined);
  const factor = { changeId: change.request.changeId, changeDigest: change.changeDigest, password };
  await service.verify(f.session, factor);
  assert.equal(factor.password, '');
  assert.equal(f.deliveries.length, 1);
  const confirmation = { changeId: change.request.changeId, changeDigest: change.changeDigest, code: f.deliveries[0]!.code };
  const state = await service.confirm(f.session, confirmation);
  assert.equal(confirmation.code, '');
  assert.equal(state.mode, 'OFF');
  assert.deepEqual(state.changes[0]!.verifiedFactors, ['password', 'verified-email']);
  const persisted = JSON.stringify(await f.store.read('fixture:alice'));
  for (const secret of [password, passwordHash, f.deliveries[0]!.code]) assert.ok(!persisted.includes(secret));
});

test('wallet review uses visible lines and email proof accepts only eight ASCII digits', async () => {
  const f = fixture(), change = await f.verified();
  assert.ok(change.message!.includes('\nScope: '));
  const body = { changeId: change.request.changeId, changeDigest: change.changeDigest };
  for (const code of ['１２３４５６７８', '1234567', '123456789', 'dddddddd']) {
    await assert.rejects(f.service.confirm(f.session, { ...body, code }), /FACTOR_REFUSED/);
  }
  assert.equal((await f.service.status(f.session)).mode, 'ON');
  assert.equal((await f.service.confirm(f.session, { ...body, code: f.deliveries[0]!.code })).mode, 'OFF');
});

test('email code cannot authorize a replaced policy change', async () => {
  const f = fixture(), original = await f.verified(), oldCode = f.deliveries[0]!.code;
  const replacement = await f.prepare();
  await assert.rejects(f.service.confirm(f.session, { changeId: original.request.changeId,
    changeDigest: original.changeDigest, code: oldCode }));
  assert.equal((await f.service.status(f.session)).mode, 'ON');
  await f.service.verify(f.session, { changeId: replacement.request.changeId, changeDigest: replacement.changeDigest,
    signature: await wallet.signMessage(replacement.message!) });
  assert.equal((await f.service.confirm(f.session, { changeId: replacement.request.changeId,
    changeDigest: replacement.changeDigest, code: f.deliveries[1]!.code })).mode, 'OFF');
});

test('restart and unrelated implementation-version changes do not revert persisted OFF', async () => {
  const f = fixture(); await f.off();
  const restarted = createTaskVerificationPolicyService({ ...f.options });
  assert.equal((await restarted.status(f.session)).mode, 'OFF');
  assert.equal(restarted.keyFor(f.session), f.service.keyFor(f.session));
  assert.notEqual(taskVerificationPolicyKey({ ...selectedScope, agentId: 'another-agent' }), restarted.keyFor(f.session));
  assert.equal(readTaskVerificationPolicy(null, { ...selectedScope, agentId: 'another-agent' }).mode, 'ON');
  assert.equal(f.deliveries.length, 1); // Status/restart never delivers a new verification challenge.
});

test('encrypted credential store restart preserves OFF without retaining transient factor proof', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wallet-policy-fixture-'));
  const statePath = join(directory, 'credentials.json'), key = randomBytes(32);
  const f = fixture();
  let encrypted = await openEncryptedStore(statePath, key);
  try {
    await encrypted.transaction('fixture:alice', () => f.store.read('fixture:alice'));
    const options = { ...f.options, store: encrypted, credentialFor: () => encrypted.read('fixture:alice') };
    const service = createTaskVerificationPolicyService(options);
    const change = await service.prepare(f.session, { expectedRevision: '0', identityMethod: 'wallet' });
    await service.verify(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest,
      signature: await wallet.signMessage(change.message!) });
    const code = f.deliveries[0]!.code;
    await service.confirm(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest, code });
    const ciphertext = await readFile(statePath, 'utf8');
    for (const text of ['taskVerificationPolicies', change.changeDigest, code, 'alice@example.invalid']) assert.ok(!ciphertext.includes(text));
    await encrypted.close();
    encrypted = await openEncryptedStore(statePath, key);
    const restarted = createTaskVerificationPolicyService({ ...options, store: encrypted });
    const restored = await restarted.status(f.session);
    assert.equal(restored.mode, 'OFF'); assert.equal(restored.revision, '1');
    assert.equal(restored.changes[0]!.changeDigest, change.changeDigest);
    assert.equal(f.deliveries.length, 1);
    await assert.rejects(restarted.confirm(f.session, { changeId: change.request.changeId,
      changeDigest: change.changeDigest, code }), /EXPIRED/);
  } finally {
    await encrypted.close(); key.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
});

test('exact scope and ledger reject replay, omitted factors and forged effective mode', async () => {
  const f = fixture(); await f.off();
  const raw = (await f.store.read('fixture:alice')).taskVerificationPolicies[f.service.keyFor(f.session)];
  assert.throws(() => readTaskVerificationPolicy(raw, { ...selectedScope, chainId: '11155111' }), /STATE_REFUSED/);
  assert.throws(() => readTaskVerificationPolicy({ ...raw, mode: 'ON' }, selectedScope), /STATE_REFUSED/);
  assert.throws(() => readTaskVerificationPolicy({ ...raw, changes: [] }, selectedScope), /STATE_REFUSED/);
  assert.throws(() => readTaskVerificationPolicy({ ...raw, changes: [{ ...raw.changes[0], verifiedFactors: ['wallet'] }] }, selectedScope), /STATE_REFUSED/);
  await assert.rejects(f.service.enable(f.session, { expectedRevision: '0' }), /OWNER_CHANGE_REQUIRED/);
});

test('wallet signature is bound to the displayed exact OFF change, not a generic login', async () => {
  const f = fixture(), change = await f.prepare();
  await assert.rejects(f.service.verify(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest,
    signature: await wallet.signMessage('ordinary login') }), /FACTOR_REFUSED/);
  assert.equal(f.deliveries.length, 0); assert.equal((await f.service.status(f.session)).mode, 'ON');
});

test('changed credential or session cancellation rejects late approval', async () => {
  const f = fixture(), change = await f.verified();
  await f.store.transaction('fixture:alice', (value: Record<string, unknown>) => ({ ...value, revision: 2 }));
  await assert.rejects(f.service.confirm(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest,
    code: f.deliveries[0]!.code }), /CREDENTIAL_CHANGED/);
  const g = fixture(), second = await g.verified(); g.revokeSession();
  await assert.rejects(g.service.confirm(g.session, { changeId: second.request.changeId, changeDigest: second.changeDigest, code: g.deliveries[0]!.code }));
});

test('expiry and cancelled challenge do not survive restart or renew owner policy', async () => {
  const f = fixture(), change = await f.verified(); f.advance(5 * 60000);
  await assert.rejects(f.service.confirm(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest,
    code: f.deliveries[0]!.code }), /EXPIRED/);
  assert.equal((await f.service.status(f.session)).mode, 'ON');
  const g = fixture(), other = await g.verified();
  const restarted = createTaskVerificationPolicyService({ ...g.options });
  await assert.rejects(restarted.confirm(g.session, { changeId: other.request.changeId, changeDigest: other.changeDigest,
    code: g.deliveries[0]!.code }), /EXPIRED/);
});

test('two-factor ON replaces an outstanding OFF and preserves UNKNOWN, nonce and budget records', async () => {
  const f = fixture(), change = await f.verified();
  const unknown = { status: 'outcome-unknown', nonce: '7', reservedPrincipal: '10', reservedFees: '3' };
  await f.store.transaction('fixture:unknown-operation', () => unknown);
  const onChange = await f.verified('0', 'ON');
  const state = await f.service.confirm(f.session, { changeId: onChange.request.changeId,
    changeDigest: onChange.changeDigest, code: f.deliveries.at(-1)!.code });
  assert.equal(state.mode, 'ON'); assert.equal(state.revision, '1');
  await assert.rejects(f.service.confirm(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest,
    code: f.deliveries[0]!.code }));
  assert.deepEqual(await f.store.read('fixture:unknown-operation'), unknown);
});

test('concurrent confirmations consume policy change once, never mint duplicate revisions', async () => {
  const f = fixture(), change = await f.verified();
  const body = { changeId: change.request.changeId, changeDigest: change.changeDigest, code: f.deliveries[0]!.code };
  const results = await Promise.allSettled([f.service.confirm(f.session, { ...body }), f.service.confirm(f.session, { ...body })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await f.service.status(f.session)).changes.length, 1);
});

test('unverified or newly supplied email and disabled factor cannot enable OFF', async () => {
  const f = fixture(); await f.store.transaction('fixture:alice', () => ({ revision: 1 }));
  await assert.rejects(f.prepare(), /TWO_ESTABLISHED_FACTORS_REQUIRED/);
  const g = fixture();
  await assert.rejects(g.service.prepare(g.session, { expectedRevision: '0', identityMethod: 'wallet', email: 'new@example.invalid' }), /INPUT_REFUSED/);
  await assert.rejects(g.service.prepare(g.session, { expectedRevision: '0', identityMethod: 'password' }), /TWO_ESTABLISHED_FACTORS_REQUIRED/);
});

test('policy is read inside the same execution gate; ON cannot race an already admitted effect', async () => {
  const f = fixture(); await f.off();
  const onChange = await f.verified('1', 'ON'), onCode = f.deliveries.at(-1)!.code;
  const observed: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const first = f.store.withReadGate(['fixture:alice'], async (values: Record<string, unknown>) => {
    const policy = readCredentialTaskVerificationPolicy(values['fixture:alice'], selectedScope);
    observed.push(policy.mode + ':' + policy.revision); entered(); await pending;
  });
  await started;
  const on = f.service.confirm(f.session, { changeId: onChange.request.changeId,
    changeDigest: onChange.changeDigest, code: onCode });
  release(); await first; await on;
  await f.store.withReadGate(['fixture:alice'], (values: Record<string, unknown>) => {
    const policy = readCredentialTaskVerificationPolicy(values['fixture:alice'], selectedScope);
    observed.push(policy.mode + ':' + policy.revision);
  });
  assert.deepEqual(observed, ['OFF:1', 'ON:2']);
  assert.equal((await f.store.read('fixture:alice')).revision, 1); // Not a credential revision change.
});

test('a side index or malformed credential policy cannot silently supply execution authority', async () => {
  const f = fixture(); await f.off();
  const credential = await f.store.read('fixture:alice');
  assert.equal(await f.store.read(f.service.keyFor(f.session)), null);
  assert.equal(readCredentialTaskVerificationPolicy(credential, selectedScope).mode, 'OFF');
  assert.throws(() => readCredentialTaskVerificationPolicy({ taskVerificationPolicies: [] }, selectedScope), /STATE_REFUSED/);
  assert.throws(() => readCredentialTaskVerificationPolicy({ taskVerificationPolicies: { approved: true } }, selectedScope), /STATE_REFUSED/);
});

test('ordinary session and existing OFF never authorize a direct ON settings save', async () => {
  const f = fixture(); await f.off();
  const before = await f.store.read('fixture:alice');
  await assert.rejects(f.service.enable(f.session, { expectedRevision: '1' }), /OWNER_CHANGE_REQUIRED/);
  assert.deepEqual(await f.store.read('fixture:alice'), before);
  assert.equal((await f.service.status(f.session)).mode, 'OFF');
  assert.equal(f.deliveries.length, 1);
});

test('ON review and its second factor bind the exact proposed mode and revision', async () => {
  const f = fixture(); await f.off();
  const change = await f.prepare('1', 'ON');
  assert.equal(change.request.mode, 'ON'); assert.match(change.message!, /verification ON/);
  assert.equal((await f.service.status(f.session)).mode, 'OFF');
  await assert.rejects(f.service.confirm(f.session, { changeId: change.request.changeId,
    changeDigest: change.changeDigest, code: f.deliveries[0]!.code }));
  await f.service.verify(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest,
    signature: await wallet.signMessage(change.message!) });
  const result = await f.service.confirm(f.session, { changeId: change.request.changeId,
    changeDigest: change.changeDigest, code: f.deliveries.at(-1)!.code });
  assert.equal(result.mode, 'ON'); assert.equal(result.revision, '2'); assert.equal(result.enforcedFromRevision, '1');
  assert.deepEqual(result.changes.at(-1)!.verifiedFactors, ['wallet', 'verified-email']);
  const restarted = createTaskVerificationPolicyService(f.options);
  assert.equal((await restarted.status(f.session)).mode, 'ON');
  assert.equal(f.deliveries.length, 2); // Reads/restarts never re-request operation verification.
});

test('a new ON ledger cannot drop its factors or alter the enforcement boundary', async () => {
  const f = fixture(), change = await f.verified('0', 'ON');
  await f.service.confirm(f.session, { changeId: change.request.changeId, changeDigest: change.changeDigest,
    code: f.deliveries.at(-1)!.code });
  const raw = (await f.store.read('fixture:alice')).taskVerificationPolicies[f.service.keyFor(f.session)];
  assert.equal(raw.schema, '8415-task-human-verification/2');
  assert.throws(() => readTaskVerificationPolicy({ ...raw, changes: [{ ...raw.changes[0], verifiedFactors: [] }] }, selectedScope), /STATE_REFUSED/);
  for (const enforcedFromRevision of ['0', '2', '01'])
    assert.throws(() => readTaskVerificationPolicy({ ...raw, enforcedFromRevision }, selectedScope));
});

test('historical v1 OFF remains effective without reapproval and a cancelled ON draft changes nothing', async () => {
  const f = fixture(); await f.off();
  await f.store.transaction('fixture:alice', (credential: any) => {
    const key = f.service.keyFor(f.session), raw = credential.taskVerificationPolicies[key];
    const { enforcedFromRevision: _old, ...legacy } = raw;
    return { ...credential, taskVerificationPolicies: { [key]: { ...legacy, schema: '8415-task-human-verification/1' } } };
  });
  assert.equal((await f.service.status(f.session)).mode, 'OFF');
  const before = await f.store.read('fixture:alice'), change = await f.verified('1', 'ON');
  f.service.cancel(f.session);
  await assert.rejects(f.service.confirm(f.session, { changeId: change.request.changeId,
    changeDigest: change.changeDigest, code: f.deliveries.at(-1)!.code }), /EXPIRED/);
  assert.deepEqual(await f.store.read('fixture:alice'), before);
});
