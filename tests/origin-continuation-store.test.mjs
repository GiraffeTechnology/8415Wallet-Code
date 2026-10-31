/** Isolated encrypted-store compatibility tests. No production state or migration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { openEncryptedStore } from '../server/store.mjs';
import { openEncryptedStore as legacyOpen } from './legacy-store795.fixture.mjs';
import { createOriginContinuation, originContinuationKey } from '../server/origin-continuation.mjs';
import { decodeStorePayload as decodeGeneration4 } from './fixtures/origin-generation4/store-state-generation.mjs';
import { requiredStoreGeneration, decodeStorePayload, ORIGIN_CONTINUATION_CAPABILITY } from '../server/store-state-generation.mjs';
const mapping = () => createOriginContinuation({ schema: '8415wallet-origin-continuation/1', tenant: 'fixture',
  authorizationOrigin: 'https://wallet.example:9446', transportOrigin: 'https://wallet.example', revision: '1',
  priorStateSha256: 'a'.repeat(64), contractDigest: 'b'.repeat(64),
  principals: [{ username: 'alice', account: '0x' + '1'.repeat(40), chainId: '560048' }] });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wallet-origin-store-')), file = join(dir, 'synthetic.enc'), key = Buffer.alloc(32, 93);
  const handles = new Set();
  t.after(async () => { for (const handle of handles) await handle.close(); await rm(dir, { recursive: true, force: true }); });
  return { file, key, async open() { const h = await openEncryptedStore(file, key); handles.add(h); return h; },
    async close(h) { await h.close(); handles.delete(h); } };
}
function unpack(raw, key) {
  const e = JSON.parse(raw), d = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  d.setAAD(Buffer.from(`8415wallet-auth-store/${e.version}`)); d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return { version: e.version, payload: JSON.parse(Buffer.concat([d.update(Buffer.from(e.data, 'base64')), d.final()]).toString()) };
}
test('persisted continuation upgrades to authenticated generation5 and preserves original records through restart', async t => {
  const f = await fixture(t), s = await f.open(), m = mapping(), k = originContinuationKey(m);
  const original = { principal: 'immutable-signed-principal', status: 'UNKNOWN', nonce: '7',
    signedPayload: 'unchanged', digest: 'c'.repeat(64), ownerRevision: '12', budget: '123' };
  await s.transaction('task-grant:original', () => original);
  await s.transaction(k, () => m); await f.close(s);
  const raw = await readFile(f.file, 'utf8'), decoded = unpack(raw, f.key);
  assert.equal(decoded.version, 5); assert.equal(decoded.payload.requiredCapabilities[3], ORIGIN_CONTINUATION_CAPABILITY);
  assert.deepEqual(decoded.payload.records['task-grant:original'], original);
  assert.throws(() => decodeGeneration4(decoded.payload, 5), /AUTH_STORE_VERSION_REFUSED/);
  assert.throws(() => decodeGeneration4(decoded.payload, 4), /AUTH_STORE_CAPABILITY_REFUSED/);
  await assert.rejects(legacyOpen(f.file, f.key), /AUTH_STORE_VERSION_REFUSED/);
  const reopened = await f.open(); assert.deepEqual(await reopened.read(k), m);
  assert.deepEqual(await reopened.read('task-grant:original'), original);
  await reopened.transaction('unrelated', () => ({ revision: 1 })); await f.close(reopened);
  assert.equal(unpack(await readFile(f.file, 'utf8'), f.key).version, 5);
});
test('malformed or misplaced mapping is rejected before persistence without poisoning the store', async t => {
  const f = await fixture(t), s = await f.open(), m = mapping(), k = originContinuationKey(m);
  await s.transaction('original', () => ({ revision: 3 })); const before = await readFile(f.file);
  for (const [key, value] of [[k, null], [k, false], [k, { ...m, digest: 'd'.repeat(64) }], ['@origin-continuation:wrong', m]]) {
    await assert.rejects(s.transaction(key, () => value), /AUTH_ORIGIN_CONTINUATION_REFUSED/);
    assert.deepEqual(await readFile(f.file), before);
  }
  await s.transaction('original', x => ({ ...x, revision: 4 })); assert.equal((await s.read('original')).revision, 4);
});
test('continuation in a legacy payload or a missing/reordered capability cannot silently downgrade', () => {
  const m = mapping(), records = { [originContinuationKey(m)]: m };
  assert.equal(requiredStoreGeneration(records), 5);
  assert.throws(() => decodeStorePayload(records, 1), /AUTH_STORE_GENERATION_UPGRADE_REQUIRED/);
  assert.throws(() => decodeStorePayload({ schema: '8415wallet-credential-state/4', requiredCapabilities:
    ['credential.assetControlPolicies/1', 'credential.caBindings/1', 'credential.walletBindings/1'], records }, 4), /AUTH_STORE_GENERATION_UPGRADE_REQUIRED/);
  assert.throws(() => decodeStorePayload({ schema: '8415wallet-credential-state/5', requiredCapabilities: [], records }, 5), /AUTH_STORE_CAPABILITY_REFUSED/);
  assert.equal(requiredStoreGeneration({}, 5), 5);
});
