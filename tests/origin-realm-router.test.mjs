/** Realm dispatch fixtures. Existing task validators are covered separately. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MemoryCredentialStore } from '../server/store.mjs';
import { createOriginContinuation, originContinuationKey } from '../server/origin-continuation.mjs';
import { createOriginRealmRouter } from '../server/origin-realm-router.mjs';
const tenant = 'fixture', origin = 'https://wallet.example', old = origin + ':9446';
const alice = { username: 'alice', account: '0x' + '1'.repeat(40), chainId: '560048' };
const bob = { ...alice, username: 'bob', account: '0x' + '2'.repeat(40) };
const queue = o => 'task-queue:' + createHash('sha256').update(JSON.stringify([o,tenant])).digest('hex');
const gkey = 'task-grant:' + 'c'.repeat(64);
function fixture() {
  const m = createOriginContinuation({ schema: '8415wallet-origin-continuation/1', tenant, transportOrigin: origin,
    authorizationOrigin: old, revision: '1', priorStateSha256: 'a'.repeat(64), contractDigest: 'b'.repeat(64), principals: [alice] });
  const original = { principal: JSON.stringify([old,tenant,alice.username,alice.account,alice.chainId]),
    task: { digest: 'd'.repeat(64) }, reference: 'original-reference', status: 'outcome-unknown', nonce: '7' };
  const store = new MemoryCredentialStore({ [originContinuationKey(m)]: m, [gkey]: original,
    [queue(old)]: { schema: '8415-task-queue/1', entries: [gkey] } });
  const calls = [], predicates = new Map();
  const router = createOriginRealmRouter({ store, tenant, transportOrigin: origin, createRealm(realmOrigin, assertPrincipal) {
    predicates.set(realmOrigin,assertPrincipal);
    const authorization = { assertIndependentStore: candidate => assert.notEqual(candidate,store),
      async inspect(claimed) { calls.push(['inspect',realmOrigin,claimed]); return realmOrigin; } };
    return { realmOrigin, taskService: { cancel() {}, receiptAuthorization: authorization, listingAuthorization: authorization,
      background: { async resume(entry) { calls.push(['resume',realmOrigin,entry]); return { continuation: { state: 'outcome-unknown' } }; } } } };
  } });
  return { router, store, m, original, calls, predicates };
}
test('authenticated exact identity selects old realm while new principals keep canonical realm', async () => {
  const f = fixture(); assert.equal((await f.router.forSession(alice)).realmOrigin,old);
  assert.equal((await f.router.forSession(bob)).realmOrigin,origin);
  assert.throws(() => f.predicates.get(origin)(alice),/AUTH_ORIGIN_REALM_REFUSED/);
  assert.throws(() => f.predicates.get(old)(bob),/AUTH_ORIGIN_REALM_REFUSED/);
  f.predicates.get(old)(alice); f.predicates.get(origin)(bob);
});
test('background and native ports locate original stored principal without rewriting grant or nonce', async () => {
  const f = fixture(); assert.deepEqual(await f.router.background.list(),{ entries: [gkey], nextCursor: null });
  assert.equal((await f.router.background.resume(gkey)).continuation.state,'outcome-unknown');
  assert.equal(await f.router.listingAuthorization.inspect({ taskDigest: f.original.task.digest, grantReference: f.original.reference }),old);
  assert.deepEqual(await f.store.read(gkey),f.original); assert.equal(f.calls.length,2);
  assert.equal(f.calls.every(call => call[1] === old),true);
  await assert.rejects(f.router.receiptAuthorization.inspect({ taskDigest: f.original.task.digest,grantReference: 'forged' }),/AUTH_ORIGIN_REALM_REFUSED/);
  assert.equal(f.calls.length,2);
});
test('altered persisted mapping or queued principal refuses without fallback to another service', async () => {
  const f = fixture(); await f.router.ready;
  await f.store.transaction(gkey,x => ({ ...x,principal: JSON.stringify([old,tenant,bob.username,bob.account,bob.chainId]) }));
  await assert.rejects(f.router.background.resume(gkey),/AUTH_ORIGIN_REALM_REFUSED/); assert.equal(f.calls.length,0);
  const { digest, ...body } = f.m;
  await f.store.transaction(originContinuationKey(f.m),() => createOriginContinuation({ ...body, revision: '2' }));
  await assert.rejects(f.router.forSession(alice),/AUTH_ORIGIN_REALM_REFUSED/);
});
test('generation5 missing its exact mapping refuses startup rather than selecting canonical default authority',async()=>{
  const store=new MemoryCredentialStore();store.originTransitionBinding=()=>({minimumGeneration:5});
  const router=createOriginRealmRouter({store,tenant,transportOrigin:origin,createRealm:()=>({taskService:{
    receiptAuthorization:{},listingAuthorization:{},cancel(){},background:{}}})});
  await assert.rejects(router.ready,/AUTH_ORIGIN_REALM_REFUSED/);await assert.rejects(router.forSession(alice),/AUTH_ORIGIN_REALM_REFUSED/);
});
