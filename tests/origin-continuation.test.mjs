/** Strict metadata/realm selection tests; not migrated runtime or production evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOriginContinuation, readOriginContinuation, originContinuationKey, resolveOriginContinuation } from '../server/origin-continuation.mjs';
const actor = { username: 'alice', account: '0x' + '1'.repeat(40), chainId: '560048' };
const input = { schema: '8415wallet-origin-continuation/1', tenant: 'fixture',
  authorizationOrigin: 'https://wallet.example:9446', transportOrigin: 'https://wallet.example',
  revision: '1', priorStateSha256: 'a'.repeat(64), contractDigest: 'b'.repeat(64), principals: [actor] };
const session = () => ({ tenant: input.tenant, transportOrigin: input.transportOrigin, ...actor });
const refused = action => assert.throws(action, /AUTH_ORIGIN_CONTINUATION_REFUSED/);
test('exact persisted record selects the preserved authority realm with immutable mapping metadata', () => {
  const record = createOriginContinuation(input), raw = JSON.stringify(record);
  const result = resolveOriginContinuation(readOriginContinuation(JSON.parse(raw)), session());
  assert.equal(result.authorizationOrigin, input.authorizationOrigin); assert.equal(result.continuation.reference, originContinuationKey(input));
  assert.equal(result.continuation.digest, record.digest); assert.equal(result.continuation.revision, '1');
  assert.equal(JSON.stringify(record), raw); assert.ok(Object.isFrozen(record.principals[0]));
  assert.equal(Object.hasOwn(result, 'grant'), false); assert.equal(Object.hasOwn(result, 'approved'), false);
});
test('unmapped identity keeps canonical realm; tenant or transport mismatch refuses instead of trying another realm', () => {
  const record = createOriginContinuation(input);
  for (const change of [{ username: 'bob' }, { account: '0x' + '2'.repeat(40) }, { chainId: '1' }]) {
    const result = resolveOriginContinuation(record, { ...session(), ...change });
    assert.equal(result.authorizationOrigin, input.transportOrigin); assert.equal(result.continuation, null);
  }
  for (const change of [{ tenant: 'other' }, { transportOrigin: 'https://other.example' }])
    refused(() => resolveOriginContinuation(record, { ...session(), ...change }));
});
test('absent metadata is unmapped, while null/damaged persisted metadata cannot be a compatible record', () => {
  assert.deepEqual(resolveOriginContinuation(null, session()), { authorizationOrigin: input.transportOrigin, continuation: null });
  for (const value of [undefined, {}, { ...createOriginContinuation(input), digest: 'c'.repeat(64) }]) refused(() => readOriginContinuation(value));
});
test('modified origin, principal, revision or source binding invalidates the original mapping digest', () => {
  const record = createOriginContinuation(input);
  for (const mutation of [v => v.authorizationOrigin = 'https://wallet.example:9447', v => v.principals[0].chainId = '1',
    v => v.revision = '2', v => v.priorStateSha256 = 'c'.repeat(64), v => v.contractDigest = 'd'.repeat(64)]) {
    const changed = structuredClone(record); mutation(changed); refused(() => readOriginContinuation(changed));
  }
});
test('noncanonical origins, alternate destinations, cross-host maps and unsupported schemas refuse', () => {
  for (const change of [{ transportOrigin: 'https://wallet.example:443' }, { transportOrigin: 'https://wallet.example:9447' },
    { authorizationOrigin: 'https://elsewhere.example:9446' }, { authorizationOrigin: 'https://wallet.example' },
    { transportOrigin: 'http://wallet.example' }, { schema: '8415wallet-origin-continuation/2' }, { revision: '01' }])
    refused(() => createOriginContinuation({ ...input, ...change }));
});
test('duplicate, unsorted, sparse, accessor and extra-field principal lists cannot broaden scope', () => {
  const bob = { ...actor, username: 'bob' };
  for (const principals of [[actor, actor], [bob, actor], new Array(1), [{ ...actor, wildcard: true }]])
    refused(() => createOriginContinuation({ ...input, principals }));
  const accessor = []; Object.defineProperty(accessor, '0', { enumerable: true, get() { throw Error('getter must not execute'); } });
  refused(() => createOriginContinuation({ ...input, principals: accessor }));
  refused(() => readOriginContinuation({ ...createOriginContinuation(input), globalAlias: true }));
});
test('caller context cannot supply a mapping, wildcard or noncanonical account/chain', () => {
  const record = createOriginContinuation(input);
  for (const change of [{ continuation: record }, { account: '*' }, { chainId: '0560048' }, { chainId: '0' }])
    refused(() => resolveOriginContinuation(record, { ...session(), ...change }));
});
