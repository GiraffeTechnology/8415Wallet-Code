import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTaskJournalCapabilities } from '../server/task-journal-capabilities.mjs';
const h = digit => '0x' + digit.repeat(64), a = digit => '0x' + digit.repeat(40);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const peerId = 'spiffe://wallet.example.invalid/journal', consumer = 'spiffe://artfi.example.invalid/journal';

function fixture() {
  const registry = createTaskJournalCapabilities({ peerId, consumerPeerId: consumer, digest, nativeDigest: digest, now: () => 1000 });
  const snapshot = {
    task: { digest: h('1'), policy: { taskId: 'task:receipt-canonical', actor: a('2'), chainId: '560048', intent: { kind: 'artfi-receipt' } } },
    executor: { digest: h('3') }, grantReference: 'grant:canonical', grantPolicyVersion: '1',
    operationId: 'receipt-funded', child: null,
    scope: { phase: 'funded', nonce: '0', planDigest: h('4'), journalBindingHash: h('5') },
  };
  const principal = { kind: 'task', taskId: snapshot.task.policy.taskId, taskDigest: snapshot.task.digest,
    executorDigest: snapshot.executor.digest, grantReference: snapshot.grantReference,
    grantPolicyVersion: snapshot.grantPolicyVersion, operationId: snapshot.operationId };
  function scope(action = 'get') {
    const { kind, ...binding } = principal, id = 'native_' + digest(binding);
    const operation = action === 'get' ? { id } : { id, wallet: a('2'), chainId: 560048,
      plan: { operationId: id, taskPrincipal: structuredClone(principal), distinctJournalTerms: 'not-the-phase-commitment' } };
    return { peerId, principal: structuredClone(principal), action, nativeOperationId: id,
      planDigest: action === 'get' ? '' : digest(operation.plan),
      requestDigest: digest({ action, operation }), operation };
  }
  function consume(token, request) {
    return registry.consume({ capability: token, peerId, action: request.action,
      nativeOperationId: request.nativeOperationId, planDigest: request.planDigest, requestDigest: request.requestDigest }, consumer);
  }
  return { registry, snapshot, principal, scope, consume };
}

async function refusedBeforeAction(mutate) {
  const f = fixture(); mutate(f.snapshot);
  let entered = false;
  await assert.rejects(f.registry.withHeld(f.snapshot, () => {}, 'observe', async () => { entered = true; }),
    /TASK_JOURNAL_RECEIPT_SCOPE_REFUSED/);
  assert.equal(entered, false, 'bad receipt context must fail before the held action or a token can be issued');
  assert.equal(f.registry.inHeldGate(), false);
}

test('receipt claims preserve all four canonical values including zero and maximum-safe nonce', async () => {
  for (const phase of ['funded', 'registered', 'paid']) for (const nonce of ['0', '9007199254740991']) {
    const f = fixture(); Object.assign(f.snapshot.scope, { phase, nonce });
    const request = f.scope();
    await f.registry.withHeld(f.snapshot, () => {}, 'observe', () => f.registry.withCapability(request, async token => {
      const claim = f.consume(token, request);
      assert.equal(claim.receiptPhase, phase); assert.equal(claim.receiptNonce, nonce);
      assert.equal(claim.receiptPlanDigest, h('4')); assert.equal(claim.receiptJournalBindingHash, h('5'));
      assert.throws(() => f.consume(token, request), /CAPABILITY_REFUSED/);
    }));
  }
});

test('receipt scope refuses absent, numeric, noncanonical or unsafe decimal nonce before an action', async () => {
  for (const nonce of [undefined, null, 0, 0n, -1, '', '00', '01', '+1', '-1', '1.0', '1e3', '9007199254740992', '9'.repeat(78)])
    await refusedBeforeAction(snapshot => { snapshot.scope.nonce = nonce; });
});

test('receipt scope refuses unknown or absent phases without downgrading to listing', async () => {
  for (const phase of [undefined, null, 0, '', 'Funded', 'listing', 'paid '])
    await refusedBeforeAction(snapshot => { snapshot.scope.phase = phase; });
});

test('both receipt commitments must be nonzero lowercase 32-byte hashes', async () => {
  for (const field of ['planDigest', 'journalBindingHash'])
    for (const value of [undefined, null, '', h('0'), h('A'), '0X' + '1'.repeat(64), '0x' + '1'.repeat(63), '0x' + '1'.repeat(66)])
      await refusedBeforeAction(snapshot => { snapshot.scope[field] = value; });
});

test('receipt task with missing scope cannot use the listing principal shape', async () => {
  await refusedBeforeAction(snapshot => { delete snapshot.scope; snapshot.operationId = 'listing:' + snapshot.task.digest.slice(2); });
});

test('scope accessors are rejected before cloning without evaluating them', async () => {
  for (const location of ['scope', 'nonce', 'unrelated']) {
    const f = fixture(); let reads = 0, entered = false;
    if (location === 'scope') Object.defineProperty(f.snapshot, 'scope', { enumerable: true, get() { reads++; return {}; } });
    else Object.defineProperty(f.snapshot.scope, location, { enumerable: true, get() { reads++; return '0'; } });
    await assert.rejects(f.registry.withHeld(f.snapshot, () => {}, 'observe', async () => { entered = true; }),
      /TASK_JOURNAL_RECEIPT_SCOPE_REFUSED/);
    assert.equal(reads, 0); assert.equal(entered, false);
  }
});

test('receipt scope cannot be combined with a listing child or non-plain object', async () => {
  await refusedBeforeAction(snapshot => { snapshot.child = { child: { operationId: snapshot.operationId } }; });
  await refusedBeforeAction(snapshot => { snapshot.scope = null; });
  await refusedBeforeAction(snapshot => { snapshot.scope = Object.assign(Object.create({ inherited: true }), snapshot.scope); });
  await refusedBeforeAction(snapshot => { snapshot.scope[Symbol('hidden')] = 'unexpected'; });
});

test('phase commitment and post-grant journal plan digest stay independent and immutable across awaits', async () => {
  const f = fixture(), expected = structuredClone(f.snapshot.scope), request = f.scope('create');
  assert.notEqual(request.planDigest, expected.planDigest.slice(2), 'a phase commitment is not a native journal plan digest');
  await f.registry.withHeld(f.snapshot, () => {}, 'prepare', async () => {
    Object.assign(f.snapshot.scope, { phase: 'paid', nonce: '8', planDigest: h('8'), journalBindingHash: h('9') });
    await Promise.resolve();
    await f.registry.withCapability(request, async token => {
      const claim = f.consume(token, request);
      assert.equal(claim.receiptPhase, expected.phase); assert.equal(claim.receiptNonce, expected.nonce);
      assert.equal(claim.receiptPlanDigest, expected.planDigest); assert.equal(claim.receiptJournalBindingHash, expected.journalBindingHash);
      assert.equal(claim.planDigest, request.planDigest);
    });
  });
});

test('valid listing snapshots retain their original claim shape and have no receipt fields', async () => {
  const f = fixture(); delete f.snapshot.scope;
  f.snapshot.task.policy.intent = { kind: 'nft-sale' };
  f.principal.operationId = 'listing:' + f.snapshot.task.digest.slice(2);
  const request = f.scope();
  await f.registry.withHeld(f.snapshot, () => {}, 'observe', () => f.registry.withCapability(request, async token => {
    const claim = f.consume(token, request);
    assert.deepEqual(claim.principal, f.principal);
    for (const name of ['receiptPhase', 'receiptNonce', 'receiptPlanDigest', 'receiptJournalBindingHash'])
      assert.equal(Object.hasOwn(claim, name), false);
  }));
});
