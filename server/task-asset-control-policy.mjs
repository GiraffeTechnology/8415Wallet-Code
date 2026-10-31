import { ownerChangeOriginBinding } from './owner-change-origin.mjs';
/** Asset-control exact-change owner service. No route or execution authority.
 * Factor machinery retains the established password/bound-wallet + verified-email
 * contract; each saved field is bound into this service's distinct request digest.
 * The outer auth service must mount this only with actual asset execution gates.
 */
import { randomBytes, randomInt, createHmac } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { digest, equal, randomToken, verifyPassword } from './crypto.mjs';
import { registrationFor, maskEmail } from './account-directory.mjs';
import { fields, revision, scope } from './task-verification-state.mjs';
import { AssetControlStateError as TaskVerificationPolicyError, assetControlPolicyKey,
  normalizeAssetControlPatch, assetControlRequest, assetControlChangeDigest,
  readAssetControlPolicy, readCredentialAssetControlPolicy, assetControlValue,
  appendVerifiedAssetControlChange } from './task-asset-control-state.mjs';
const check = (ok, code = 'ASSET_CONTROL_POLICY_REFUSED', status = 403) => {
  if (!ok) throw new TaskVerificationPolicyError(code, status);
};
const LIFE = 5 * 60_000;
/** Factory callbacks are auth-service-owned closures, never HTTP-supplied flags.
 * Password OR registered-wallet control is factor one; OTP to the PREVIOUSLY
 * verified email is factor two. Existing TOTP/recovery are not a third gate.
 * No factor value, signature, bearer proof, or email address enters policy audit. */
