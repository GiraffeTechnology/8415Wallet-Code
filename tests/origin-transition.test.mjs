/** Original encrypted-store fixtures only; no real credentials or service changes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openEncryptedStore, MemoryCredentialStore } from '../server/store.mjs';
import { paths } from '../deploy/auth-runtime/install.mjs';
import { transitionManagedOrigin, inspectManagedOriginTransition } from '../deploy/auth-runtime/origin-transition.mjs';
const fromOrigin = 'https://wallet.example:9446', toOrigin = 'https://wallet.example';
const sha = value => createHash('sha256').update(value).digest('hex');
const credentials = () => ({ revision: 7, registration: { version: 1, email: 'owner@example.invalid', verifiedAt: 1 },
  secret: 'SYNTHETIC_ONLY', lastStep: 91, recoverySalt: 'fixture-salt', recoveryHashes: ['consumed-counters-retained'],
  walletBindings: { version: 1, identities: [] } });
async function fixture(t, records = { 'fixture:alice': credentials() }, persist = true) {
  const root = await mkdtemp(join(tmpdir(), 'wallet-origin-test-')), target = paths(root, 'fixture');
  for (const dir of [target.root, target.config, target.state, target.socketDirectory]) await mkdir(dir, { recursive: true, mode: 0o700 });
  const config = { origin: fromOrigin, tenant: 'fixture', socketPath: join(target.socketDirectory, 'auth.sock'),
    statePath: join(target.state, 'credentials.enc'), accounts: [] };
  const receipt = { schema: '8415wallet-auth-install/1', tenant: 'fixture', origin: fromOrigin,
    socketPath: config.socketPath, sourceTree: '1'.repeat(40), runtime: join(target.root, 'releases', '1'.repeat(40)),
    status: 'proxy-enabled', previousReleases: [{ sourceTree: '2'.repeat(40), runtime: 'retained-original-reference' }] };
  const configPath = join(target.config, 'auth.json'), receiptPath = join(target.root, 'installation.json');
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 }); await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
  const key = Buffer.alloc(32, 17); let store = await openEncryptedStore(config.statePath, key);
  if (persist) await store.transactionMany(Object.keys(records), async () => records);
  t.after(async () => { await store.close(); key.fill(0); assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '/wallet-origin-test-')); await rm(root, { recursive: true, force: false }); });
  return { root, target, config, receipt, configPath, receiptPath, key,
    get store() { return store; },
    async reopen() { await store.close(); store = await openEncryptedStore(config.statePath, key); },
    options(extra = {}) { return { target, store, fromOrigin, toOrigin, uid: process.getuid(),
      run: async () => 'MainPID=0\nActiveState=inactive\nSubState=dead\n', ...extra }; } };
}
test('offline origin-independent credentials migrate as a recoverable file pair with byte-identical ciphertext', async t => {
  const f = await fixture(t), before = await readFile(f.config.statePath), result = await transitionManagedOrigin(f.options());
  assert.equal(result.status, 'origin-transition-complete'); assert.equal(result.minimumGeneration, 4);
  assert.equal(result.serviceStarted, false); assert.equal(result.proxyChanged, false); assert.equal(result.sessionRestored, false);
  assert.deepEqual(JSON.parse(await readFile(f.configPath, 'utf8')), { ...f.config, origin: toOrigin });
  assert.deepEqual(JSON.parse(await readFile(f.receiptPath, 'utf8')), { ...f.receipt, origin: toOrigin });
  assert.deepEqual(await readFile(f.config.statePath), before);
  await assert.rejects(lstat(join(f.target.config, 'migration-config.lock')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(f.target.root, 'operation.lock')), { code: 'ENOENT' });
  const archive = join(f.target.root, 'origin-transition-' + result.id + '.json'); assert.equal((await lstat(archive)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_ONLY|fixture-salt|owner@example/);
  await f.reopen(); assert.deepEqual(await f.store.read('fixture:alice'), credentials());
});
test('saved policies, grants, queues, nonce and UNKNOWN require further migration without erasing their records', async t => {
  for (const records of [
    { 'fixture:alice': { ...credentials(), taskVerificationPolicies: { original: { mode: 'OFF', changes: [{ scopeDigest: 'untouched' }] } } } },
    { 'fixture:alice': { ...credentials(), assetControlPolicies: { original: { value: false } } } },
    { ['task-grant:' + '1'.repeat(64)]: { schema: '8415-task-grant/1', principal: 'old scope', status: 'revoked' } },
    { ['task-queue:' + '2'.repeat(64)]: { entries: ['old-grant'] } },
    { ['task-nonce:' + '3'.repeat(64)]: { permanent: true, nonce: '7' } },
    { ['task-operation:' + '4'.repeat(64)]: { status: 'outcome-unknown', transactionHash: null } },
    { 'fixture:alice': { ...credentials(), futureScope: { origin: fromOrigin } } },
  ]) {
    const f = await fixture(t, records), state = await readFile(f.config.statePath), config = await readFile(f.configPath);
    await assert.rejects(transitionManagedOrigin(f.options()), /AUTH_ORIGIN_SCOPE_MIGRATION_REQUIRED/);
    assert.deepEqual(await readFile(f.config.statePath), state); assert.deepEqual(await readFile(f.configPath), config);
    await assert.rejects(lstat(join(f.target.config, 'migration-config.lock')), { code: 'ENOENT' });
    await f.reopen(); assert.deepEqual(await f.store.readMany(Object.keys(records)), records);
  }
});
test('interruption at every durable stage resumes forward without state rollback or repeated authorization', async t => {
  for (const stage of ['fenced', 'config-written', 'receipt-written', 'archived', 'fence-cleared']) {
    const f = await fixture(t), state = await readFile(f.config.statePath);
    await assert.rejects(transitionManagedOrigin(f.options({ checkpoint: async name => { if (name === stage) throw Error('INJECTED_INTERRUPT'); } })), /INJECTED_INTERRUPT/);
    await f.reopen(); const result = await transitionManagedOrigin(f.options()); assert.equal(result.status, 'origin-transition-complete');
    assert.deepEqual(await readFile(f.config.statePath), state);
    assert.equal(JSON.parse(await readFile(f.configPath)).origin, toOrigin); assert.equal(JSON.parse(await readFile(f.receiptPath)).origin, toOrigin);
  }
});
test('changed original state or config refuses recovery and leaves fences for the owning operator', async t => {
  for (const kind of ['state', 'config']) {
    const f = await fixture(t);
    await assert.rejects(transitionManagedOrigin(f.options({ checkpoint: async name => { if (name === 'fenced') throw Error('INJECTED_INTERRUPT'); } })), /INJECTED_INTERRUPT/);
    await f.reopen();
    if (kind === 'state') { await f.store.transaction('fixture:alice', value => ({ ...value, revision: 8 })); }
    else await writeFile(f.configPath, JSON.stringify({ ...f.config, accounts: [{ username: 'other', wallets: [] }] }));
    const state = await readFile(f.config.statePath), config = await readFile(f.configPath);
    await assert.rejects(transitionManagedOrigin(f.options()), /AUTH_ORIGIN_RECOVERY_(BINDING_REFUSED|FILE_CHANGED)/);
    assert.deepEqual(await readFile(f.config.statePath), state); assert.deepEqual(await readFile(f.configPath), config);
    assert.ok((await lstat(join(f.target.config, 'migration-config.lock'))).isFile());
  }
});
test('active service, absent original state and different-host destinations are never silently repaired', async t => {
  const active = await fixture(t);
  await assert.rejects(transitionManagedOrigin(active.options({ run: async () => 'MainPID=123\nActiveState=active\nSubState=running\n' })), /AUTH_ORIGIN_SERVICE_MUST_BE_STOPPED/);
  const absent = await fixture(t, {}, false);
  await assert.rejects(transitionManagedOrigin(absent.options()), /AUTH_ORIGIN_EXISTING_STATE_REQUIRED/);
  await assert.rejects(lstat(absent.config.statePath), { code: 'ENOENT' });
  await assert.rejects(transitionManagedOrigin(active.options({ toOrigin: 'https://another.example' })), /AUTH_ORIGIN_SCOPE_MIGRATION_REQUIRED/);
});
test('store transition drains admitted writes, closes admission and exports no raw credential snapshot', async () => {
  const store = new MemoryCredentialStore({ 'fixture:alice': credentials() }); let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const writing = store.transaction('fixture:alice', async value => { await barrier; return { ...value, revision: 8 }; });
  const migrating = store.withOriginTransition({ tenant: 'fixture', fromOrigin, toOrigin }, async proof => {
    assert.deepEqual(Object.keys(proof).sort(), ['schema', 'tenant', 'fromOrigin', 'toOrigin', 'stateSha256', 'recordCount'].sort());
    assert.equal(proof.stateSha256, sha(JSON.stringify({ 'fixture:alice': { ...credentials(), revision: 8 } })));
    assert.doesNotMatch(JSON.stringify(proof), /SYNTHETIC_ONLY|fixture-salt/); return 'preserved';
  });
  await assert.rejects(store.transaction('fixture:alice', v => v), /AUTH_STORE_CLOSED/);
  release(); await writing; assert.equal(await migrating, 'preserved'); await store.close();
});
test('completed transition is reconciled read-only without opening credentials or replaying changes', async t => {
  const f = await fixture(t), done = await transitionManagedOrigin(f.options());
  const before = await readFile(f.config.statePath);
  const result = await inspectManagedOriginTransition({ target: f.target, transitionId: done.id, uid: process.getuid() });
  assert.equal(result.status, 'completed'); assert.equal(result.filePair, 'after'); assert.equal(result.replayAllowed, false);
  assert.equal(result.credentialStateRead, false); assert.equal(result.currentCredentialState, 'NOT_READ');
  assert.deepEqual(await readFile(f.config.statePath), before);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_ONLY|fixture-salt|owner@example/);
});
test('unknown or interrupted outcomes remain unknown/recovery-required and keep their original fence', async t => {
  const f = await fixture(t);
  const unknown = await inspectManagedOriginTransition({ target: f.target, transitionId: 'a'.repeat(64), uid: process.getuid() });
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.replayAllowed, false);
  await assert.rejects(transitionManagedOrigin(f.options({ checkpoint: async name => { if (name === 'config-written') throw Error('INJECTED_INTERRUPT'); } })), /INJECTED_INTERRUPT/);
  const fence = join(f.target.config, 'migration-config.lock'), raw = await readFile(fence), id = JSON.parse(raw).id;
  const result = await inspectManagedOriginTransition({ target: f.target, transitionId: id, uid: process.getuid() });
  assert.equal(result.status, 'recovery-required'); assert.equal(result.filePair, 'partial');
  assert.equal(result.replayAllowed, false); assert.deepEqual(await readFile(fence), raw);
});
test('historical completion does not conceal later config changes or validate a damaged journal', async t => {
  const f = await fixture(t), done = await transitionManagedOrigin(f.options());
  await writeFile(f.configPath, JSON.stringify({ ...f.config, origin: toOrigin, accounts: [{ username: 'later', wallets: [] }] }));
  const result = await inspectManagedOriginTransition({ target: f.target, transitionId: done.id, uid: process.getuid() });
  assert.equal(result.status, 'completed'); assert.equal(result.filePair, 'changed'); assert.equal(result.currentCredentialState, 'NOT_READ');
  const archive = join(f.target.root, 'origin-transition-' + done.id + '.json'), journal = JSON.parse(await readFile(archive));
  journal.stateSha256 = 'f'.repeat(64); await writeFile(archive, JSON.stringify(journal));
  await assert.rejects(inspectManagedOriginTransition({ target: f.target, transitionId: done.id, uid: process.getuid() }), /AUTH_ORIGIN_JOURNAL_CHANGED/);
});
test('committed file-pair archive with pending transition locks still requires recovery', async t => {
  const f = await fixture(t);
  await assert.rejects(transitionManagedOrigin(f.options({ checkpoint: async name => { if (name === 'archived') throw Error('INJECTED_INTERRUPT'); } })), /INJECTED_INTERRUPT/);
  const fence = join(f.target.config, 'migration-config.lock'), raw = await readFile(fence), id = JSON.parse(raw).id;
  const result = await inspectManagedOriginTransition({ target: f.target, transitionId: id, uid: process.getuid() });
  assert.equal(result.committedArchive, true); assert.equal(result.transitionLocksPresent, true);
  assert.equal(result.status, 'recovery-required'); assert.equal(result.filePair, 'after'); assert.equal(result.replayAllowed, false);
  assert.deepEqual(await readFile(fence), raw);
});
test('journal captures a generation raised by an already-admitted credential write', async t => {
  const initial = credentials(); delete initial.walletBindings;
  const f = await fixture(t, { 'fixture:alice': initial }); assert.equal(f.store.originTransitionBinding().minimumGeneration, 1);
  let release; const barrier = new Promise(resolve => { release = resolve; });
  const writing = f.store.transaction('fixture:alice', async value => { await barrier; return { ...value, walletBindings: credentials().walletBindings }; });
  const gate = f.store.withOriginTransition.bind(f.store);
  f.store.withOriginTransition = (scope, action) => { release(); return gate(scope, action); };
  const result = await transitionManagedOrigin(f.options()); await writing;
  assert.equal(result.minimumGeneration, 4);
  const archive = JSON.parse(await readFile(join(f.target.root, 'origin-transition-' + result.id + '.json')));
  assert.equal(archive.minimumGeneration, 4); await f.reopen();
  assert.equal(f.store.originTransitionBinding().minimumGeneration, 4);
  assert.deepEqual(await f.store.read('fixture:alice'), credentials());
});
