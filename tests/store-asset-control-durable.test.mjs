import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Wallet } from 'ethers';
import { openEncryptedStore } from '../server/store.mjs';
import { openEncryptedStore as legacyOpen } from './legacy-store795.fixture.mjs';
import { createAssetControlPolicyService } from '../server/task-asset-control-policy.mjs';
import { assetControlValue } from '../server/task-asset-control-state.mjs';
// status adds presentation fields; the state decoder intentionally remains strict.
const stateOf = ({ schema, scope, revision, entries, changes }) => ({ schema, scope, revision, entries, changes });

test('actual exact-change owner service keeps default reads v1, commits only saved field in v2, and survives restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wallet2-owner-generation-'));
  const file = join(dir, 'synthetic.enc'), key = Buffer.alloc(32, 43);
  const signer = new Wallet('0x'+'1'.repeat(64)); // Closed synthetic key, not an actual account.
  let store = await openEncryptedStore(file, key);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  const credentialKey = 'tenant:owner', mail = [];
  await store.transaction(credentialKey, () => ({ revision: 0, registration: { version: 1, email: 'owner@example.test', verifiedAt: 1 } }));
  const session = { id: 'synthetic-session', username: 'owner', account: signer.address, chainId: '560048', revision: 0, kind: 'wallet', active: true };
  const users = new Map([['owner', { wallets: [{ account: signer.address, chainId: '560048' }] }]]);
  const service = () => createAssetControlPolicyService({ origin: 'https://wallet.example.test', tenant: 'tenant', agentId: 'agent:test',
    store, users, assertSession: s => { if (!s.active) throw Error('SESSION_REVOKED'); },
    credentialFor: () => store.read(credentialKey), passwordFor: () => null, methodStates: () => ({ wallet: { enabled: true } }),
    directory: { checkCredential: () => {} }, sendOtp: async m => { mail.push(m); }, now: () => 1700000000000 });
  let api = service();
  const before = await readFile(file), initial = await api.status(session);
  assert.equal(initial.defaultValue, true); assert.equal(initial.revision, '0'); assert.deepEqual(initial.entries, []);
  assert.deepEqual(await readFile(file), before); assert.equal(JSON.parse(before).version, 1);
  const target = { kind: 'asset', path: ['all','native','hoodi','eth'] };
  const field = { kind: 'allow-agent' };
  const off = await api.prepare(session, { expectedRevision: '0', identityMethod: 'wallet', patch: { target: field, value: false, expectedFieldRevision: '0' } });
  await assert.rejects(api.confirm(session, { changeId: off.request.changeId, changeDigest: off.changeDigest, code: '00000000' }));
  assert.deepEqual(await readFile(file), before);
  await api.verify(session, { changeId: off.request.changeId, changeDigest: off.changeDigest, signature: await signer.signMessage(off.message) });
  await api.confirm(session, { changeId: off.request.changeId, changeDigest: off.changeDigest, code: mail.at(-1).code });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 2);
  await store.close(); await assert.rejects(legacyOpen(file, key), /AUTH_STORE_VERSION_REFUSED/);
  store = await openEncryptedStore(file, key); api = service();
  const saved = await api.status(session);
  assert.equal(saved.revision, '1'); assert.equal(assetControlValue(stateOf(saved), field).value, false);
  assert.equal(assetControlValue(stateOf(saved), target).value, true);
  const on = await api.prepare(session, { expectedRevision: '1', identityMethod: 'wallet', patch: { target: field, value: true, expectedFieldRevision: '1' } });
  await assert.rejects(api.confirm(session, { changeId: on.request.changeId, changeDigest: on.changeDigest, code: mail.at(-1).code }));
  assert.equal(assetControlValue(stateOf(await api.status(session)), field).value, false);
  await api.verify(session, { changeId: on.request.changeId, changeDigest: on.changeDigest, signature: await signer.signMessage(on.message) });
  await api.confirm(session, { changeId: on.request.changeId, changeDigest: on.changeDigest, code: mail.at(-1).code });
  assert.equal(assetControlValue(stateOf(await api.status(session)), field).value, true);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).version, 2);
});
