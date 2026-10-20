/** Human-only exact-change service. Execution uses the separate read-only parser. */
import { randomBytes, randomInt, createHmac } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { digest, equal, randomToken, verifyPassword } from './crypto.mjs';
import { registrationFor, maskEmail } from './account-directory.mjs';
import { TaskVerificationPolicyError, SCHEMA, CURRENT_SCHEMA, fields, revision, scope,
  taskVerificationPolicyKey, readTaskVerificationPolicy, readCredentialTaskVerificationPolicy } from './task-verification-state.mjs';
export { TaskVerificationPolicyError, taskVerificationPolicyKey,
  readTaskVerificationPolicy, readCredentialTaskVerificationPolicy } from './task-verification-state.mjs';
const check = (ok, code = 'TASK_VERIFICATION_POLICY_REFUSED', status = 403) => {
  if (!ok) throw new TaskVerificationPolicyError(code, status);
};
const LIFE = 5 * 60_000;
const CHANGE_PROTOCOL = '8415-task-policy-change-wire/1';
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
  const slots = new Map(), limits = new Map(), outcomes = new Map(), pepper = randomBytes(32);
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
  const changeMatches = (value, reference) => value && value.changeId === reference.changeId &&
    value.changeDigest === reference.changeDigest && value.expectedRevision === reference.expectedRevision;
  const outcomeKey = (session, reference) => digest(JSON.stringify([scopeFor(session), reference.changeId,
    reference.changeDigest, reference.expectedRevision]));
  function changeReference(body) {
    fields(body, ['protocol', 'changeId', 'changeDigest', 'expectedRevision']);
    check(body.protocol === CHANGE_PROTOCOL && typeof body.changeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.changeId) &&
      typeof body.changeDigest === 'string' && /^[a-f0-9]{64}$/.test(body.changeDigest), 'TASK_VERIFICATION_INPUT_REFUSED', 400);
    revision(body.expectedRevision);
    return { changeId: body.changeId, changeDigest: body.changeDigest, expectedRevision: body.expectedRevision };
  }
  function remember(session, slot, reason) {
    // Transient negative evidence is never an owner policy or execution grant.
    // After restart, its absence is UNKNOWN, not proof that a save failed.
    if (outcomes.size >= 10000) outcomes.delete(outcomes.keys().next().value);
    outcomes.set(outcomeKey(session, slot), { reason, issuedAt: stamp(), expiresAt: stamp() + LIFE });
  }
  function sweep() {
    const time = stamp();
    for (const map of [slots, limits, outcomes]) for (const [key, value] of map) {
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
  // Trusted auth-service revocation cleanup only. HTTP cancellation is qualified
  // below and cannot invoke this session-wide method. Never abandon a commit.
  function cancel(session) {
    const slot = slots.get(session.id);
    if (slot && !slot.committing) { slots.delete(session.id); remember(session, slot, 'cancelled'); }
  }
  async function status(session, body = {}) {
    fields(body, ['protocol', 'changeId', 'changeDigest', 'expectedRevision']);
    const versioned = Object.keys(body).length > 0;
    const discovery = Object.keys(body).length === 1 && body.protocol === CHANGE_PROTOCOL;
    const reference = versioned && !discovery ? changeReference(body) : null;
    const keys = [credentialKey(session)], values = await store.readMany(keys);
    owner(session, values[keys[0]]);
    const state = readCredential(values[keys[0]], session);
    sweep();
    const selectedScope = digest(JSON.stringify(scopeFor(session)));
    const visible = slot => slot && slot.scopeDigest === selectedScope && slot.credentialRevision === session.revision &&
      slot.expectedRevision === state.revision;
    const own = slots.get(session.id);
    const pendingChange = visible(own) ? { changeId: own.changeId, changeDigest: own.changeDigest,
      expectedRevision: own.expectedRevision, mode: own.mode, stage: own.stage,
      issuedAt: own.issuedAt, expiresAt: own.expiresAt } : null;
    let reconciliation = null;
    if (reference) {
      // Search the complete authoritative audit, not only its latest change.
      const committed = state.changes.find(change => change.changeId === reference.changeId &&
        change.changeDigest === reference.changeDigest && change.previousRevision === reference.expectedRevision);
      const pending = [...slots.values()].find(slot => visible(slot) && changeMatches(slot, reference));
      const negative = outcomes.get(outcomeKey(session, reference));
      reconciliation = { ...reference, state: 'unknown', reason: 'unresolved', automaticRetryAllowed: false, committedChange: null };
      if (committed) reconciliation = { ...reconciliation, state: 'committed', reason: null, committedChange: structuredClone(committed) };
      else if (BigInt(state.revision) > BigInt(reference.expectedRevision)) reconciliation = {
        ...reconciliation, state: 'not-committed', reason: 'revision-superseded' };
      else if (pending) reconciliation = { ...reconciliation, state: pending.committing ? 'committing' : 'pending', reason: null };
      else if (negative) reconciliation = { ...reconciliation, state: 'not-committed', reason: negative.reason };
    }
    const legacy = { ...state, label: 'Per-operation human verification', appliesTo: 'still-valid-in-scope-authorizations',
      grantsAuthority: false, factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
      factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'] };
    // Existing strict browser decoders retain their original exact response.
    // A versioned discovery or qualified enquiry explicitly selects new keys.
    return versioned ? { ...legacy, changeProtocol: CHANGE_PROTOCOL, pendingChange, reconciliation } : legacy;
  }
  async function cancelChange(session, body) {
    const reference = changeReference(body);
    const observed = await status(session, body);
    const slot = slots.get(session.id);
    if (observed.reconciliation.state === 'committed' || !changeMatches(slot, reference) || slot.committing)
      return { changeProtocol: CHANGE_PROTOCOL, cancelled: false, reconciliation: observed.reconciliation };
    // No await between the exact-slot comparison and deletion. A stale tab can
    // neither cancel a replacement draft nor undo a save already committing.
    slots.delete(session.id); remember(session, slot, 'cancelled');
    return { changeProtocol: CHANGE_PROTOCOL, cancelled: true,
      reconciliation: { ...reference, state: 'not-committed', reason: 'cancelled', automaticRetryAllowed: false, committedChange: null } };
  }
  async function prepare(session, body) {
    fields(body, ['expectedRevision', 'identityMethod', 'mode', 'protocol']); revision(body.expectedRevision); limit(session);
    const versioned = body.protocol !== undefined;
    check(!versioned || body.protocol === CHANGE_PROTOCOL, 'TASK_VERIFICATION_INPUT_REFUSED', 400);
    check(body.mode === undefined || ['ON', 'OFF'].includes(body.mode), 'TASK_VERIFICATION_INPUT_REFUSED', 400);
    body = { expectedRevision: body.expectedRevision, identityMethod: body.identityMethod, mode: body.mode ?? 'OFF' };
    check(!slots.get(session.id)?.committing, 'TASK_VERIFICATION_CHANGE_IN_PROGRESS', 409);
    const credential = await credentialFor(session), bound = established(session, credential, body.identityMethod);
    const values = await store.readMany([credentialKey(session)]);
    owner(session, values[credentialKey(session)]);
    check(established(session, values[credentialKey(session)], body.identityMethod).fingerprint === bound.fingerprint,
      'TASK_VERIFICATION_FACTORS_CHANGED', 409);
    const state = readCredential(values[credentialKey(session)], session);
    check(state.revision === body.expectedRevision, 'TASK_VERIFICATION_REVISION_CONFLICT', 409);
    check(!slots.get(session.id)?.committing, 'TASK_VERIFICATION_CHANGE_IN_PROGRESS', 409);
    sweep(); check(slots.size < 10000 || slots.has(session.id), 'TASK_VERIFICATION_BUSY', 503);
    const request = { schema: '8415-task-human-verification-change/2', scope: scopeFor(session),
      mode: body.mode, expectedRevision: state.revision, credentialRevision: session.revision,
      changeId: randomToken(), nonce: randomToken(), issuedAt: stamp(), expiresAt: stamp() + LIFE };
    const changeDigest = digest(JSON.stringify(request));
    const message = [`8415wallet owner policy change: Per-operation human verification ${request.mode}`,
      `Scope: ${JSON.stringify(request.scope)}`, 'Applies only to still-valid, in-scope authorizations; no new task authority.',
      request.mode === 'OFF' ? 'Preparation, signing, submission, continuation and receipts will not ask again within existing authority.' :
        'Future not-yet-submitted operations use ON verification. Existing submitted/unknown attempts are reconciled without resubmission.',
      `Revision: ${request.expectedRevision}`, `Credential revision: ${request.credentialRevision}`,
      `Change: ${request.changeId}`, `Nonce: ${request.nonce}`, `Digest: ${changeDigest}`,
      `Expires at: ${request.expiresAt}`, 'Purpose: policy change only; no login, recovery, or transaction signature.'].join('\n');
    const previous = slots.get(session.id); if (previous) remember(session, previous, 'replaced');
    slots.set(session.id, { ...request, scopeDigest: digest(JSON.stringify(request.scope)), changeDigest,
      sessionId: session.id, method: body.identityMethod, factorBinding: bound.fingerprint, message, stage: 'identity', attempts: 0 });
    return { ...(versioned ? { changeProtocol: CHANGE_PROTOCOL } : {}), request, changeDigest, identityMethod: body.identityMethod, emailMasked: maskEmail(bound.email),
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
        await sendOtp({ to: bound.email, code, purpose: slot.mode === 'OFF' ? 'task-verification-policy-off' : 'task-verification-policy-on', expiresAt: slot.expiresAt,
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
        const next = { ...prior, schema: CURRENT_SCHEMA, mode: slot.mode, revision: nextRevision,
          enforcedFromRevision: prior.enforcedFromRevision ?? nextRevision, changes: [...prior.changes, {
          revision: nextRevision, previousRevision: prior.revision, mode: slot.mode, changeId: slot.changeId,
          changeDigest: slot.changeDigest, scopeDigest: slot.scopeDigest, credentialRevision: slot.credentialRevision,
          verifiedFactors: [slot.method, 'verified-email'], changedAt: stamp() }] };
        readStored(next, session);
        return { ...values, [credentialKey(session)]: withPolicy(values[credentialKey(session)], session, next) };
      });
    } finally { if (slots.get(session.id) === slot) slots.delete(session.id); body.code = ''; }
    return status(session);
  }
  async function enable(session, body) {
    fields(body, ['expectedRevision']); revision(body.expectedRevision); assertSession(session);
    // Compatibility route is deliberately fail-closed. ON now uses prepare(mode
    // ON), the exact identity proof and email confirm, just like every save.
    // A normal session or OFF execution authority cannot change owner settings.
    throw new TaskVerificationPolicyError('TASK_VERIFICATION_OWNER_CHANGE_REQUIRED', 409);
  }

  return Object.freeze({ status, prepare, verify, confirm, enable, cancel, cancelChange, keyFor: policyKey, readStored, readCredential });
}
