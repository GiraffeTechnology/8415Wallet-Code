import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTaskJournalCapabilities } from '../server/task-journal-capabilities.mjs';
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k,canonical(v[k])])) : v;
const digest = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const h = c => `0x${c.repeat(64)}`, a = c => `0x${c.repeat(40)}`;
function fixture() {
  let time = 1000, checks = 0;
  const peerId = 'spiffe://artfi/wallet', r = createTaskJournalCapabilities({ peerId, consumerPeerId:'spiffe://artfi/journal', digest, nativeDigest:digest, now: () => time, ttlMs: 20 });
  const snapshot = { task: { digest: h('1'), policy: { taskId: 'task:synthetic', actor: a('2'), chainId: '1' } }, executor: { digest: h('3') },
    grantReference: 'grant:synthetic', grantPolicyVersion: '1', child:null };
  const principal = { kind: 'task', taskId: snapshot.task.policy.taskId, taskDigest: snapshot.task.digest, executorDigest: snapshot.executor.digest,
    grantReference: snapshot.grantReference, grantPolicyVersion: snapshot.grantPolicyVersion, operationId: `listing:${snapshot.task.digest.slice(2)}` };
  const {kind,...binding}=principal;const operation = { id: `native_${digest(binding)}` }, scope = { peerId, principal, action: 'get', nativeOperationId: operation.id, planDigest: '', requestDigest: digest({ action:'get', operation }), operation };
  const request = token => ({ capability: token, peerId, action: scope.action, nativeOperationId: scope.nativeOperationId, planDigest: scope.planDigest, requestDigest: scope.requestDigest });
  return { r, snapshot, scope, peerId, request, get checks() { return checks; }, recheck() { checks++; }, advance() { time += 20; } };
}
test('capability is consumed exactly once within its actual held gate and binds the same task', async () => {
  const f = fixture();
  await f.r.withHeld(f.snapshot, f.recheck, 'observe', () => f.r.withCapability(f.scope, async token => {
    const c = f.r.consume(f.request(token), 'spiffe://artfi/journal'); assert.deepEqual(c.principal, f.scope.principal); assert.equal(c.wallet, a('2'));
    assert.equal(c.chainId, 1); assert.ok(f.checks >= 4); assert.throws(() => f.r.consume(f.request(token), 'spiffe://artfi/journal'), /CAPABILITY_REFUSED/);
  }));
});
test('scope never exists outside the gate, after settlement, on timeout or after shutdown', async () => {
  const f = fixture(); let token;
  await assert.rejects(f.r.withCapability(f.scope, () => {}), /GATE_REQUIRED/);
  await f.r.withHeld(f.snapshot, f.recheck, 'observe', () => f.r.withCapability(f.scope, async value => { token = value; }));
  assert.throws(() => f.r.consume(f.request(token), 'spiffe://artfi/journal'), /CAPABILITY_REFUSED/);
  await f.r.withHeld(f.snapshot, f.recheck, 'observe', () => f.r.withCapability(f.scope, async value => {
    f.advance(); assert.throws(() => f.r.consume(f.request(value), 'spiffe://artfi/journal'), /CAPABILITY_REFUSED/);
  }));
  await f.r.withHeld(f.snapshot, f.recheck, 'observe', () => f.r.withCapability(f.scope, async value => {
    f.r.stop(); assert.throws(() => f.r.consume(f.request(value), 'spiffe://artfi/journal'), /STOPPED/);
  }));
});
test('peer, action, exact operation, plan and request cannot be changed; authenticated mismatch burns token', async () => {
  for (const altered of [{ action:'update' }, { nativeOperationId:'native_other_operation' }, { planDigest:'1'.repeat(64) }, { requestDigest:'2'.repeat(64) }, { peerId:'spiffe://attacker/service' }]) {
    const f = fixture(); await f.r.withHeld(f.snapshot, f.recheck, 'observe', () => f.r.withCapability(f.scope, async token => {
      assert.throws(() => f.r.consume({ ...f.request(token), ...altered }, 'spiffe://artfi/journal'), /CAPABILITY_REFUSED/);
      assert.throws(() => f.r.consume(f.request(token), 'spiffe://artfi/journal'), /CAPABILITY_REFUSED/);
    }));
  }
  const f = fixture(); await f.r.withHeld(f.snapshot, f.recheck, 'observe', () => f.r.withCapability(f.scope, async token => {
    assert.throws(() => f.r.consume(f.request(token), 'spiffe://attacker/service'), /PEER_REFUSED/);
    assert.equal(f.r.consume(f.request(token), 'spiffe://artfi/journal').peerId, f.peerId);
  }));
});
test('untrusted principals, mutated operation, create from observe and nested held gates are refused', async () => {
  const f = fixture(); await f.r.withHeld(f.snapshot, f.recheck, 'observe', async () => {
    await assert.rejects(f.r.withCapability({ ...f.scope, principal: { ...f.scope.principal, taskDigest:h('9') } }, () => {}), /PRINCIPAL_REFUSED/);
    await assert.rejects(f.r.withCapability({ ...f.scope, operation: { id:'native_other_operation' } }, () => {}), /REQUEST_BINDING_REFUSED/);
    await assert.rejects(f.r.withHeld(f.snapshot, f.recheck, 'observe', () => {}), /REENTRY_REFUSED/);
    const operation = { id:f.scope.nativeOperationId, wallet:a('2'), chainId:1, plan:{ operationId:f.scope.nativeOperationId, taskPrincipal:f.scope.principal } };
    const scope = { ...f.scope, action:'create', operation, planDigest:digest(operation.plan), requestDigest:digest({ action:'create',operation }) };
    await assert.rejects(f.r.withCapability(scope, () => {}), /ACTION_REFUSED/);
  });
});
test('create holds the gate over async I/O, uses exact plan hash and leaves no reusable token on error', async () => {
  const f = fixture(), operation = { id:f.scope.nativeOperationId, wallet:a('2'), chainId:1, plan:{ operationId:f.scope.nativeOperationId, taskPrincipal:f.scope.principal } };
  const scope = { ...f.scope, action:'create', operation, planDigest:digest(operation.plan), requestDigest:digest({ action:'create',operation }) };
  let token;
  await assert.rejects(f.r.withHeld(f.snapshot, f.recheck, 'prepare', () => f.r.withCapability(scope, async value => {
    token = value; await Promise.resolve(); assert.equal(f.r.inHeldGate(), true); throw Error('synthetic timeout');
  })), /synthetic timeout/);
  assert.throws(() => f.r.consume({ ...f.request(token), action:'create', planDigest:scope.planDigest, requestDigest:scope.requestDigest }, 'spiffe://artfi/journal'), /CAPABILITY_REFUSED/);
});

test('stop is permanent even before the first capability is minted', async () => {
 const f=fixture();await f.r.withHeld(f.snapshot,f.recheck,'observe',async()=>{
   f.r.stop();await assert.rejects(f.r.withCapability(f.scope,()=>{}),/STOPPED/);
 });
 await assert.rejects(f.r.withHeld(f.snapshot,f.recheck,'observe',()=>{}),/STOPPED/);
 assert.equal(f.r.inHeldGate(),false);
});