export function createAssetControlPolicyService({ origin, tenant, agentId, store, users,
  assertSession, credentialFor, passwordFor, methodStates, directory, sendOtp = null, now = Date.now, ownerAuthorizationContext = null }) {
  check(store && ['readMany', 'transactionMany', 'withReadGate'].every(key => typeof store[key] === 'function') &&
    users instanceof Map && [assertSession, credentialFor, passwordFor, methodStates, now].every(x => typeof x === 'function') &&
    typeof directory?.checkCredential === 'function' && (sendOtp === null || typeof sendOtp === 'function'),
  'ASSET_CONTROL_CONFIG_REFUSED', 500);
  check(ownerAuthorizationContext===null || typeof ownerAuthorizationContext==='function','ASSET_CONTROL_CONFIG_REFUSED',500);
  const originBinding=session=>ownerAuthorizationContext===null?null:ownerChangeOriginBinding(ownerAuthorizationContext(session),scopeFor(session));
  const slots = new Map(), limits = new Map(), pepper = randomBytes(32);
  let expensive = 0;
  const stamp = () => { const t = now(); check(Number.isSafeInteger(t) && t >= 0, 'ASSET_CONTROL_CLOCK_REFUSED', 503); return t; };
  const keyed = value => createHmac('sha256', pepper).update(JSON.stringify(value)).digest('hex');
  const scopeFor = session => scope({ origin, tenant, username: session.username,
    account: session.account.toLowerCase(), chainId: session.chainId, agentId });
  const credentialKey = session => `${tenant}:${session.username}`;
  const policyKey = session => assetControlPolicyKey(scopeFor(session));
  const readStored = (raw, session) => readAssetControlPolicy(raw, scopeFor(session));
  const readCredential = (credential, session) => readCredentialAssetControlPolicy(credential, scopeFor(session));
  const withPolicy = (credential, session, next) => ({ ...credential, assetControlPolicies: {
    ...(credential?.assetControlPolicies ?? {}), [policyKey(session)]: next } });
  function sweep() {
    const time = stamp();
    for (const map of [slots, limits]) for (const [key, value] of map) {
      if (!value.committing && (time < value.issuedAt || time >= value.expiresAt)) map.delete(key);
    }
  }
  function limit(session) {
    sweep(); let entry = limits.get(session.username);
    if (!entry) {
      check(limits.size < 10000, 'ASSET_CONTROL_BUSY', 503);
      entry = { attempts: 0, issuedAt: stamp(), expiresAt: stamp() + 15 * 60_000 }; limits.set(session.username, entry);
    }
    check(++entry.attempts <= 10, 'ASSET_CONTROL_RATE_LIMITED', 429);
  }
  function owner(session, credential) {
    assertSession(session);
    check(['password','wallet','ca','totp'].includes(session.kind),
      'ASSET_CONTROL_OWNER_REQUIRED',403);
    const user = users.get(session.username);
    check(user?.wallets.some(wallet => wallet.account.toLowerCase() === session.account.toLowerCase() && wallet.chainId === session.chainId),
      'ASSET_CONTROL_OWNER_REFUSED');
    check(Number.isSafeInteger(session.revision) && session.revision >= 0 && (credential?.revision ?? 0) === session.revision,
      'ASSET_CONTROL_CREDENTIAL_CHANGED', 409);
    directory.checkCredential(session.username, credential);
    return user;
  }
  function established(session, credential, method) {
    const user = owner(session, credential), email = registrationFor(credential);
    check(email && sendOtp !== null && ['password', 'wallet'].includes(method) && methodStates(user, credential, session)[method]?.enabled,
      'ASSET_CONTROL_TWO_ESTABLISHED_FACTORS_REQUIRED', 409);
    const passwordHash = method === 'password' ? passwordFor(user, credential) : null;
    check(method !== 'password' || typeof passwordHash === 'string', 'ASSET_CONTROL_TWO_ESTABLISHED_FACTORS_REQUIRED', 409);
    return { email: email.email, fingerprint: keyed([scopeFor(session), session.revision, method, passwordHash,
      user.wallets, methodStates(user, credential, session), email]), passwordHash };
  }
  function current(session, slot) {
    assertSession(session); sweep();
    check(slot && slots.get(session.id) === slot && slot.sessionId === session.id &&
      JSON.stringify(slot.originBinding??null)===JSON.stringify(originBinding(session)) &&
      slot.scopeDigest === digest(JSON.stringify(scopeFor(session))) && slot.credentialRevision === session.revision &&
      stamp() >= slot.issuedAt && stamp() < slot.expiresAt, 'ASSET_CONTROL_CHANGE_EXPIRED', 409);
  }
  function unchanged(session, slot, credential) {
    current(session, slot);
    const bound = established(session, credential, slot.method);
    check(equal(bound.fingerprint, slot.factorBinding), 'ASSET_CONTROL_FACTORS_CHANGED', 409);
    return bound;
  }
  function cancel(session) {
    const slot = slots.get(session.id);
    // An in-flight durable save cannot be undone or reported as cancelled.
    if (slot?.committing) return { cancelled: false, confirmationInProgress: true };
    slots.delete(session.id);
    return { cancelled: true, confirmationInProgress: false };
  }
  async function status(session) {
    const keys = [credentialKey(session)], values = await store.readMany(keys);
    owner(session, values[keys[0]]);
    const state = readCredential(values[keys[0]], session);
    return { ...state, label: 'Agent and asset authorization controls', defaultValue: true,
      evaluation: 'NOT_EVALUATED', appliesTo: 'still-valid-in-scope-authorizations',
      grantsAuthority: false, factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
      factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'] };
  }
  async function reconcile(session, body) {
    fields(body, ['changeId', 'changeDigest', 'expectedRevision']);
    revision(body.expectedRevision);
    check(typeof body.changeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.changeId) &&
      typeof body.changeDigest === 'string' && /^[a-f0-9]{64}$/.test(body.changeDigest),
    'ASSET_CONTROL_REQUEST_REFUSED', 400);
    const state = await status(session);
    const committed = state.changes.find(event => event.request.changeId === body.changeId &&
      event.changeDigest === body.changeDigest && event.request.expectedRevision === body.expectedRevision);
    const slot = slots.get(session.id);
    const matching = slot && slot.changeId === body.changeId && slot.changeDigest === body.changeDigest &&
      slot.expectedRevision === body.expectedRevision;
    // Search the durable complete audit, not only lastChange. Later saves must
    // not hide the outcome of an earlier lost response.
    const outcome = committed ? 'committed' : matching ? slot.committing ? 'committing' : 'pending' :
      BigInt(state.revision) > BigInt(body.expectedRevision) ? 'not-committed' : 'unknown';
    return { schema: '8415-asset-control-reconciliation/1', scope: state.scope,
      revision: state.revision, changeId: body.changeId, changeDigest: body.changeDigest,
      expectedRevision: body.expectedRevision, state: outcome, automaticRetryAllowed: false,
      committedChange: committed ?? null };
  }
  async function cancelChange(session, body) {
    const before = await reconcile(session, body);
    const slot = slots.get(session.id);
    // No await between the exact-slot check and deletion. Never cancel a newer
    // tab's request or report cancellation after persistence has started.
    const matching = slot && slot.changeId === body.changeId && slot.changeDigest === body.changeDigest &&
      slot.expectedRevision === body.expectedRevision;
    if (before.state !== 'pending' || !matching || slot.committing)
      return { cancelled: false, reconciliation: await reconcile(session, body) };
    slots.delete(session.id);
    return { cancelled: true, reconciliation: { ...before, state: 'not-committed' } };
  }
  async function prepare(session, body) {
    fields(body, ['expectedRevision', 'identityMethod', 'patch','protocol']); revision(body.expectedRevision); limit(session);
    const binding=originBinding(session);
    check(binding===null ? body.protocol===undefined : body.protocol==='8415-asset-control-change-wire/2','ASSET_CONTROL_ORIGIN_PROTOCOL_REQUIRED',409);
    body = { expectedRevision: body.expectedRevision, identityMethod: body.identityMethod,
      patch: normalizeAssetControlPatch(body.patch) };
    const credential = await credentialFor(session), bound = established(session, credential, body.identityMethod);
    const values = await store.readMany([credentialKey(session)]);
    owner(session, values[credentialKey(session)]);
    check(established(session, values[credentialKey(session)], body.identityMethod).fingerprint === bound.fingerprint,
      'ASSET_CONTROL_FACTORS_CHANGED', 409);
    const state = readCredential(values[credentialKey(session)], session);
    check(state.revision === body.expectedRevision, 'ASSET_CONTROL_REVISION_CONFLICT', 409);
    check(assetControlValue(state,body.patch.target).revision === body.patch.expectedFieldRevision,
      'ASSET_CONTROL_FIELD_REVISION_CONFLICT',409);
    sweep(); check(!slots.get(session.id)?.committing, 'ASSET_CONTROL_CHANGE_COMMITTING', 409);
    check(slots.size < 10000 || slots.has(session.id), 'ASSET_CONTROL_BUSY', 503);
    const request = assetControlRequest({ schema: binding===null?'8415-asset-control-change/1':'8415-asset-control-change/2', scope: scopeFor(session),
      ...(binding===null?{}:{originBinding:binding}),
      patch: body.patch, expectedRevision: state.revision, credentialRevision: session.revision,
      changeId: randomToken(), nonce: randomToken(), issuedAt: stamp(), expiresAt: stamp() + LIFE });
    const changeDigest = assetControlChangeDigest(request);
    const message = [`8415wallet owner policy change: asset control ${request.patch.value ? 'ON' : 'OFF'}`,
      `Scope: ${JSON.stringify(request.scope)}`, ...(binding===null?[]:[`Transport binding: ${JSON.stringify(binding)}`]), 'Applies only to still-valid, in-scope authorizations; no new task authority.',
      `Exact field: ${JSON.stringify(request.patch.target)}`,
      `Exact value: ${request.patch.value}; field revision: ${request.patch.expectedFieldRevision}`,
      'Only this corresponding setting changes. Other settings, bounded grants and UNKNOWN reconciliation remain.',
      `Revision: ${request.expectedRevision}`, `Credential revision: ${request.credentialRevision}`,
      `Change: ${request.changeId}`, `Nonce: ${request.nonce}`, `Digest: ${changeDigest}`,
      `Expires at: ${request.expiresAt}`, 'Purpose: policy change only; no login, recovery, or transaction signature.'].join('\n');
    slots.set(session.id, { ...request, request, mode:request.patch.value ? 'ON' : 'OFF', scopeDigest: digest(JSON.stringify(request.scope)), changeDigest,
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
        check(body.signature === undefined && expensive < 2, 'ASSET_CONTROL_FACTOR_REFUSED');
        expensive++;
        let valid; try { valid = await verifyPassword(body.password, bound.passwordHash); } finally { expensive--; }
        current(session, slot); check(valid, 'ASSET_CONTROL_FACTOR_REFUSED');
      } else {
        check(body.password === undefined && typeof body.signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(body.signature),
          'ASSET_CONTROL_FACTOR_REFUSED');
        let recovered; try { recovered = verifyMessage(slot.message, body.signature); } catch { throw new TaskVerificationPolicyError('ASSET_CONTROL_FACTOR_REFUSED'); }
        check(recovered.toLowerCase() === session.account.toLowerCase(), 'ASSET_CONTROL_FACTOR_REFUSED');
      }
      unchanged(session, slot, await credentialFor(session));
      const code = randomInt(100_000_000).toString().padStart(8, '0');
      slot.codeHash = keyed([slot.changeDigest, slot.changeId, code]);
      try {
        await sendOtp({ to: bound.email, code, purpose: slot.mode === 'OFF' ? 'asset-control-policy-off' : 'asset-control-policy-on', expiresAt: slot.expiresAt,
          tenant, origin, changeDigest: slot.changeDigest });
      } catch { throw new TaskVerificationPolicyError('ASSET_CONTROL_EMAIL_UNAVAILABLE', 503); }
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
      equal(slot.codeHash, keyed([slot.changeDigest, slot.changeId, body.code])), 'ASSET_CONTROL_FACTOR_REFUSED');
    slot.stage = 'committing'; slot.committing = true;
    try {
      await store.transactionMany([credentialKey(session)], values => {
        unchanged(session, slot, values[credentialKey(session)]);
        const prior = readCredential(values[credentialKey(session)], session);
        check(prior.revision === slot.expectedRevision, 'ASSET_CONTROL_REVISION_CONFLICT', 409);
        const next = appendVerifiedAssetControlChange(prior,scopeFor(session),slot.request,
          [slot.method,'verified-email'],stamp());
        readStored(next, session);
        return { ...values, [credentialKey(session)]: withPolicy(values[credentialKey(session)], session, next) };
      });
    } finally { if (slots.get(session.id) === slot) slots.delete(session.id); body.code = ''; }
    return status(session);
  }
  async function enable(session, body) {
    fields(body, ['expectedRevision']); revision(body.expectedRevision); assertSession(session);
    // No session-only shortcut. ON uses prepare(patch.value true), the exact
    // identity proof and email confirm, just like every corresponding save.
    // A normal session or OFF execution authority cannot change owner settings.
    throw new TaskVerificationPolicyError('ASSET_CONTROL_OWNER_CHANGE_REQUIRED', 409);
  }

  return Object.freeze({ status, prepare, verify, confirm, enable, cancel, reconcile, cancelChange, keyFor: policyKey, readStored, readCredential });
}
