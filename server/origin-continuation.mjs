/** Exact origin-continuation metadata codec. This is not a grant or a public
 * decoder: records must come from the original authenticated encrypted store.
 * Preserve legacy authority realms; never rewrite signed tasks or policy audit. */
import { createHash } from 'node:crypto';
const SCHEMA = '8415wallet-origin-continuation/1';
const fail = () => { throw Error('AUTH_ORIGIN_CONTINUATION_REFUSED'); };
const check = ok => { if (!ok) fail(); };
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) && !/^0+$/.test(v);
const decimal = v => typeof v === 'string' && /^[1-9][0-9]{0,77}$/.test(v) && BigInt(v) < 1n << 256n;
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function exact(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const d = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(d).length === keys.length && keys.every(k => d[k] && Object.hasOwn(d[k], 'value') && d[k].enumerable));
}
function origin(value) {
  let url; try { url = new URL(value); } catch { fail(); }
  check(typeof value === 'string' && url.protocol === 'https:' && url.origin === value); return url;
}
function tenant(value) { check(typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)); return value; }
function principal(value) {
  exact(value, ['username', 'account', 'chainId']);
  check(typeof value.username === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value.username) &&
    !['__proto__', 'constructor', 'prototype'].includes(value.username) &&
    typeof value.account === 'string' && /^0x[0-9a-f]{40}$/.test(value.account) && !/^0x0+$/.test(value.account) && decimal(value.chainId));
  return Object.freeze({ username: value.username, account: value.account, chainId: value.chainId });
}
const tuple = p => JSON.stringify([p.username, p.account, p.chainId]);
function body(value) {
  const from = origin(value.authorizationOrigin), to = origin(value.transportOrigin);
  check(from.hostname === to.hostname && to.port === '' && value.authorizationOrigin !== value.transportOrigin &&
    value.schema === SCHEMA && decimal(value.revision) && hash(value.priorStateSha256) && hash(value.contractDigest));
  tenant(value.tenant);
  check(Array.isArray(value.principals) && value.principals.length > 0 && value.principals.length <= 4096);
  const descriptors = Object.getOwnPropertyDescriptors(value.principals);
  check(Reflect.ownKeys(descriptors).length === value.principals.length + 1);
  const principals = Array.from({ length: value.principals.length }, (_, i) => {
    const d = descriptors[String(i)]; check(d && Object.hasOwn(d, 'value') && d.enumerable); return principal(d.value);
  });
  for (let i = 1; i < principals.length; i++) check(tuple(principals[i - 1]) < tuple(principals[i]));
  return { schema: SCHEMA, tenant: value.tenant, authorizationOrigin: value.authorizationOrigin,
    transportOrigin: value.transportOrigin, revision: value.revision, priorStateSha256: value.priorStateSha256,
    contractDigest: value.contractDigest, principals: Object.freeze(principals) };
}
const BODY_KEYS = ['schema', 'tenant', 'authorizationOrigin', 'transportOrigin', 'revision', 'priorStateSha256', 'contractDigest', 'principals'];
export function createOriginContinuation(value) {
  exact(value, BODY_KEYS); const normalized = body(value);
  return Object.freeze({ ...normalized, digest: digest(normalized) });
}
export function readOriginContinuation(value) {
  exact(value, [...BODY_KEYS, 'digest']); const normalized = body(value);
  check(hash(value.digest) && value.digest === digest(normalized));
  return Object.freeze({ ...normalized, digest: value.digest });
}
export function originContinuationKey({ tenant: selectedTenant, transportOrigin }) {
  tenant(selectedTenant); check(origin(transportOrigin).port === '');
  return '@origin-continuation:' + digest([selectedTenant, transportOrigin]);
}
/** Called only with independently authenticated session identity and a trusted
 * store record. HTTP task/evidence bodies cannot select this mapping. */
export function resolveOriginContinuation(value, input) {
  exact(input, ['tenant', 'transportOrigin', 'username', 'account', 'chainId']);
  tenant(input.tenant); check(origin(input.transportOrigin).port === '');
  const selected = principal({ username: input.username, account: input.account, chainId: input.chainId });
  if (value === null) return Object.freeze({ authorizationOrigin: input.transportOrigin, continuation: null });
  const record = readOriginContinuation(value);
  check(record.tenant === input.tenant && record.transportOrigin === input.transportOrigin);
  if (!record.principals.some(p => tuple(p) === tuple(selected)))
    return Object.freeze({ authorizationOrigin: input.transportOrigin, continuation: null });
  return Object.freeze({ authorizationOrigin: record.authorizationOrigin,
    continuation: Object.freeze({ reference: originContinuationKey(record), digest: record.digest, revision: record.revision }) });
}
