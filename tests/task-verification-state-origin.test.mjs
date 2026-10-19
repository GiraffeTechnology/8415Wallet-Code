import test from 'node:test';
import assert from 'node:assert/strict';
import { scope, taskVerificationPolicyKey, readCredentialTaskVerificationPolicy,
  TaskVerificationPolicyError } from '../server/task-verification-state.mjs';

const valid = () => ({ origin: 'https://wallet.example', tenant: 'example', username: 'alice',
  account: '0x' + '1'.repeat(40), chainId: '560048', agentId: 'example:agent' });
const refused = action => assert.throws(action, error =>
  error instanceof TaskVerificationPolicyError &&
  error.message === 'TASK_VERIFICATION_SCOPE_REFUSED' && error.status === 400);

test('malformed origin returns exact scoped 400 refusal through every policy reader', () => {
  for (const origin of ['', 'not a URL', 'https://', 'https://[invalid', 'null']) {
    const input = { ...valid(), origin };
    refused(() => scope(input));
    refused(() => taskVerificationPolicyKey(input));
    refused(() => readCredentialTaskVerificationPolicy({ revision: 7 }, input));
  }
});

test('noncanonical paths, userinfo and default-port origin aliases remain refused', () => {
  for (const origin of ['https://wallet.example/', 'https://wallet.example/path',
    'https://wallet.example?x=1', 'https://wallet.example#fragment',
    'https://user@wallet.example', 'https://wallet.example:443', 'HTTPS://wallet.example'])
    refused(() => scope({ ...valid(), origin }));
});

test('canonical origin and explicit nondefault port preserve independent policy scopes', () => {
  const input = valid(), other = { ...input, origin: 'https://wallet.example:9446' };
  assert.deepEqual(scope(input), input);
  assert.ok(Object.isFrozen(scope(input)));
  assert.notEqual(taskVerificationPolicyKey(input), taskVerificationPolicyKey(other));
  for (const value of [input, other]) {
    const state = readCredentialTaskVerificationPolicy({ revision: 7 }, value);
    assert.equal(state.mode, 'ON');
    assert.equal(state.revision, '0');
    assert.deepEqual(state.scope, value);
    assert.deepEqual(state.changes, []);
  }
});
