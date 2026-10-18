import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../server/crypto.mjs';
import { taskVerificationPolicyKey } from '../server/task-verification-policy.mjs';
import { readTaskGrantVerificationPolicy } from '../server/task-verification-execution.mjs';

// Synthetic source tests only. These records cannot change a real setting.
const scope = { origin: 'https://wallet.example', tenant: 'example', username: 'alice',
  account: '0x' + '1'.repeat(40), chainId: '560048', agentId: 'example:agent' };
const grant = () => ({ principal: JSON.stringify(Object.values(scope).slice(0, 5)),
  task: { digest: '0x' + '2'.repeat(64), policy: { origin: scope.origin, tenant: scope.tenant,
    actor: scope.account, chainId: scope.chainId } },
  executor: { digest: '0x' + '3'.repeat(64), identity: { agentId: scope.agentId } } });
function saved(mode) {
  return { schema: '8415-task-human-verification/2', scope: { ...scope }, mode, revision: '1',
    enforcedFromRevision: '1', changes: [{ revision: '1', previousRevision: '0', mode,
      changeId: 'A'.repeat(43), changeDigest: 'a'.repeat(64),
      scopeDigest: digest(JSON.stringify(scope)), credentialRevision: 7,
      verifiedFactors: ['password', 'verified-email'], changedAt: 1800000000000 }] };
}
const credential = mode => ({ revision: 7, taskVerificationPolicies: {
  [taskVerificationPolicyKey(scope)]: saved(mode) } });
const refused = run => assert.throws(run, error =>
  error.message === 'TASK_VERIFICATION_GRANT_BINDING_REFUSED' && error.status === 503);

test('execution projection reads durable OFF without rotating credential or grant', () => {
  const current = credential('OFF'), task = grant(), before = JSON.stringify([current, task]);
  const result = readTaskGrantVerificationPolicy(current, task);
  assert.equal(result.mode, 'OFF'); assert.equal(result.revision, '1');
  assert.equal(result.credentialRevision, '7'); assert.equal(result.taskDigest, task.task.digest);
  assert.equal(result.executorDigest, task.executor.digest); assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify([current, task]), before);
  assert.deepEqual(Object.keys(result).sort(), ['credentialRevision', 'executorDigest',
    'mode', 'revision', 'schema', 'scopeDigest', 'taskDigest'].sort());
});

test('missing policy defaults ON but is never projected as approval', () => {
  const result = readTaskGrantVerificationPolicy({ revision: 7 }, grant());
  assert.equal(result.mode, 'ON'); assert.equal(result.revision, '0');
  for (const key of ['approved', 'proof', 'authorized', 'canExecute', 'verifiedFactors', 'changes'])
    assert.equal(Object.hasOwn(result, key), false);
});

test('current policy revision is reread without a stale grant-side cache', () => {
  const current = credential('OFF'), task = grant();
  assert.equal(readTaskGrantVerificationPolicy(current, task).mode, 'OFF');
  current.taskVerificationPolicies[taskVerificationPolicyKey(scope)] = saved('ON');
  assert.equal(readTaskGrantVerificationPolicy(current, task).mode, 'ON');
  assert.equal(task.executor.identity.agentId, scope.agentId);
});

test('principal origin tenant account and chain cannot select another policy', () => {
  for (const index of [0, 1, 3, 4]) {
    const task = grant(), principal = JSON.parse(task.principal);
    principal[index] += 'x'; task.principal = JSON.stringify(principal);
    refused(() => readTaskGrantVerificationPolicy(credential('OFF'), task));
  }
  const task = grant(); task.principal = ' ' + task.principal;
  refused(() => readTaskGrantVerificationPolicy(credential('OFF'), task));
});

test('a different executor Agent does not inherit the original Agent OFF', () => {
  const task = grant(); task.executor.identity.agentId = 'example:other-agent';
  const result = readTaskGrantVerificationPolicy(credential('OFF'), task);
  assert.equal(result.mode, 'ON'); assert.equal(result.revision, '0');
});

test('malformed policy state and invalid credential revision fail closed', () => {
  const current = credential('OFF');
  current.taskVerificationPolicies[taskVerificationPolicyKey(scope)].revision = '01';
  assert.throws(() => readTaskGrantVerificationPolicy(current, grant()),
    error => error.status === 409 || error.status === 503);
  for (const revision of [-1, 0.5, '7', Number.MAX_SAFE_INTEGER + 1])
    refused(() => readTaskGrantVerificationPolicy({ revision }, grant()));
});
