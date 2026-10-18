/** Shared durable policy parser only. No human-factor services or write capability. */
import { digest } from './crypto.mjs';
export const SCHEMA = '8415-task-human-verification/1';
export const CURRENT_SCHEMA = '8415-task-human-verification/2';
const REVISION = /^(0|[1-9][0-9]{0,77})$/;
export class TaskVerificationPolicyError extends Error {
  constructor(code = 'TASK_VERIFICATION_POLICY_REFUSED', status = 403) { super(code); this.status = status; }
}
const check = (ok, code = 'TASK_VERIFICATION_POLICY_REFUSED', status = 403) => {
  if (!ok) throw new TaskVerificationPolicyError(code, status);
};
export function fields(value, allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'TASK_VERIFICATION_INPUT_REFUSED', 400);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && allowed.includes(key) &&
    Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable),
  'TASK_VERIFICATION_INPUT_REFUSED', 400);
}
export function revision(value) {
  check(typeof value === 'string' && REVISION.test(value) && BigInt(value) < 1n << 256n,
    'TASK_VERIFICATION_REVISION_REFUSED', 409);
  return value;
}
// Invalid caller origin is a stable contract refusal, not an internal URL exception.
const canonicalOrigin = value => {
  if (typeof value !== 'string') return false;
  try { return new URL(value).origin === value; } catch { return false; }
};
export function scope(input) {
  fields(input, ['origin', 'tenant', 'username', 'account', 'chainId', 'agentId']);
  check(canonicalOrigin(input.origin) &&
    typeof input.tenant === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(input.tenant) &&
    typeof input.username === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(input.username) &&
    !['__proto__', 'constructor', 'prototype'].includes(input.username) &&
    typeof input.account === 'string' && /^0x[0-9a-f]{40}$/.test(input.account) && !/^0x0+$/.test(input.account) &&
    typeof input.chainId === 'string' && /^[1-9][0-9]{0,77}$/.test(input.chainId) && BigInt(input.chainId) < 1n << 256n &&
    typeof input.agentId === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(input.agentId),
  'TASK_VERIFICATION_SCOPE_REFUSED', 400);
  return Object.freeze({ origin: input.origin, tenant: input.tenant, username: input.username,
    account: input.account, chainId: input.chainId, agentId: input.agentId });
}
export function taskVerificationPolicyKey(input) {
  return `@task-human-verification:${digest(JSON.stringify(scope(input)))}`;
}
export function readTaskVerificationPolicy(raw, input) {
  const expected = scope(input), scopeDigest = digest(JSON.stringify(expected));
  if (raw === null) return { schema: SCHEMA, scope: expected, mode: 'ON', revision: '0', changes: [] };
  fields(raw, ['schema', 'scope', 'mode', 'revision', 'changes', 'enforcedFromRevision']);
  check([SCHEMA, CURRENT_SCHEMA].includes(raw.schema) && JSON.stringify(scope(raw.scope)) === JSON.stringify(expected) &&
    ['ON', 'OFF'].includes(raw.mode) && Array.isArray(raw.changes) && raw.changes.length > 0,
  'TASK_VERIFICATION_STATE_REFUSED', 503);
  revision(raw.revision);
  // Preserve genuine old ledgers, but never permit a session-only ON at or
  // after the first newly enforced save. Migration changes no existing grant.
  const enforcedFrom = raw.schema === CURRENT_SCHEMA ? revision(raw.enforcedFromRevision) : null;
  check(enforcedFrom === null ? raw.enforcedFromRevision === undefined :
    BigInt(enforcedFrom) > 0n && BigInt(enforcedFrom) <= BigInt(raw.revision), 'TASK_VERIFICATION_STATE_REFUSED', 503);
  let prior = '0';
  for (const entry of raw.changes) {
    fields(entry, ['revision', 'previousRevision', 'mode', 'changeId', 'changeDigest', 'scopeDigest',
      'credentialRevision', 'verifiedFactors', 'changedAt']);
    check(entry.previousRevision === prior && revision(entry.revision) === (BigInt(prior) + 1n).toString() &&
      ['ON', 'OFF'].includes(entry.mode) && typeof entry.changeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(entry.changeId) &&
      typeof entry.changeDigest === 'string' && /^[a-f0-9]{64}$/.test(entry.changeDigest) && entry.scopeDigest === scopeDigest &&
      Number.isSafeInteger(entry.credentialRevision) && entry.credentialRevision >= 0 &&
      Number.isSafeInteger(entry.changedAt) && entry.changedAt >= 0 && Array.isArray(entry.verifiedFactors) &&
      (entry.mode === 'OFF' || enforcedFrom !== null && BigInt(entry.revision) >= BigInt(enforcedFrom) ? entry.verifiedFactors.length === 2 && ['password', 'wallet'].includes(entry.verifiedFactors[0]) &&
        entry.verifiedFactors[1] === 'verified-email' : entry.verifiedFactors.length === 0),
    'TASK_VERIFICATION_STATE_REFUSED', 503);
    prior = entry.revision;
  }
  check(prior === raw.revision && raw.changes.at(-1).mode === raw.mode, 'TASK_VERIFICATION_STATE_REFUSED', 503);
  return structuredClone(raw);
}
/** The credential record is already selected by every execution/receipt gate.
 * Keep policy in that SAME authoritative encrypted record, not a side index
 * fetched before the grant lock. Credential revision is deliberately unchanged.
 * The policy key is a scoped member name, never an independent store replica. */
export function readCredentialTaskVerificationPolicy(credential, input) {
  // The authoritative store uses null for an absent credential record. The
  // caller still validates the configured principal and active bounded grant.
  // A thrown read, undefined result, or explicit null policy member is not this.
  if (credential === null) return readTaskVerificationPolicy(null, input);
  check(credential && typeof credential === 'object' && !Array.isArray(credential) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(credential)), 'TASK_VERIFICATION_STATE_REFUSED', 503);
  const member = Object.getOwnPropertyDescriptor(credential, 'taskVerificationPolicies');
  check(member === undefined || Object.hasOwn(member, 'value') && member.enumerable,
    'TASK_VERIFICATION_STATE_REFUSED', 503);
  const key = taskVerificationPolicyKey(input);
  if (member === undefined) return readTaskVerificationPolicy(null, input);
  const policies = member.value;
  check(policies && typeof policies === 'object' && !Array.isArray(policies) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(policies)), 'TASK_VERIFICATION_STATE_REFUSED', 503);
  const descriptors = Object.getOwnPropertyDescriptors(policies);
  check(Reflect.ownKeys(descriptors).every(name => typeof name === 'string' &&
    /^@task-human-verification:[a-f0-9]{64}$/.test(name) && Object.hasOwn(descriptors[name], 'value') &&
    descriptors[name].enumerable), 'TASK_VERIFICATION_STATE_REFUSED', 503);
  if (!Object.hasOwn(descriptors, key)) return readTaskVerificationPolicy(null, input);
  // Only an absent member is the initial ON default. An explicit null, damaged
  // record or failed store read must never turn an effective owner lock off.
  check(descriptors[key].value !== null && descriptors[key].value !== undefined,
    'TASK_VERIFICATION_STATE_REFUSED', 503);
  return readTaskVerificationPolicy(descriptors[key].value, input);
}
