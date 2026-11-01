/** Server-owned realm dispatch. No HTTP field, task payload, alias or evidence
 * supplies the expected realm. Existing realm validators still own authority. */
import { createHash } from 'node:crypto';
import { originContinuationKey, readOriginContinuation, resolveOriginContinuation } from './origin-continuation.mjs';
const fail = () => { throw Error('AUTH_ORIGIN_REALM_REFUSED'); };
const check = ok => { if (!ok) fail(); };
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const grantKey = key => typeof key === 'string' && /^task-grant:[a-f0-9]{64}$/.test(key);
export function createOriginRealmRouter({ store, tenant, transportOrigin, createRealm }) {
  check(store && typeof store.read === 'function' && typeof store.readMany === 'function' && typeof createRealm === 'function');
  const url = new URL(transportOrigin), canonical = url.protocol === 'https:' && url.port === '';
  const reference = canonical ? originContinuationKey({ tenant, transportOrigin }) : null;
  let record = null;
  const realms = new Map();
  const selected = principal => canonical ? resolveOriginContinuation(record, { tenant, transportOrigin,
    username: principal.username, account: principal.account.toLowerCase(), chainId: principal.chainId }).authorizationOrigin : transportOrigin;
  function realm(origin) {
    if (!realms.has(origin)) realms.set(origin, createRealm(origin, principal => check(selected(principal) === origin), principal => {
      check(selected(principal) === origin);
      const resolved = canonical ? resolveOriginContinuation(record, {tenant,transportOrigin,
        username:principal.username,account:principal.account.toLowerCase(),chainId:principal.chainId}) :
        {authorizationOrigin:transportOrigin,continuation:null};
      return Object.freeze({schema:'8415wallet-authorization-context/1',tenant,transportOrigin,
        authorizationOrigin:resolved.authorizationOrigin,username:principal.username,account:principal.account,
        chainId:principal.chainId,continuation:resolved.continuation});
    }));
    return realms.get(origin);
  }
  realm(transportOrigin);
  const ready = (async () => {
    if (reference === null) return;
    const found = await store.read(reference);
    if (found === null) {
      check(store.originTransitionBinding?.().minimumGeneration !== 5);
      return;
    }
    record = readOriginContinuation(found);
    check(originContinuationKey(record) === reference);
    realm(record.authorizationOrigin);
  })();
  // Preserve rejection for all callers without an unhandled startup promise.
  ready.catch(() => {});
  async function stable() {
    await ready;
    if (reference === null) return;
    const current = await store.read(reference);
    check(record === null ? current === null : current !== null && readOriginContinuation(current).digest === record.digest);
  }
  async function queues() {
    await stable();
    const keys = [...realms.keys()].map(origin => 'task-queue:' + sha([origin, tenant]));
    const snapshot = await store.readMany(keys), all = [];
    for (const key of keys) {
      const queue = snapshot[key]; if (queue === null) continue;
      check(queue.schema === '8415-task-queue/1' && Array.isArray(queue.entries) && queue.entries.every(grantKey));
      all.push(...queue.entries);
    }
    check(new Set(all).size === all.length); return all;
  }
  async function forStoredGrant(entry) {
    check(grantKey(entry)); const entries = await queues(); check(entries.includes(entry));
    const raw = await store.read(entry); let principal;
    try { principal = JSON.parse(raw?.principal); } catch { fail(); }
    check(Array.isArray(principal) && principal.length === 5 && principal[1] === tenant &&
      principal.slice(2).every(value => typeof value === 'string'));
    const identity = { username: principal[2], account: principal[3], chainId: principal[4] };
    check(selected(identity) === principal[0]);
    return realm(principal[0]);
  }
  async function forClaim(claimed) {
    check(claimed && typeof claimed.taskDigest === 'string' && typeof claimed.grantReference === 'string');
    const entries = await queues(); check(entries.length > 0);
    const records = await store.readMany(entries);
    const matches = entries.filter(entry => records[entry]?.task?.digest === claimed.taskDigest && records[entry]?.reference === claimed.grantReference);
    check(matches.length === 1); return forStoredGrant(matches[0]);
  }
  const canonicalRealm = realm(transportOrigin);
  function port(name) {
    const sample = canonicalRealm.taskService[name];
    return Object.freeze(Object.fromEntries(Object.keys(sample).map(method => [method,
      method === 'assertIndependentStore' ? candidate => sample[method](candidate) :
      async (...args) => (await forClaim(name==='receiptPrincipalAuthorization'?args[0]?.task:args[0])).taskService[name][method](...args)])));
  }
  return Object.freeze({ ready, canonicalRealm,
    async forSession(session) { await stable(); return realm(selected(session)); },
    cancel(session) { for (const value of realms.values()) {
      value.taskService.cancel(session); value.verificationPolicyService?.cancel(session); value.assetControlService?.cancel(session);
    } },
    background: Object.freeze({
      async list({ cursor = '0', limit = 10 } = {}) {
        check(typeof cursor === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(cursor) && Number.isSafeInteger(Number(cursor)) &&
          Number.isSafeInteger(limit) && limit >= 1 && limit <= 50);
        const all = await queues(), offset = Number(cursor); check(offset <= all.length);
        const entries = all.slice(offset, offset + limit);
        return { entries, nextCursor: offset + entries.length < all.length ? String(offset + entries.length) : null };
      },
      async resume(entry) { return (await forStoredGrant(entry)).taskService.background.resume(entry); }
    }), receiptPrincipalAuthorization: port('receiptPrincipalAuthorization'), receiptAuthorization: port('receiptAuthorization'), listingAuthorization: port('listingAuthorization') });
}
