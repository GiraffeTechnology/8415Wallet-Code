import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { openEncryptedStore, MAX_STORE_BYTES } from '../server/store.mjs';
import { openEncryptedStore as legacyOpen } from './legacy-store795.fixture.mjs';
import { requiredStoreGeneration, ASSET_CONTROL_CAPABILITY, decodeStorePayload } from '../server/store-state-generation.mjs';

// Synthetic keys and records only. No account secrets, live service or migration.
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wallet2-store-generation-'));
  const file = join(dir, 'synthetic.enc'), key = Buffer.alloc(32, 79);
  const handles = new Set();
  t.after(async () => { for (const h of handles) await h.close(); await rm(dir, { recursive: true, force: true }); });
  return { file, key, async open(old = false) { const h = await (old ? legacyOpen : openEncryptedStore)(file, key); handles.add(h); return h; },
    async close(h) { await h.close(); handles.delete(h); } };
}
const envelope = async f => JSON.parse(await readFile(f.file, 'utf8'));
function unpack(e, key) {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAAD(Buffer.from(`8415wallet-auth-store/${e.version}`)); d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString());
}
async function pack(f, version, payload) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', f.key, iv);
  c.setAAD(Buffer.from(`8415wallet-auth-store/${version}`));
  const data = Buffer.concat([c.update(JSON.stringify(payload)), c.final()]);
  await writeFile(f.file, JSON.stringify({ version, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 });
}
const record = () => ({ revision: 1, lastStep: -1 });
const policy = value => ({ scope: { account: 'synthetic' }, revision: '1', entries: [{ key: 'allow-agent', value, revision: '1' }] });

