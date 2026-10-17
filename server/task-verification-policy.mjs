/** Owner-controlled human-verification policy. This is not a task grant or signer.
 * PRD 6.3.1: two established factors for OFF, no recurring factor for execution.
 * Integrators must read the policy in the SAME store boundary as the grant and
 * nonce reservation, and again at each not-yet-submitted side effect. */
import { randomBytes, randomInt, createHmac } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { digest, equal, randomToken, verifyPassword } from './crypto.mjs';
import { registrationFor, maskEmail } from './account-directory.mjs';

const LIFE = 5 * 60_000;
const SCHEMA = '8415-task-human-verification/1';
const REVISION = /^(0|[1-9][0-9]{0,77})$/;
export class TaskVerificationPolicyError extends Error {
  constructor(code = 'TASK_VERIFICATION_POLICY_REFUSED', status = 403) { super(code); this.status = status; }
}
const check = (ok, code = 'TASK_VERIFICATION_POLICY_REFUSED', status = 403) => {
  if (!ok) throw new TaskVerificationPolicyError(code, status);
};
function fields(value, allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'TASK_VERIFICATION_INPUT_REFUSED', 400);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && allowed.includes(key) &&
    Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable),
  'TASK_VERIFICATION_INPUT_REFUSED', 400);
}
function revision(value) {
  check(typeof value === 'string' && REVISION.test(value) && BigInt(value) < 1n << 256n,
    'TASK_VERIFICATION_REVISION_REFUSED', 409);
  return value;
}
function scope(input) {
  fields(input, ['origin', 'tenant', 'username', 'account', 'chainId', 'agentId']);
  check(typeof input.origin === 'string' && new URL(input.origin).origin === input.origin &&
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
  fields(raw, ['schema', 'scope', 'mode', 'revision', 'changes']);
  check(raw.schema === SCHEMA && JSON.stringify(scope(raw.scope)) === JSON.stringify(expected) &&
    ['ON', 'OFF'].includes(raw.mode) && Array.isArray(raw.changes) && raw.changes.length > 0,
  'TASK_VERIFICATION_STATE_REFUSED', 503);
  revision(raw.revision);
  let prior = '0';
  for (const entry of raw.changes) {
    fields(entry, ['revision', 'previousRevision', 'mode', 'changeId', 'changeDigest', 'scopeDigest',
      'credentialRevision', 'verifiedFactors', 'changedAt']);
    check(entry.previousRevision === prior && revision(entry.revision) === (BigInt(prior) + 1n).toString() &&
      ['ON', 'OFF'].includes(entry.mode) && typeof entry.changeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(entry.changeId) &&
      typeof entry.changeDigest === 'string' && /^[a-f0-9]{64}$/.test(entry.changeDigest) && entry.scopeDigest === scopeDigest &&
      Number.isSafeInteger(entry.credentialRevision) && entry.credentialRevision >= 0 &&
      Number.isSafeInteger(entry.changedAt) && entry.changedAt >= 0 && Array.isArray(entry.verifiedFactors) &&
      (entry.mode === 'OFF' ? entry.verifiedFactors.length === 2 && ['password', 'wallet'].includes(entry.verifiedFactors[0]) &&
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
  const policies = credential?.taskVerificationPolicies;
  check(policies === undefined || policies && typeof policies === 'object' && !Array.isArray(policies) &&
    Object.keys(policies).every(key => /^@task-human-verification:[a-f0-9]{64}$/.test(key)),
  'TASK_VERIFICATION_STATE_REFUSED', 503);
  const key = taskVerificationPolicyKey(input);
  return readTaskVerificationPolicy(policies && Object.hasOwn(policies, key) ? policies[key] : null, input);
}

/** Factory callbacks are auth-service-owned closures, never HTTP-supplied flags.
 * Password OR registered-wallet control is factor one; OTP to the PREVIOUSLY
 * verified email is factor two. Existing TOTP/recovery are not a third gate.
 * No factor value, signature, bearer proof, or email address enters policy audit. */
export function createTaskVerificationPolicyService({ origin, tenant, agentId, store, users,
  assertSession, credentialFor, passwordFor, methodStates, directory, sendOtp = null, now = Date.now }) {
  check(store && ['readMany', 'transactionMany', 'withReadGate'].every(key => typeof store[key] === 'function') &&
    users instanceof Map && [assertSession, credentialFor, passwordFor, methodStates, now].every(x => typeof x === 'function') &&
    typeof directory?.checkCredential === 'function' && (sendOtp === null || typeof sendOtp === 'function'),
  'TASK_VERIFICATION_CONFIG_REFUSED', 500);
  const slots = new Map(), limits = new Map(), pepper = randomBytes(32);
  let expensive = 0;
  const stamp = () => { const t = now(); check(Number.isSafeInteger(t) && t >= 0, 'TASK_VERIFICATION_CLOCK_REFUSED', 503); return t; };
  const keyed = value => createHmac('sha256', pepper).update(JSON.stringify(value)).digest('hex');
  const scopeFor = session => scope({ origin, tenant, username: session.username,
    account: session.account.toLowerCase(), chainId: session.chainId, agentId });
  const credentialKey = session => `${tenant}:${session.username}`;
  const policyKey = session => taskVerificationPolicyKey(scopeFor(session));
  const readStored = (raw, session) => readTaskVerificationPolicy(raw, scopeFor(session));
  const readCredential = (credential, session) => readCredentialTaskVerificationPolicy(credential, scopeFor(session));
  const withPolicy = (credential, session, next) => ({ ...credential, taskVerificationPolicies: {
    ...(credential?.taskVerificationPolicies ?? {}), [policyKey(session)]: next } });
  function sweep() {
    const time = stamp();
    for (const map of [slots, limits]) for (const [key, value] of map) {
      if (!value.committing && (time < value.issuedAt || time >= value.expiresAt)) map.delete(key);
    }
  }
  function limit(session) {
    sweep(); let entry = limits.get(session.username);
    if (!entry) {
      check(limits.size < 10000, 'TASK_VERIFICATION_BUSY', 503);
      entry = { attempts: 0, issuedAt: stamp(), expiresAt: stamp() + 15 * 60_000 }; limits.set(session.username, entry);
    }
    check(++entry.attempts <= 10, 'TASK_VERIFICATION_RATE_LIMITED', 429);
  }
  function owner(session, credential) {
    assertSession(session);
    const user = users.get(session.username);
    check(user?.wallets.some(wallet => wallet.account.toLowerCase() === session.account.toLowerCase() && wallet.chainId === session.chainId),
      'TASK_VERIFICATION_OWNER_REFUSED');
    check(Number.isSafeInteger(session.revision) && session.revision >= 0 && (credential?.revision ?? 0) === session.revision,
      'TASK_VERIFICATION_CREDENTIAL_CHANGED', 409);
    directory.checkCredential(session.username, credential);
    return user;
  }
  function established(session, credential, method) {
    const user = owner(session, credential), email = registrationFor(credential);
    check(email && sendOtp !== null && ['password', 'wallet'].includes(method) && methodStates(user, credential)[method]?.enabled,
      'TASK_VERIFICATION_TWO_ESTABLISHED_FACTORS_REQUIRED', 409);
    const passwordHash = method === 'password' ? passwordFor(user, credential) : null;
    check(method !== 'password' || typeof passwordHash === 'string', 'TASK_VERIFICATION_TWO_ESTABLISHED_FACTORS_REQUIRED', 409);
    return { email: email.email, fingerprint: keyed([scopeFor(session), session.revision, method, passwordHash,
      user.wallets, methodStates(user, credential), email]), passwordHash };
  }
  function current(session, slot) {
    assertSession(session); sweep();
    check(slot && slots.get(session.id) === slot && slot.sessionId === session.id &&
      slot.scopeDigest === digest(JSON.stringify(scopeFor(session))) && slot.credentialRevision === session.revision &&
      stamp() >= slot.issuedAt && stamp() < slot.expiresAt, 'TASK_VERIFICATION_CHANGE_EXPIRED', 409);
  }
  function unchanged(session, slot, credential) {
    current(session, slot);
    const bound = established(session, credential, slot.method);
    check(equal(bound.fingerprint, slot.factorBinding), 'TASK_VERIFICATION_FACTORS_CHANGED', 409);
    return bound;
  }
  function cancel(session) { slots.delete(session.id); }
  async function status(session) {
    const keys = [credentialKey(session)], values = await store.readMany(keys);
    owner(session, values[keys[0]]);
    const state = readCredential(values[keys[0]], session);
    return { ...state, label: 'Per-operation human verification', appliesTo: 'still-valid-in-scope-authorizations',
      grantsAuthority: false, factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'] };
  }
  async function prepare(session, body) {
    fields(body, ['expectedRevision', 'identityMethod']); revision(body.expectedRevision); limit(session);
    body = { expectedRevision: body.expectedRevision, identityMethod: body.identityMethod };
    const credential = await credentialFor(session), bound = established(session, credential, body.identityMethod);
    const values = await store.readMany([credentialKey(session)]);
    owner(session, values[credentialKey(session)]);
    check(established(session, values[credentialKey(session)], body.identityMethod).fingerprint === bound.fingerprint,
      'TASK_VERIFICATION_FACTORS_CHANGED', 409);
    const state = readCredential(values[credentialKey(session)], session);
    check(state.revision === body.expectedRevision, 'TASK_VERIFICATION_REVISION_CONFLICT', 409);
    sweep(); check(slots.size < 10000 || slots.has(session.id), 'TASK_VERIFICATION_BUSY', 503);
    const request = { schema: '8415-task-human-verification-change/1', scope: scopeFor(session),
      mode: 'OFF', expectedRevision: state.revision, credentialRevision: session.revision,
      changeId: randomToken(), nonce: randomToken(), issuedAt: stamp(), expiresAt: stamp() + LIFE };
    const changeDigest = digest(JSON.stringify(request));
    const message = ['8415wallet owner policy change: Per-operation human verification OFF',
      `Scope: ${JSON.stringify(request.scope)}`, 'Applies only to still-valid, in-scope authorizations; no new task authority.',
      'Preparation, signing, submission, continuation and receipts will not ask again.',
      `Revision: ${request.expectedRevision}`, `Credential revision: ${request.credentialRevision}`,
      `Change: ${request.changeId}`, `Nonce: ${request.nonce}`, `Digest: ${changeDigest}`,
      `Expires at: ${request.expiresAt}`, 'Purpose: policy change only; no login, recovery, or transaction signature.'].join('\n');
    slots.set(session.id, { ...request, scopeDigest: digest(JSON.stringify(request.scope)), changeDigest,
      sessionId: session.id, method: body.identityMethod, factorBinding: bound.fingerprint, message, stage: 'identity', attempts: 0 });
    return { request, changeDigest, identityMethod: body.identityMethod, emailMasked: maskEmail(bound.email),
      ...(body.identityMethod === 'wallet' ? { message } : {}) };
  }
  async function verify(session, body) {
    fields(body, ['changeId', 'changeDigest', 'password', 'signature']); limit(session);
    const input = { ...body }; body.password = ''; body.signature = ''; body = input;
    const slot = slots.get(session.id); current(session, slot);
    check(slot.changeId === body.changeId && slot.changeDigest === body.changeDigest && slot.stage === 'identity');
    slot.stage = 'verifying';
    try {
      const bound = unchanged(session, slot, await credentialFor(session));
      if (slot.method === 'password') {
        check(body.signature === undefined && expensive < 2, 'TASK_VERIFICATION_FACTOR_REFUSED');
        expensive++;
        let valid; try { valid = await verifyPassword(body.password, bound.passwordHash); } finally { expensive--; }
        current(session, slot); check(valid, 'TASK_VERIFICATION_FACTOR_REFUSED');
      } else {
        check(body.password === undefined && typeof body.signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(body.signature),
          'TASK_VERIFICATION_FACTOR_REFUSED');
        let recovered; try { recovered = verifyMessage(slot.message, body.signature); } catch { throw new TaskVerificationPolicyError('TASK_VERIFICATION_FACTOR_REFUSED'); }
        check(recovered.toLowerCase() === session.account.toLowerCase(), 'TASK_VERIFICATION_FACTOR_REFUSED');
      }
      unchanged(session, slot, await credentialFor(session));
      const code = randomInt(100_000_000).toString().padStart(8, '0');
      slot.codeHash = keyed([slot.changeDigest, slot.changeId, code]);
      try {
        await sendOtp({ to: bound.email, code, purpose: 'task-verification-policy-off', expiresAt: slot.expiresAt,
          tenant, origin, changeDigest: slot.changeDigest });
      } catch { throw new TaskVerificationPolicyError('TASK_VERIFICATION_EMAIL_UNAVAILABLE', 503); }
      unchanged(session, slot, await credentialFor(session)); slot.stage = 'email';
      return { changeId: slot.changeId, changeDigest: slot.changeDigest, emailMasked: maskEmail(bound.email), digits: 8, expiresAt: slot.expiresAt };
    } catch (error) { if (slots.get(session.id) === slot) slots.delete(session.id); throw error; }
    finally { body.password = ''; body.signature = ''; }
  }
  async function confirm(session, body) {
    fields(body, ['changeId', 'changeDigest', 'code']); limit(session);
    const slot = slots.get(session.id); current(session, slot);
    check(slot.changeId === body.changeId && slot.changeDigest === body.changeDigest && slot.stage === 'email');
    check(++slot.attempts <= 5 && typeof body.code === 'string' && /^\d{8}$/.test(body.code) &&
      equal(slot.codeHash, keyed([slot.changeDigest, slot.changeId, body.code])), 'TASK_VERIFICATION_FACTOR_REFUSED');
    slot.stage = 'committing'; slot.committing = true;
    try {
      await store.transactionMany([credentialKey(session)], values => {
        unchanged(session, slot, values[credentialKey(session)]);
        const prior = readCredential(values[credentialKey(session)], session);
        check(prior.revision === slot.expectedRevision, 'TASK_VERIFICATION_REVISION_CONFLICT', 409);
        const nextRevision = revision((BigInt(prior.revision) + 1n).toString());
        const next = { ...prior, mode: 'OFF', revision: nextRevision, changes: [...prior.changes, {
          revision: nextRevision, previousRevision: prior.revision, mode: 'OFF', changeId: slot.changeId,
          changeDigest: slot.changeDigest, scopeDigest: slot.scopeDigest, credentialRevision: slot.credentialRevision,
          verifiedFactors: [slot.method, 'verified-email'], changedAt: stamp() }] };
        readStored(next, session);
        return { ...values, [credentialKey(session)]: withPolicy(values[credentialKey(session)], session, next) };
      });
    } finally { if (slots.get(session.id) === slot) slots.delete(session.id); body.code = ''; }
    return status(session);
  }
  async function enable(session, body) {
    fields(body, ['expectedRevision']); revision(body.expectedRevision);
    body = { expectedRevision: body.expectedRevision };
    // Restrictive ON never replays a pending OFF proof or modifies any grant,
    // nonce claim, submitted/UNKNOWN operation, or budget reservation.
    await store.transactionMany([credentialKey(session)], values => {
      owner(session, values[credentialKey(session)]);
      const prior = readCredential(values[credentialKey(session)], session);
      check(prior.revision === body.expectedRevision, 'TASK_VERIFICATION_REVISION_CONFLICT', 409);
      const changeId = randomToken(), nextRevision = revision((BigInt(prior.revision) + 1n).toString());
      const entry = { revision: nextRevision, previousRevision: prior.revision, mode: 'ON', changeId,
        changeDigest: digest(JSON.stringify([SCHEMA, scopeFor(session), 'ON', prior.revision, changeId])),
        scopeDigest: digest(JSON.stringify(scopeFor(session))), credentialRevision: session.revision,
        verifiedFactors: [], changedAt: stamp() };
      const next = { ...prior, mode: 'ON', revision: nextRevision, changes: [...prior.changes, entry] };
      readStored(next, session); return { ...values, [credentialKey(session)]: withPolicy(values[credentialKey(session)], session, next) };
    });
    cancel(session); return status(session);
  }
  return Object.freeze({ status, prepare, verify, confirm, enable, cancel, keyFor: policyKey, readStored, readCredential });
}
