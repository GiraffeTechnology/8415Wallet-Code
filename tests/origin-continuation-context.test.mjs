/** Synthetic session/store fixtures; no production migration or execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthorizationContext } from '../server/origin-continuation-context.mjs';
import { createOriginContinuation, originContinuationKey } from '../server/origin-continuation.mjs';
const tenant = 'fixture', transportOrigin = 'https://wallet.example';
const session = { username: 'alice', account: '0x' + '1'.repeat(40), chainId: '560048' };
const mapping = () => createOriginContinuation({ schema: '8415wallet-origin-continuation/1', tenant,
  transportOrigin, authorizationOrigin: transportOrigin + ':9446', revision: '1', priorStateSha256: 'a'.repeat(64),
  contractDigest: 'b'.repeat(64), principals: [session] });
const select = (store, selected = session, validateSession = async () => {}) =>
  readAuthorizationContext({ store, tenant, transportOrigin, session: selected, validateSession });
test('fixed trusted-store lookup binds context to independently authenticated session', async () => {
  const m = mapping(), reads = [], checks = [];
  const context = await select({ read: async key => { reads.push(key); return m; } }, session, async s => checks.push(s));
  assert.deepEqual(reads, [originContinuationKey(m)]); assert.deepEqual(checks, [session, session]);
  assert.equal(context.authorizationOrigin, transportOrigin + ':9446');
  assert.equal(context.transportOrigin, transportOrigin); assert.equal(context.continuation.digest, m.digest);
  assert.equal(context.schema, '8415wallet-authorization-context/1'); assert.ok(Object.isFrozen(context));
  assert.equal(Object.hasOwn(context, 'grant'), false); assert.equal(Object.hasOwn(context, 'executable'), false);
});
test('unlisted account or chain and absent record keep independent canonical realm', async () => {
  for (const [record, selected] of [[null, session], [mapping(), { ...session, chainId: '1' }],
    [mapping(), { ...session, account: '0x' + '2'.repeat(40) }]]) {
    const result = await select({ read: async () => record }, selected);
    assert.equal(result.authorizationOrigin, transportOrigin); assert.equal(result.continuation, null);
  }
});
test('damaged persisted metadata refuses instead of silently reporting canonical defaults', async () => {
  await assert.rejects(select({ read: async () => ({ ...mapping(), digest: 'c'.repeat(64) }) }), /AUTH_ORIGIN_CONTINUATION_REFUSED/);
});
test('expired or revoked session during a delayed store read cannot receive a late context', async () => {
  let active = true;
  await assert.rejects(select({ read: async () => { active = false; return mapping(); } }, session,
    async () => { if (!active) throw Error('AUTH_REFUSED'); }), /AUTH_REFUSED/);
});
test('generation5 without its exact continuation cannot report canonical defaults', async () => {
  await assert.rejects(select({read:async()=>null,originTransitionBinding:()=>({minimumGeneration:5})}),/AUTH_ORIGIN_CONTINUATION_REFUSED/);
});
