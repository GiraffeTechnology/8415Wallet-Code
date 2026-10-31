/** Negative coverage for unsupported wallet changes and unavailable CA binding changes.
 * These passes establish rejection and state preservation, not lifecycle support.
 * Synthetic loopback HTTP, local generated test key and captured OTP only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, commit, OLD } from './helpers/method-change-fixture.ts';

for (const method of ['wallet', 'ca']) {
  for (const operation of (method === 'wallet' ? ['replace'] : ['initial', 'replace', 'unbind'])) {
    test(`${method}.${operation} is refused without credential mutation, OTP or session loss`, async t => {
      const f = await fixture(); t.after(f.close);
      const c = f.client(); await c.login();
      const before = await f.store.read('xiongan:tester');
      const result = await c.call('account/change/start', { action: `${method}.${operation}` });
      assert.equal(result.status, method === 'wallet' ? 400 : 409);
      assert.equal(result.data.error, method === 'wallet' ? 'AUTH_CHANGE_INPUT_REFUSED' : operation === 'initial' ? 'AUTH_METHOD_UNAVAILABLE' : 'AUTH_SETUP_STATE_CHANGED');
      assert.equal(result.data.changeId, undefined);
      assert.equal(result.data.changeProof, undefined);
      assert.equal(f.messages.length, 0);
      assert.deepEqual(await f.store.read('xiongan:tester'), before);
      assert.equal((await c.call('session')).status, 200);
    });
  }
}

test('a methods toggle cannot smuggle wallet/CA bindings into a prepared change', async t => {
  const f = await fixture(); t.after(f.close);
  const c = f.client(); await c.login();
  const before = await f.store.read('xiongan:tester');
  for (const injected of [
    { wallets: [] }, { caFingerprints: [] },
    { walletBinding: 'unbound' }, { caBinding: 'unbound' }
  ]) {
    const result = await c.call('account/change/start', {
      action: 'methods', enabledMethods: ['password'], ...injected
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.error, 'AUTH_CHANGE_INPUT_REFUSED');
  }
  assert.deepEqual(await f.store.read('xiongan:tester'), before);
  assert.equal(f.messages.length, 0);
});

test('an authorized methods proof cannot be converted into wallet/CA unbinding at commit', async t => {
  const f = await fixture(); t.after(f.close);
  const c = f.client(); await c.login();
  const before = await f.store.read('xiongan:tester');
  const proof = await f.authorize(c, { action: 'methods', enabledMethods: ['password'] });
  for (const action of ['wallet.unbind', 'ca.unbind']) {
    const response = await commit(c, proof, { action });
    assert.equal(response.status, 400);
    assert.equal(response.data.error, 'AUTH_CHANGE_INPUT_REFUSED');
    assert.deepEqual(await f.store.read('xiongan:tester'), before);
  }
  // Refused field injection neither changes the exact intent nor consumes it.
  const applied = await commit(c, proof);
  assert.equal(applied.status, 200);
  assert.equal(applied.data.action, 'methods');
});

test('wallet disable persists across restart but retains account identity and is not unbinding', async t => {
  const f = await fixture(); t.after(f.close);
  const c = f.client(); await c.login();
  const proof = await f.authorize(c, { action: 'methods', enabledMethods: ['password'] });
  assert.equal((await commit(c, proof)).status, 200);
  assert.notEqual((await c.call('session')).status, 200);
  await f.restart();
  const disabled = f.client(); await disabled.call('bootstrap');
  const selected = { account: f.signer.address, chainId: '1' };
  const challenge = await disabled.call('challenge', { method: 'wallet', ...selected });
  assert.equal(challenge.status, 200);
  const refused = await disabled.call('proof', {
    ...selected, id: challenge.data.id, signature: await f.signer.signMessage(challenge.data.message)
  });
  assert.notEqual(refused.status, 200);
  const independent = f.client(); await independent.call('bootstrap');
  assert.equal((await independent.call('password', { username: 'tester', password: OLD, ...selected })).status, 200);
  const account = (await independent.call('account')).data;
  assert.equal(account.methods.wallet.bound, true);
  assert.equal(account.methods.wallet.enabled, false);
  const reenable = await f.authorize(independent, { action: 'methods', enabledMethods: ['password', 'wallet'] });
  assert.equal((await commit(independent, reenable)).status, 200);
  await f.restart();
  const restored = f.client(); await restored.login();
  const after = (await restored.call('account')).data;
  assert.equal(after.methods.wallet.bound, true);
  assert.equal(after.methods.wallet.enabled, true);
});
