/** Synthetic independent-port and inventory regressions; no live tenant or transaction. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTaskAuthOptions } from '../server/task-runtime-composition.mjs';
import { createTaskTestAssetAuthorization } from '../server/task-test-asset-authorization.mjs';
import { freezeTaskPolicy } from '../src/agent/taskContract.ts';

test('exact native port composition does not require listing or whole-receipt ports', () => {
  const exact = { taskExecution: { fixture: 'no-signer' }, taskReceipt: { fixture: 'read-only' },
    taskExecutorIdentity: { schema: '8415-task-executor/1', agentId: 'fixture:agent', agentVersion: '1',
      adapterId: 'fixture:exact', adapterVersion: '1', implementationDigest: '0x' + 'a'.repeat(64) },
    taskObservationPolicy: { minimumConfirmations: '2' } };
  const composed = composeTaskAuthOptions({ exact, listing: {}, artfi: {} });
  assert.deepEqual(Object.keys(composed.taskChannelBindings ?? {}), ['exact-operation']);
  assert.equal(composed.taskExecution, exact.taskExecution);
  assert.equal(Object.hasOwn(composed, 'taskListingExecution'), false);
  assert.equal(Object.hasOwn(composed, 'taskReceiptHandlerId'), false);
  assert.throws(() => composeTaskAuthOptions({ exact: { ...exact, taskExecutorIdentity: null } }), /EXECUTOR_REQUIRED/);
});

test('native test inventory remains independent of NFT inventory', async () => {
  const actor = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40), epoch = 1_800_000_000_000;
  const origin = 'https://wallet.example.invalid', tenant = 'fixture';
  const mode = await createTaskTestAssetAuthorization({ inventory: {
    schema: '8415-agent-test-assets/1', chainId: '560048', origin, tenant,
    expiresAt: String(epoch / 1000 + 600), wallets: [actor, recipient], assets: [],
  }, authorizedWallets: [actor, recipient].map(account => ({ account, chainId: '560048' })), now: () => epoch });
  const policy = { schema: '8415-agent-task/1', taskId: 'fixture:native', tenant, origin, chainId: '560048', actor,
    expiresAt: String(epoch / 1000 + 300), fees: { perOperationWei: '100000', totalWei: '100000' },
    intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId: '560048', actor, recipient, valueWei: '1' } } };
  assert.equal(mode.allows(freezeTaskPolicy(policy)), true);
  assert.equal(mode.allows(freezeTaskPolicy({ ...policy, chainId: '11155111', intent: { ...policy.intent,
    operation: { ...policy.intent.operation, chainId: '11155111' } } })), false);
  assert.equal(mode.allows(freezeTaskPolicy({ ...policy, intent: { ...policy.intent,
    operation: { ...policy.intent.operation, recipient: '0x' + '3'.repeat(40) } } })), false);
});
