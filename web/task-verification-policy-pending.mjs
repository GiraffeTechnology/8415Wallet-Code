/** Nonsecret policy-change references retained across a page reload.
 * A reference is not approval, a saved setting, or an execution authorization.
 * Only the authenticated policy service can reconcile its actual outcome.
 */
const SCHEMA = '8415-task-policy-pending-reference/1';
const PREFIX = '8415wallet:task-policy-pending:v1:';
const FIELDS = ['schema', 'scopeKey', 'changeId', 'changeDigest', 'mode', 'previousRevision'];
const HASH = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const fail = code => Object.assign(new Error(code), { code });
const insist = (ok, code = 'TASK_POLICY_PENDING_REFERENCE_REFUSED') => { if (!ok) throw fail(code); };

function scopeKey(value) {
  insist(typeof value === 'string' && HASH.test(value));
  return value;
}
function reference(value) {
  insist(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  insist(Reflect.ownKeys(descriptors).length === FIELDS.length && FIELDS.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable));
  const copy = Object.fromEntries(FIELDS.map(key => [key, descriptors[key].value]));
  insist(copy.schema === SCHEMA && typeof copy.changeId === 'string' && TOKEN.test(copy.changeId) &&
    typeof copy.changeDigest === 'string' && HASH.test(copy.changeDigest) && ['ON', 'OFF'].includes(copy.mode) &&
    typeof copy.previousRevision === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(copy.previousRevision) &&
    BigInt(copy.previousRevision) < (1n << 256n));
  scopeKey(copy.scopeKey);
  return Object.freeze(copy);
}
const same = (left, right) => FIELDS.every(key => left[key] === right[key]);

/** Pass the browser's sessionStorage, not a serialized server response.
 * The caller obtains scopeKey from the strict authenticated wire decoder.
 * Corrupt/unavailable storage never becomes an empty pending state. This module
 * has no endpoint, credential, signing, policy-save or retry capability.
 */
export function createTaskPolicyPendingStore({ storage } = {}) {
  insist(storage && ['getItem', 'setItem', 'removeItem'].every(key => typeof storage[key] === 'function'),
    'TASK_POLICY_PENDING_STORAGE_UNAVAILABLE');
  const keyFor = scope => PREFIX + scopeKey(scope);
  function read(scope) {
    let text;
    try { text = storage.getItem(keyFor(scope)); }
    catch { throw fail('TASK_POLICY_PENDING_STORAGE_UNAVAILABLE'); }
    if (text === null) return null;
    insist(typeof text === 'string' && text.length > 0 && text.length <= 2048);
    let value;
    try { value = JSON.parse(text); } catch { throw fail('TASK_POLICY_PENDING_REFERENCE_REFUSED'); }
    const result = reference(value);
    insist(result.scopeKey === scope);
    return result;
  }
  return Object.freeze({
    read,
    remember(value) {
      const next = reference(value), prior = read(next.scopeKey);
      insist(prior === null || same(prior, next), 'TASK_POLICY_CHANGE_UNRESOLVED');
      if (prior !== null) return prior;
      try { storage.setItem(keyFor(next.scopeKey), JSON.stringify(next)); }
      catch { throw fail('TASK_POLICY_PENDING_STORAGE_UNAVAILABLE'); }
      const saved = read(next.scopeKey);
      insist(saved !== null && same(saved, next), 'TASK_POLICY_PENDING_STORAGE_UNAVAILABLE');
      return saved;
    },
    /** Call only after the source-bound authenticated decoder establishes an
     * outcome for this exact reference. Neither mode equality nor a session-wide
     * cancellation acknowledgement establishes that outcome.
     */
    forget(value) {
      const expected = reference(value), prior = read(expected.scopeKey);
      if (prior === null) return false;
      insist(same(prior, expected), 'TASK_POLICY_CHANGE_UNRESOLVED');
      try { storage.removeItem(keyFor(expected.scopeKey)); }
      catch { throw fail('TASK_POLICY_PENDING_STORAGE_UNAVAILABLE'); }
      insist(read(expected.scopeKey) === null, 'TASK_POLICY_PENDING_STORAGE_UNAVAILABLE');
      return true;
    },
  });
}

export function taskPolicyPendingReference({ scopeKey: scope, changeId, changeDigest, mode, previousRevision }) {
  return reference({ schema: SCHEMA, scopeKey: scope, changeId, changeDigest, mode, previousRevision });
}
