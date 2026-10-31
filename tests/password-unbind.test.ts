/** Synthetic HTTP/state regression; no real credentials or email. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, commit, OLD, NEW } from './helpers/method-change-fixture.ts';
import { requiredStoreGeneration } from '../server/store-state-generation.mjs';

test('password unbind persists a tombstone, cannot revive configured password, and can bind anew', async t => {
  const f = await fixture(); t.after(f.close); const c = f.client(); await c.login();
  const proof = await f.authorize(c, { action: 'password.unbind' });
  assert.equal((await commit(c, proof)).status, 200);
  const saved = await f.store.read('xiongan:tester');
  assert.equal(saved.passwordHash, null); assert.equal(saved.passwordBinding, 'unbound');
  assert.equal(requiredStoreGeneration({ 'xiongan:tester': saved }), 2);
  await f.restart(); const fresh = f.client(); await fresh.call('bootstrap');
  const oldLogin = await fresh.call('password', { username: 'tester', password: OLD, account: f.signer.address, chainId: '1' });
  assert.notEqual(oldLogin.status, 200);
  await fresh.login(); assert.equal((await fresh.call('account')).data.methods.password.bound, false);
  const replacement = await f.authorize(fresh, { action: 'password.initial', newPassword: NEW, identityMethod: 'wallet' });
  assert.equal((await commit(fresh, replacement)).status, 200);
  const rebound = await f.store.read('xiongan:tester'); assert.equal(rebound.passwordBinding, undefined);
  assert.equal(typeof rebound.passwordHash, 'string');
});

test('password unbind cannot remove the last enabled independent sign-in method', async t => {
  const f = await fixture({ credential: { enabledMethods: ['password'] } }); t.after(f.close);
  const c = f.client(); await c.call('bootstrap');
  assert.equal((await c.call('password', { username: 'tester', password: OLD, account: f.signer.address, chainId: '1' })).status, 200);
  const before = await f.store.read('xiongan:tester');
  const proof = await f.authorize(c, { action: 'password.unbind' });
  const result = await commit(c, proof);
  assert.equal(result.data.error, 'AUTH_INDEPENDENT_METHOD_REQUIRED');
  assert.deepEqual(await f.store.read('xiongan:tester'), before);
});
