/** Ephemeral one-use task journal capabilities. Never persisted or logged.
 * Consumption uses only this registry, not the Wallet credential/grant store:
 * the originating journal request is still holding that store's read gate. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, timingSafeEqual } from 'node:crypto';
const exact = (v, keys) => v && Object.getPrototypeOf(v) === Object.prototype &&
  Object.keys(v).sort().join() === [...keys].sort().join();
const fail = (code, status = 403) => { const error = Error(code); error.status = status; throw error; };
const check = (ok, code = 'TASK_JOURNAL_CAPABILITY_REFUSED', status = 403) => { if (!ok) fail(code, status); };
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const bindingKeys = ['taskId', 'taskDigest', 'executorDigest', 'grantReference', 'grantPolicyVersion', 'operationId'];
const scopeKeys = ['peerId', 'principal', 'action', 'nativeOperationId', 'planDigest', 'requestDigest', 'operation'];
const consumeKeys = ['capability', 'peerId', 'action', 'nativeOperationId', 'planDigest', 'requestDigest'];
export const TASK_JOURNAL_CAPABILITY_PATH = '/internal/v1/task-journal-capabilities/consume';

export function createTaskJournalCapabilities({ peerId, consumerPeerId, digest, nativeDigest, ttlMs = 10000, now = Date.now, maximum = 1024 } = {}) {
  check(typeof consumerPeerId === 'string' && /^spiffe:\/\/[A-Za-z0-9._/-]{1,240}$/.test(consumerPeerId) && typeof peerId === 'string' && /^spiffe:\/\/[^\s,]{1,240}$/.test(peerId) && typeof digest === 'function' && typeof nativeDigest === 'function' && typeof now === 'function' &&
    Number.isSafeInteger(ttlMs) && ttlMs >= 1 && ttlMs <= 30000 && Number.isSafeInteger(maximum) && maximum >= 1 && maximum <= 10000,
  'TASK_JOURNAL_CAPABILITY_CONFIG_REFUSED', 500);
  const scopes = new AsyncLocalStorage(), entries = new Map();
  let stopped = false;
  const clock = () => { const value = now(); check(Number.isSafeInteger(value) && value >= 0, 'TASK_JOURNAL_CLOCK_REFUSED', 503); return value; };
  const sweep = time => { for (const [key, value] of entries) if (!value.scope.live || time < value.issuedAtMs || time >= value.expiresAtMs) entries.delete(key); };
  function principal(snapshot, claimed) {
    check(exact(claimed, ['kind', ...bindingKeys]) && claimed.kind === 'task');
    const expected = { taskId: snapshot.task.policy.taskId, taskDigest: snapshot.task.digest, executorDigest: snapshot.executor.digest,
      grantReference: snapshot.grantReference, grantPolicyVersion: snapshot.grantPolicyVersion,
      operationId: snapshot.child?.child.operationId ?? `listing:${snapshot.task.digest.slice(2)}` };
    check(bindingKeys.every(key => same(claimed[key], expected[key])), 'TASK_JOURNAL_PRINCIPAL_REFUSED');
    return structuredClone(claimed);
  }
  async function withHeld(snapshot, recheck, purpose, action) {
    check(!stopped, 'TASK_JOURNAL_CAPABILITY_STOPPED', 503);
    check(typeof recheck === 'function' && typeof action === 'function' && ['prepare', 'review', 'sign', 'publish', 'observe'].includes(purpose), 'TASK_JOURNAL_GATE_REQUIRED', 500);
    check(!scopes.getStore(), 'TASK_JOURNAL_GATE_REENTRY_REFUSED', 500);
    const held = { snapshot: structuredClone(snapshot), recheck, purpose, live: true, keys: new Set() };
    recheck();
    try { return await scopes.run(held, action); }
    finally { held.live = false; for (const key of held.keys) entries.delete(key); held.keys.clear(); }
  }
  async function withCapability(scope, use) {
    check(!stopped, 'TASK_JOURNAL_CAPABILITY_STOPPED', 503);
    const held = scopes.getStore();
    check(held?.live && typeof use === 'function', 'TASK_JOURNAL_GATE_REQUIRED', 503);
    held.recheck();
    check(exact(scope, scopeKeys) && scope.peerId === peerId && ['get', 'create', 'update'].includes(scope.action) &&
      typeof scope.nativeOperationId === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(scope.nativeOperationId) &&
      hash(scope.requestDigest) && (hash(scope.planDigest) || scope.action === 'get' && scope.planDigest === ''), 'TASK_JOURNAL_SCOPE_REFUSED');
    const p = principal(held.snapshot, scope.principal), operation = structuredClone(scope.operation);
    const binding = Object.fromEntries(bindingKeys.map(key => [key, p[key]]));
    check(scope.nativeOperationId === `native_${nativeDigest(binding)}` &&
      (!held.snapshot.child || held.snapshot.child.child.nativeOperationId === scope.nativeOperationId), 'TASK_JOURNAL_NATIVE_OPERATION_REFUSED');
    check(operation?.id === scope.nativeOperationId && digest({ action: scope.action, operation }) === scope.requestDigest &&
      (scope.action === 'get' ? scope.planDigest === '' && exact(operation, ['id']) : digest(operation.plan) === scope.planDigest), 'TASK_JOURNAL_REQUEST_BINDING_REFUSED');
    check(scope.action !== 'create' || held.purpose === 'prepare', 'TASK_JOURNAL_ACTION_REFUSED');
    check(scope.action !== 'update' || ['review', 'publish', 'observe'].includes(held.purpose), 'TASK_JOURNAL_ACTION_REFUSED');
    if (scope.action !== 'get') {
      check(operation.plan?.operationId === operation.id && digest(operation.plan.taskPrincipal) === digest(p) &&
        (!held.snapshot.child || operation.plan.id === held.snapshot.child.child.nativePlanId && nativeDigest(operation.plan) === held.snapshot.child.child.reviewDigest) &&
        String(operation.chainId) === held.snapshot.task.policy.chainId &&
        operation.wallet?.toLowerCase() === held.snapshot.task.policy.actor.toLowerCase(), 'TASK_JOURNAL_PLAN_BINDING_REFUSED');
    }
    const issuedAtMs = clock(); sweep(issuedAtMs);
    check(entries.size < maximum, 'TASK_JOURNAL_CAPABILITY_BUSY', 503);
    const capability = randomBytes(32).toString('base64url');
    const claim = Object.freeze({ principal: p, wallet: held.snapshot.task.policy.actor, chainId: Number(held.snapshot.task.policy.chainId),
      action: scope.action, nativeOperationId: scope.nativeOperationId, planDigest: scope.planDigest,
      requestDigest: scope.requestDigest, issuedAtMs, expiresAtMs: issuedAtMs + ttlMs, peerId });
    entries.set(capability, { ...claim, scope: held }); held.keys.add(capability);
    try { held.recheck(); return await use(capability); }
    finally { entries.delete(capability); held.keys.delete(capability); }
  }
  function consume(request, authenticatedPeerId) {
    check(!stopped, 'TASK_JOURNAL_CAPABILITY_STOPPED', 503);
    check(authenticatedPeerId === consumerPeerId, 'TASK_JOURNAL_PEER_REFUSED', 401);
    check(exact(request, consumeKeys) && typeof request.capability === 'string' && /^[A-Za-z0-9_-]{43}$/.test(request.capability));
    const time = clock(); sweep(time);
    const found = entries.get(request.capability); entries.delete(request.capability);
    check(found?.scope.live && time >= found.issuedAtMs && time < found.expiresAtMs);
    // A mismatched authenticated request burns the token as well. No retry can
    // change the requested operation, plan, action or calling peer.
    check(['peerId', 'action', 'nativeOperationId', 'planDigest', 'requestDigest'].every(key => same(request[key], found[key])));
    found.scope.recheck();
    const { scope, ...claim } = found; return structuredClone(claim);
  }
  return Object.freeze({ withHeld, withCapability, consume, inHeldGate: () => !stopped && scopes.getStore()?.live === true,
    stop() { stopped = true; for (const entry of entries.values()) entry.scope.live = false; entries.clear(); } });
}