test('unchanged legacy records remain v1 and readable/writable by exact795 reader', async t => {
  const f = await fixture(t), old = await f.open(true);
  await old.transaction('tenant:synthetic', record); await f.close(old);
  const current = await f.open(); assert.deepEqual(await current.read('tenant:synthetic'), record());
  await current.transaction('tenant:synthetic', x => ({ ...x, revision: 2 })); await f.close(current);
  assert.equal((await envelope(f)).version, 1);
  const again = await f.open(true); assert.equal((await again.read('tenant:synthetic')).revision, 2);
});
test('first saved explicit OFF atomically persists v2 and exact old reader refuses', async t => {
  const f = await fixture(t), current = await f.open();
  await current.transaction('tenant:synthetic', () => ({ ...record(), assetControlPolicies: { scoped: policy(false) } }));
  await assert.rejects(f.open(true), /EEXIST/); await f.close(current);
  const e = await envelope(f), payload = unpack(e, f.key);
  assert.equal(e.version, 2); assert.deepEqual(payload.requiredCapabilities, [ASSET_CONTROL_CAPABILITY]);
  assert.equal(payload.records['tenant:synthetic'].assetControlPolicies.scoped.entries[0].value, false);
  await assert.rejects(f.open(true), /AUTH_STORE_VERSION_REFUSED/);
  const reopened = await f.open(); assert.equal((await reopened.read('tenant:synthetic')).assetControlPolicies.scoped.entries[0].value, false);
  assert.equal((await stat(f.file)).mode & 0o777, 0o600);
});
test('empty new policy map is generation2, and removal never lowers durable floor across restart', async t => {
  const f = await fixture(t), s = await f.open();
  await s.transaction('tenant:synthetic', () => ({ ...record(), assetControlPolicies: {} }));
  await s.transaction('tenant:synthetic', record); assert.equal((await envelope(f)).version, 2); await f.close(s);
  const next = await f.open(); await next.transaction('another', record); await f.close(next);
  assert.equal((await envelope(f)).version, 2); await assert.rejects(f.open(true), /AUTH_STORE_VERSION_REFUSED/);
});
test('rewriting only version header cannot downgrade authenticated generation2', async t => {
  const f = await fixture(t), s = await f.open();
  await s.transaction('tenant:synthetic', () => ({ assetControlPolicies: {} })); await f.close(s);
  const e = await envelope(f); e.version = 1; await writeFile(f.file, JSON.stringify(e));
  await assert.rejects(f.open()); await assert.rejects(f.open(true));
  assert.equal((await envelope(f)).version, 1); // Refusal does not rewrite or migrate.
});
test('v1 that already carries ignored new fields is refused without migration or lock leakage', async t => {
  const f = await fixture(t), old = await f.open(true);
  await old.transaction('tenant:synthetic', () => ({ assetControlPolicies: { scoped: policy(false) } })); await f.close(old);
  const before = await readFile(f.file);
  await assert.rejects(f.open(), /AUTH_STORE_GENERATION_UPGRADE_REQUIRED/);
  assert.deepEqual(await readFile(f.file), before);
  await assert.rejects(stat(`${f.file}.lock`), { code: 'ENOENT' });
});
test('cancelled/throwing or capacity-rejected save leaves v1 bytes and store healthy', async t => {
  const f = await fixture(t), s = await f.open(); await s.transaction('tenant:synthetic', record);
  const before = await readFile(f.file);
  await assert.rejects(s.transaction('tenant:synthetic', () => { throw Error('FACTOR_CANCELLED'); }), /FACTOR_CANCELLED/);
  await assert.rejects(s.transaction('tenant:synthetic', () => ({ assetControlPolicies: {}, padding: 'a'.repeat(MAX_STORE_BYTES) })), /AUTH_STORE_CAPACITY/);
  assert.deepEqual(await readFile(f.file), before); assert.deepEqual(await s.read('tenant:synthetic'), record());
  await s.transaction('tenant:synthetic', x => ({ ...x, revision: 2 })); assert.equal((await envelope(f)).version, 1);
});
test('generation2 capacity floor rejection is pre-persist and does not poison store', async t => {
  const f = await fixture(t), s = await f.open(); await s.transaction('tenant:synthetic', () => ({ assetControlPolicies: {} }));
  await s.transaction('tenant:synthetic', record);
  const before = await readFile(f.file);
  await assert.rejects(s.transaction('tenant:synthetic', () => ({ padding: 'a'.repeat(MAX_STORE_BYTES) })), /AUTH_STORE_CAPACITY/);
  assert.deepEqual(await readFile(f.file), before); await s.transaction('another', record);
  assert.equal((await envelope(f)).version, 2);
});
test('unknown generation/capability/schema or malformed records refuse before read', async t => {
  const f = await fixture(t);
  for (const [version, payload, pattern] of [
    [5, {}, /AUTH_STORE_CAPABILITY_REFUSED/],
    [999, {}, /AUTH_STORE_VERSION_REFUSED/],
    [3, {}, /AUTH_STORE_CAPABILITY_REFUSED/],
    [4, {}, /AUTH_STORE_CAPABILITY_REFUSED/],
    [2, { schema: '8415wallet-credential-state/2', requiredCapabilities: ['future/1'], records: {} }, /AUTH_STORE_CAPABILITY_REFUSED/],
    [2, { schema: 'old', requiredCapabilities: [ASSET_CONTROL_CAPABILITY], records: {} }, /AUTH_STORE_CAPABILITY_REFUSED/],
    [2, { schema: '8415wallet-credential-state/2', requiredCapabilities: [ASSET_CONTROL_CAPABILITY], records: [] }, /AUTH_STORE_CAPABILITY_REFUSED/],
    [2, { schema: '8415wallet-credential-state/2', requiredCapabilities: [], records: {} }, /AUTH_STORE_CAPABILITY_REFUSED/],
  ]) { await pack(f, version, payload); await assert.rejects(f.open(), pattern); }
});
test('new fields are detected by own-key presence, not truthiness or unrelated nested text', () => {
  for (const value of [null, false, {}, { scoped: policy(true) }]) assert.equal(requiredStoreGeneration({ a: { assetControlPolicies: value } }), 2);
  assert.equal(requiredStoreGeneration({ journal: { unrelated: { assetControlPolicies: {} } } }), 1);
  assert.equal(requiredStoreGeneration({}, 2), 2);
  assert.throws(() => decodeStorePayload({}, 9), /AUTH_STORE_VERSION_REFUSED/);
});
test('serialized multi-record success upgrades data and grant index together', async t => {
  const f = await fixture(t), s = await f.open();
  await s.transactionMany(['tenant:synthetic', 'grant:index'], async () => ({
    'tenant:synthetic': { assetControlPolicies: { scoped: policy(false) } }, 'grant:index': { revision: '2' }
  })); await f.close(s);
  const reopened = await f.open();
  const pair = await reopened.readMany(['tenant:synthetic', 'grant:index']);
  assert.equal(pair['tenant:synthetic'].assetControlPolicies.scoped.entries[0].value, false);
  assert.equal(pair['grant:index'].revision, '2'); assert.equal((await envelope(f)).version, 2);
});
