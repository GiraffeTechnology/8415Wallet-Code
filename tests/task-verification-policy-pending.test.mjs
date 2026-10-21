import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPolicyPendingStore, taskPolicyPendingReference } from '../web/task-verification-policy-pending.mjs';

const scope = '1'.repeat(64), otherScope = '2'.repeat(64);
const ref = (overrides = {}) => taskPolicyPendingReference({ scopeKey: scope, changeId: 'c'.repeat(43),
  changeDigest: 'd'.repeat(64), mode: 'OFF', previousRevision: '9007199254740993', ...overrides });
function storage() {
  const values = new Map(), writes = [];
  return { values, writes, getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes.push(['set', key, value]); values.set(key, value); },
    removeItem(key) { writes.push(['remove', key]); values.delete(key); } };
}

test('pending reference survives a new bridge instance without changing its revision', () => {
  const port = storage(), a = createTaskPolicyPendingStore({ storage: port }), pending = ref();
  assert.equal(a.read(scope), null); assert.deepEqual(a.remember(pending), pending);
  const restored = createTaskPolicyPendingStore({ storage: port }).read(scope);
  assert.deepEqual(restored, pending); assert.ok(Object.isFrozen(restored));
  assert.equal(restored.previousRevision, '9007199254740993');
});
test('scope-specific references do not expose or remove another account, agent or chain context', () => {
  const port = storage(), bridge = createTaskPolicyPendingStore({ storage: port });
  bridge.remember(ref()); assert.equal(bridge.read(otherScope), null);
  assert.equal(bridge.forget(ref({ scopeKey: otherScope })), false);
  assert.deepEqual(bridge.read(scope), ref());
});
test('same reference is idempotent but a different unresolved change cannot replace it', () => {
  const port = storage(), bridge = createTaskPolicyPendingStore({ storage: port });
  bridge.remember(ref()); bridge.remember(ref()); assert.equal(port.writes.length, 1);
  assert.throws(() => bridge.remember(ref({ changeId: 'x'.repeat(43) })), /CHANGE_UNRESOLVED/);
  assert.deepEqual(bridge.read(scope), ref());
});
test('forget is exact-reference-qualified, not just mode or revision qualified', () => {
  const port = storage(), bridge = createTaskPolicyPendingStore({ storage: port }); bridge.remember(ref());
  for (const update of [{ changeId: 'x'.repeat(43) }, { changeDigest: 'e'.repeat(64) }, { mode: 'ON' }, { previousRevision: '0' }]) {
    assert.throws(() => bridge.forget(ref(update)), /CHANGE_UNRESOLVED/);
    assert.deepEqual(bridge.read(scope), ref());
  }
  assert.equal(bridge.forget(ref()), true); assert.equal(bridge.read(scope), null);
  assert.equal(bridge.forget(ref()), false);
});
test('unknown schemas, extra fields and getter references are refused without evaluating getters', () => {
  const port = storage(), bridge = createTaskPolicyPendingStore({ storage: port }), pending = ref();
  let reads = 0;
  const getter = { ...pending }; Object.defineProperty(getter, 'changeId', { enumerable: true, get() { reads++; return pending.changeId; } });
  for (const bad of [{ ...pending, schema: 'future' }, { ...pending, approved: true }, getter]) {
    assert.throws(() => bridge.remember(bad), /REFERENCE_REFUSED/);
  }
  assert.equal(reads, 0); assert.equal(port.writes.length, 0);
});
test('canonical lossless revision, token, digest and scope shapes are required', () => {
  for (const update of [{ previousRevision: 1 }, { previousRevision: '01' }, { previousRevision: '-1' },
    { previousRevision: (1n << 256n).toString() }, { changeId: 'short' }, { changeDigest: 'D'.repeat(64) },
    { scopeKey: 'not-a-digest' }, { mode: 'true' }]) assert.throws(() => ref(update), /REFERENCE_REFUSED/);
});
test('malformed or cross-scope stored data is never treated as empty or silently erased', () => {
  const port = storage(), bridge = createTaskPolicyPendingStore({ storage: port }); bridge.remember(ref());
  const key = [...port.values.keys()][0];
  for (const text of ['{', '{}', 'null', JSON.stringify({ ...ref(), scopeKey: otherScope }), ' '.repeat(2049)]) {
    port.values.set(key, text); assert.throws(() => bridge.read(scope), /REFERENCE_REFUSED/);
    assert.equal(port.values.get(key), text);
  }
  assert.equal(port.writes.length, 1);
});
test('unavailable reads and failed writes do not report a saved pending marker', () => {
  const broken = { getItem() { throw Error('unavailable'); }, setItem() {}, removeItem() {} };
  assert.throws(() => createTaskPolicyPendingStore({ storage: broken }).read(scope), /STORAGE_UNAVAILABLE/);
  const dropped = storage(); dropped.setItem = () => {};
  assert.throws(() => createTaskPolicyPendingStore({ storage: dropped }).remember(ref()), /STORAGE_UNAVAILABLE/);
});
test('failed or ineffective removal preserves an unresolved marker', () => {
  const port = storage(), bridge = createTaskPolicyPendingStore({ storage: port }); bridge.remember(ref());
  port.removeItem = () => {};
  assert.throws(() => bridge.forget(ref()), /STORAGE_UNAVAILABLE/);
  assert.deepEqual(bridge.read(scope), ref());
});
test('storage contains only the bounded reference, never credentials or an authority assertion', () => {
  const port = storage(), bridge = createTaskPolicyPendingStore({ storage: port }); bridge.remember(ref());
  const raw = JSON.parse([...port.values.values()][0]);
  assert.deepEqual(Object.keys(raw), ['schema', 'scopeKey', 'changeId', 'changeDigest', 'mode', 'previousRevision']);
  for (const field of ['password', 'code', 'csrf', 'session', 'signature', 'approved', 'grantsAuthority']) assert.equal(field in raw, false);
});
