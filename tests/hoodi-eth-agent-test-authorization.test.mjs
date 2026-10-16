import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskAuthorizationService } from '../server/task-authorization.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { createTaskTestAssetAuthorization } from '../server/task-test-asset-authorization.mjs';
const origin = 'https://wallet.example.invalid', actor = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40);
async function fixture(chainId = '560048') {
  const store = new MemoryCredentialStore(), now = () => 1900000000000;
  const session = { username: 'tester', account: actor, chainId, id: 'synthetic:session', revision: 1, expiresAt: now() + 900000 };
  await store.transaction('xiongan:tester', () => ({ revision: 1 }));
  const mode = await createTaskTestAssetAuthorization({ inventory: { schema: '8415-agent-test-assets/1', chainId: '560048',
    origin, tenant: 'xiongan', expiresAt: '2000000000', wallets: [actor, recipient], assets: [] },
    authorizedWallets: [actor, recipient].map(account => ({ account, chainId: '560048' })), now });
  let factorCalls = 0;
  const options = { origin, tenant: 'xiongan', store, now, testAuthorization: mode,
    assertSession(s) { assert.strictEqual(s, session); }, credentialFor: () => store.read('xiongan:tester'),
    consumeTotp() { factorCalls++; throw Error('SYNTHETIC_FACTOR_REQUIRED'); },
    execution: { verify() {}, send() { assert.fail('approval cannot broadcast'); }, recover() {} },
    executorIdentity: { schema: '8415-task-executor/1', agentId: 'synthetic:agent', agentVersion: '1',
      adapterId: 'synthetic:adapter', adapterVersion: '1', implementationDigest: '0x' + '3'.repeat(64) },
    observationPolicy: { minimumConfirmations: '2' } };
  const service = createTaskAuthorizationService(options), call = (path, body) => service.handler('tasks/' + path, body, session);
  const policy = { schema: '8415-agent-task/1', taskId: 'synthetic:eth', tenant: 'xiongan', origin, chainId, actor,
    expiresAt: '1950000000', fees: { perOperationWei: '100000', totalWei: '100000' },
    intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId, actor, recipient, valueWei: '1' } } };
  const approve = p => call('authorize', { challengeId: p.challengeId, taskDigest: p.task.digest,
    executorDigest: p.executor.digest, observationPolicyDigest: p.observationPolicy.digest, code: '' });
  return { call, policy, approve, service, options, session, store, factors: () => factorCalls };
}
test('Hoodi ETH grant uses server test scope with no password or authenticator data', async () => {
  const f = await fixture(), p = await f.call('prepare', { policy: f.policy });
  assert.equal(p.approvalFactor, 'server-test-scope');
  const result = await f.approve(p);
  assert.equal(result.effectiveStatus, 'authorized'); assert.equal(f.factors(), 0);
  assert.deepEqual(await f.store.read('xiongan:tester'), { revision: 1 });
});
test('other network still requires the original factor', async () => {
  const f = await fixture('1'), p = await f.call('prepare', { policy: f.policy });
  assert.equal(p.approvalFactor, 'totp');
  await assert.rejects(f.approve(p), /SYNTHETIC_FACTOR_REQUIRED/); assert.equal(f.factors(), 1);
});
test('client cannot declare a factor exemption', async () => {
  const f = await fixture();
  await assert.rejects(f.call('prepare', { policy: f.policy, approvalFactor: 'server-test-scope' }), /TASK_REQUEST_REFUSED/);
});
test('removing test scope suspends the previously exempt grant after restart', async () => {
  const f = await fixture(), p = await f.call('prepare', { policy: f.policy }); await f.approve(p);
  const restarted = createTaskAuthorizationService({ ...f.options, testAuthorization: null });
  const result = await restarted.handler('tasks/status', { taskDigest: p.task.digest }, f.session);
  assert.equal(result.effectiveStatus, 'suspended');
});

