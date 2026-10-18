/** Synthetic service configuration/approval isolation, not genuine business acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskAuthorizationService, freezeTaskExecutorIdentity } from '../server/task-authorization.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';

const epoch = 1_800_000_000_000, origin = 'https://wallet.example.invalid';
const actor = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40);
const identity = adapterId => ({ schema: '8415-task-executor/1', agentId: 'synthetic:agent', agentVersion: '1',
  adapterId, adapterVersion: '1', implementationDigest: '0x' + '3'.repeat(64) });
const exactIdentity = identity('synthetic:exact'), listingIdentity = identity('artfi:seaport'), receiptIdentity = identity('synthetic:receipt');
const ports = () => ({ async verify() { throw Error('not executed'); }, async send() { throw Error('not executed'); }, async recover() { throw Error('not executed'); } });
const bindings = () => ({
  'exact-operation': { executorIdentity: { ...exactIdentity }, observationPolicy: { minimumConfirmations: '2' } },
  'nft-sale': { executorIdentity: { ...listingIdentity }, observationPolicy: { minimumConfirmations: '3' } },
  'artfi-receipt': { executorIdentity: { ...receiptIdentity }, observationPolicy: null },
});
async function fixture(options = {}) {
  const store = new MemoryCredentialStore(), session = { username: 'tester', account: actor, chainId: '560048',
    id: 'synthetic:session', revision: 1, issuedAt: epoch, expiresAt: epoch + 900000 };
  await store.transaction('xiongan:tester', () => ({ revision: 1, lastStep: -1 }));
  const args = { origin, tenant: 'xiongan', store, now: () => epoch,
    assertSession(s, credential) { assert.strictEqual(s, session); if (credential !== undefined) assert.equal(credential.revision, 1); },
    credentialFor: () => store.read('xiongan:tester'),
    consumeTotp(s, credential, code) { assert.strictEqual(s, session); assert.equal(code, 'synthetic-proof'); return { ...credential, lastStep: 1 }; },
    execution: ports(), listingExecution: ports(), receiptHandlerId: 'artfi:whole-receipt:v1', channelBindings: bindings(), ...options };
  const service = createTaskAuthorizationService(args);
  const call = (path, body) => service.handler('tasks/' + path, body, session);
  const common = taskId => ({ schema: '8415-agent-task/1', taskId, tenant: 'xiongan', origin,
    actor, chainId: '560048', expiresAt: String(epoch / 1000 + 7200), fees: { perOperationWei: '1000000', totalWei: '1000000' } });
  const exact = { ...common('synthetic:exact-task'), intent: { kind: 'exact-operation',
    operation: { kind: 'native-transfer', actor, chainId: '560048', recipient, valueWei: '10' } } };
  const listing = { ...common('synthetic:listing-task'), intent: { kind: 'nft-sale', direction: 'sell', standard: 'ERC-1155',
    contract: recipient, tokenId: '7', quantity: '10', minimumProceeds: { currency: 'USD', amountMinor: '50000', minorUnit: 2, comparison: 'gt', basis: 'net' },
    marketAdapters: ['artfi:seaport'] } };
  return { args, service, store, session, call, exact, listing };
}
test('prepare selects each normalized task kind without global identity/policy overwrite', async () => {
  const f = await fixture();
  const [exact, listing] = await Promise.all([f.call('prepare', { policy: f.exact }), f.call('prepare', { policy: f.listing })]);
  assert.equal(exact.executor.digest, freezeTaskExecutorIdentity(exactIdentity).digest);
  assert.equal(listing.executor.digest, freezeTaskExecutorIdentity(listingIdentity).digest);
  assert.notEqual(exact.executor.digest, listing.executor.digest);
  assert.equal(exact.observationPolicy.policy.minimumConfirmations, '2');
  assert.equal(listing.observationPolicy.policy.minimumConfirmations, '3');
  assert.equal(listing.receiptVerifier, null);
});
test('approval cannot substitute another channel executor digest', async () => {
  const f = await fixture(), prepared = await f.call('prepare', { policy: f.exact });
  const body = { challengeId: prepared.challengeId, taskDigest: prepared.task.digest,
    executorDigest: freezeTaskExecutorIdentity(listingIdentity).digest,
    observationPolicyDigest: prepared.observationPolicy.digest, code: prepared.approvalFactor === 'totp' ? 'synthetic-proof' : '' };
  await assert.rejects(f.call('authorize', body), /TASK_APPROVAL_CHALLENGE_REFUSED/);
  const authorized = await f.call('authorize', { ...body, executorDigest: prepared.executor.digest });
  assert.equal(authorized.effectiveStatus, 'authorized');
  assert.equal(authorized.executor.identity.adapterId, exactIdentity.adapterId);
});
test('channel configuration must exactly match the installed ports', async () => {
  const f = await fixture(), missing = bindings(); delete missing['nft-sale'];
  assert.throws(() => createTaskAuthorizationService({ ...f.args, channelBindings: missing }), /TASK_CHANNEL_CONFIG_REFUSED/);
  assert.throws(() => createTaskAuthorizationService({ ...f.args, executorIdentity: exactIdentity }), /TASK_EXECUTOR_IDENTITY_CONFIG_REQUIRED/);
  const reused = bindings(); reused['nft-sale'].executorIdentity = exactIdentity;
  assert.throws(() => createTaskAuthorizationService({ ...f.args, channelBindings: reused }), /TASK_CHANNEL_EXECUTOR_REUSE_REFUSED/);
  assert.throws(() => createTaskAuthorizationService({ ...f.args, channelBindings: null,
    executorIdentity: exactIdentity, observationPolicy: { minimumConfirmations: '2' } }), /TASK_CHANNEL_BINDINGS_REQUIRED/);
});
test('unknown or accessor channel fields refuse before capability getters execute', async () => {
  const f = await fixture(), unknown = { ...bindings(), unknown: {} };
  assert.throws(() => createTaskAuthorizationService({ ...f.args, channelBindings: unknown }), /TASK_CHANNEL_CONFIG_REFUSED/);
  const source = bindings();
  Object.defineProperty(source['exact-operation'], 'executorIdentity', { get() { throw Error('getter must not run'); } });
  assert.throws(() => createTaskAuthorizationService({ ...f.args, channelBindings: source }), /TASK_CHANNEL_CONFIG_REFUSED/);
});
test('removed channel suspends existing approval rather than borrowing a live port', async () => {
  const f = await fixture(), prepared = await f.call('prepare', { policy: f.exact });
  await f.call('authorize', { challengeId: prepared.challengeId, taskDigest: prepared.task.digest,
    executorDigest: prepared.executor.digest, observationPolicyDigest: prepared.observationPolicy.digest, code: prepared.approvalFactor === 'totp' ? 'synthetic-proof' : '' });
  const active = bindings(); delete active['exact-operation'];
  const restarted = createTaskAuthorizationService({ ...f.args, execution: null, channelBindings: active });
  const status = await restarted.handler('tasks/status', { taskDigest: prepared.task.digest }, f.session);
  assert.equal(status.effectiveStatus, 'suspended');
  assert.equal(status.capabilities.executorRevalidationRequired, true);
  await assert.rejects(restarted.handler('tasks/prepare', { policy: { ...f.exact, taskId: 'synthetic:new-exact' } }, f.session), /TASK_CHANNEL_NOT_CONFIGURED/);
});
test('configuration input mutation cannot swap a channel after construction', async () => {
  const source = bindings(), f = await fixture({ channelBindings: source });
  source['exact-operation'].executorIdentity.adapterId = 'synthetic:changed';
  source['exact-operation'].observationPolicy.minimumConfirmations = '1';
  const prepared = await f.call('prepare', { policy: f.exact });
  assert.equal(prepared.executor.identity.adapterId, exactIdentity.adapterId);
  assert.equal(prepared.observationPolicy.policy.minimumConfirmations, '2');
});

test('approval cannot borrow another channel observation policy', async () => {
  const f = await fixture();
  const exact = await f.call('prepare', { policy: f.exact });
  const listing = await f.call('prepare', { policy: f.listing });
  await assert.rejects(f.call('authorize', { challengeId: exact.challengeId, taskDigest: exact.task.digest,
    executorDigest: exact.executor.digest, observationPolicyDigest: listing.observationPolicy.digest,
    code: exact.approvalFactor === 'totp' ? 'synthetic-proof' : '' }), /TASK_APPROVAL_CHALLENGE_REFUSED/);
  const pending = await f.call('status', { taskDigest: exact.task.digest });
  assert.equal(pending.effectiveStatus, 'pending');
});

test('changing only listing approval facts does not suspend the exact channel', async () => {
  const f = await fixture();
  const prepared = [];
  for (const policy of [f.exact, f.listing]) {
    const value = await f.call('prepare', { policy }); prepared.push(value);
    await f.call('authorize', { challengeId: value.challengeId, taskDigest: value.task.digest,
      executorDigest: value.executor.digest, observationPolicyDigest: value.observationPolicy.digest,
      code: value.approvalFactor === 'totp' ? 'synthetic-proof' : '' });
  }
  const source = bindings(); source['nft-sale'].observationPolicy.minimumConfirmations = '4';
  const restarted = createTaskAuthorizationService({ ...f.args, channelBindings: source });
  const exact = await restarted.handler('tasks/status', { taskDigest: prepared[0].task.digest }, f.session);
  const listing = await restarted.handler('tasks/status', { taskDigest: prepared[1].task.digest }, f.session);
  assert.equal(exact.effectiveStatus, 'authorized');
  assert.equal(exact.capabilities.observationPolicyRevalidationRequired, false);
  assert.equal(listing.effectiveStatus, 'suspended');
  assert.equal(listing.capabilities.observationPolicyRevalidationRequired, true);
});
