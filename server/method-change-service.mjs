import { walletBindingsFor, walletBoundFor } from './wallet-bindings.mjs';
import { caBindingsFor } from './ca-bindings.mjs';
/** Exact, combined method-change verification. Never a login or task grant. */
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { randomToken, digest, equal, hashPassword, verifyPassword, newTotpSecret, unbase32, matchTotp, provisioningUri, recoveryCodes } from './crypto.mjs';
import { registrationFor, emailIdentity, maskEmail } from './account-directory.mjs';

const LIFE = 5 * 60_000, PROOF_LIFE = 2 * 60_000;
const METHODS = ['password', 'wallet', 'ca', 'totp'];
const QUESTIONS = ['recovery-phrase', 'first-school', 'childhood-place'];
const ACTIONS = ['wallet.initial', 'wallet.unbind', 'ca.initial', 'ca.replace', 'ca.unbind', 'password.initial', 'password.replace', 'password.unbind', 'totp.initial', 'totp.replace', 'totp.unbind', 'methods', 'recovery.initial', 'recovery.replace', 'email.initial', 'email.replace'];
export class MethodChangeError extends Error {
  constructor(code = 'AUTH_CHANGE_REFUSED', status = 403) { super(code); this.status = status; }
}
const requireThat = (ok, code, status) => { if (!ok) throw new MethodChangeError(code, status); };
const fields = (body, allowed) => requireThat(body && Object.keys(body).every(key => allowed.includes(key)), 'AUTH_CHANGE_INPUT_REFUSED', 400);
function answerText(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024) return null;
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  return text.length >= 12 && Buffer.byteLength(text) <= 512 && !/[\u0000-\u001f\u007f]/u.test(text) ? text : null;
}
function recoveryFor(prior) {
  registrationFor(prior);
  const profile = prior?.recoveryProfile;
  if (profile === undefined) return null;
  requireThat(profile?.version === 1 && QUESTIONS.includes(profile.questionId) &&
    /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(profile.answerHash) &&
    Number.isSafeInteger(profile.emailVerifiedAt) && profile.emailVerifiedAt >= 0,
  'AUTH_RECOVERY_STATE_REFUSED', 503);
  try { requireThat(emailIdentity(profile.email) === profile.email); } catch { throw new MethodChangeError('AUTH_RECOVERY_STATE_REFUSED', 503); }
  return profile;
}

/** All identity/session callbacks are server-owned. All mutations use the existing single-writer store. */
export function createMethodChangeService({ origin, tenant, store, directory, users, sendOtp = null, verifyCa = null, now = Date.now,
  assertRecent, credentialFor, passwordFor, methodStates, withConsumedCode, revokeAccount }) {
  const slots = new Map(), limits = new Map(), pepper = randomBytes(32); let expensive = 0;
  const stamp = () => { const value = now(); requireThat(Number.isSafeInteger(value) && value >= 0, 'AUTH_CLOCK_REFUSED', 503); return value; };
  const keyed = value => createHmac('sha256', pepper).update(JSON.stringify(value)).digest('hex');
  function sweep() {
    const time = stamp();
    for (const collection of [slots, limits]) for (const [key, slot] of collection) {
      if (!slot.committing && (time < slot.issuedAt || time >= slot.expiresAt)) collection.delete(key);
    }
  }
  function limit(key, maximum, life = 15 * 60_000) {
    sweep(); let entry = limits.get(key); const time = stamp();
    if (!entry) { requireThat(limits.size < 10000, 'AUTH_BUSY', 503); entry = { count: 0, issuedAt: time, expiresAt: time + life }; limits.set(key, entry); }
    requireThat(++entry.count <= maximum, 'AUTH_RATE_LIMITED', 429);
  }
  async function costly(operation) {
    requireThat(expensive < 2, 'AUTH_BUSY', 503); expensive++;
    try { return await operation(); } finally { expensive--; }
  }
  function current(session, slot) {
    assertRecent(session); sweep();
    requireThat(slot && slots.get(session.id) === slot && slot.sessionId === session.id &&
      slot.identity === JSON.stringify([origin, tenant, session.username, session.account, session.chainId, session.revision]) &&
      stamp() >= slot.issuedAt && stamp() < slot.expiresAt);
  }
  function oldBinding(session, prior) {
    requireThat(Number.isSafeInteger(prior?.revision ?? 0) && (prior?.revision ?? 0) >= 0, 'AUTH_CREDENTIAL_STATE_REFUSED', 503);
    if (prior?.secret !== undefined) {
      try { unbase32(prior.secret); } catch { throw new MethodChangeError('AUTH_CREDENTIAL_STATE_REFUSED', 503); }
      requireThat(prior.lastStep === undefined || Number.isSafeInteger(prior.lastStep) && prior.lastStep >= -1, 'AUTH_CREDENTIAL_STATE_REFUSED', 503);
    }
    const user = users.get(session.username);
    return keyed([passwordFor(user, prior), prior?.secret ?? null, prior?.recoverySalt ?? null,
      methodStates(user, prior, session), recoveryFor(prior), registrationFor(prior), user.wallets, walletBindingsFor(user, prior), caBindingsFor(user, prior)]);
  }
  function unchanged(session, slot, prior) {
    current(session, slot); directory.checkCredential(session.username, prior);
    requireThat((prior?.revision ?? 0) === session.revision && slot.oldBindingId === oldBinding(session, prior), 'AUTH_SETUP_STATE_CHANGED', 409);
  }
  const binding = slot => keyed(['8415wallet-method-change/1', slot.identity, slot.action, slot.factor, slot.oldBindingId, slot.newBindingId,
    slot.id, slot.nonce, slot.issuedAt, slot.expiresAt]);
  function status(session, prior) {
    const existing = registrationFor(prior)?.email ?? recoveryFor(prior)?.email;
    const user = users.get(session.username), password = Boolean(passwordFor(user, prior));
    const supportedIdentity = password || methodStates(user, prior, session).wallet.enabled;
    return { available: Boolean(sendOtp) && supportedIdentity, factor: password ? 'password' : 'wallet',
      verifiedEmailRequired: !existing, emailMasked: existing ? maskEmail(existing) : null,
      existingCodeRequired: Boolean(prior?.secret), existingAnswerRequired: Boolean(recoveryFor(prior)), trustedDeviceSupported: false };
  }
  function authenticatorStatus(session, prior) {
    sweep(); const slot = slots.get(session.id);
    const pending = slot && ['totp.initial', 'totp.replace'].includes(slot.action) && ['authorized', 'queued', 'committing'].includes(slot.stage) ? slot : null;
    return { enrolled: Boolean(prior?.secret), pending: Boolean(pending), expiresAt: pending?.expiresAt ?? null, replacement: pending?.action === 'totp.replace' };
  }
  function cancel(session, body = {}) {
    fields(body, ['changeId', 'changeProof']); const slot = slots.get(session.id);
    if (body.changeId !== undefined) requireThat(slot && body.changeId === slot.id, 'AUTH_SETUP_STATE_CHANGED', 409);
    if (body.changeProof !== undefined) requireThat(slot && typeof body.changeProof === 'string' &&
      equal(digest(body.changeProof), slot.proofHash ?? slot.committedProofHash), 'AUTH_SETUP_STATE_CHANGED', 409);
    if (!slot?.committing) slots.delete(session.id);
    return { cancelled: !slot?.committing, confirmationInProgress: Boolean(slot?.committing) };
  }
  async function start(session, body) {
    fields(body, ['action', 'identityMethod', 'newPassword', 'enabledMethods', 'email', 'questionId', 'answer', 'oldFingerprint', 'newFingerprint']);
    assertRecent(session); requireThat(ACTIONS.includes(body.action), 'AUTH_CHANGE_INPUT_REFUSED', 400);
    requireThat(sendOtp, 'AUTH_EMAIL_UNAVAILABLE', 503); sweep();
    requireThat(!slots.get(session.id)?.committing, 'AUTH_SETUP_STATE_CHANGED', 409);
    limit(`start:${session.username}`, 10); requireThat(slots.size < 10000, 'AUTH_BUSY', 503);
    const issuedAt = stamp(), slot = { id: randomToken(), nonce: randomToken(), username: session.username, sessionId: session.id,
      identity: JSON.stringify([origin, tenant, session.username, session.account, session.chainId, session.revision]),
      action: body.action, issuedAt, expiresAt: Math.min(issuedAt + LIFE, session.issuedAt + LIFE), stage: 'preparing', attempts: 0 };
    slots.set(session.id, slot);
    try {
      const prior = await credentialFor(session); current(session, slot);
      const user = users.get(session.username), passwordHash = passwordFor(user, prior), registration = registrationFor(prior), recovery = recoveryFor(prior);
      const prefix = body.action.split('.')[0];
      const allowed = prefix === 'ca' ? ['action', 'oldFingerprint', 'newFingerprint'] : prefix === 'password' && body.action !== 'password.unbind' ? ['action', 'newPassword'] : prefix === 'recovery' ? ['action', 'email', 'questionId', 'answer'] :
        prefix === 'email' ? ['action', 'email'] : prefix === 'methods' ? ['action', 'enabledMethods'] : ['action'];
      fields(body, [...allowed, 'identityMethod']);
      requireThat(body.identityMethod === undefined || ['password', 'wallet'].includes(body.identityMethod), 'AUTH_CHANGE_INPUT_REFUSED', 400);
      const exists = { wallet: walletBoundFor(user, prior, session), ca: caBindingsFor(user, prior).length > 0, password: Boolean(passwordHash), totp: Boolean(prior?.secret), recovery: Boolean(recovery), email: Boolean(registration) };
      if (prefix !== 'methods') requireThat(body.action === `${prefix}.${body.action.endsWith('.unbind') ? 'unbind' : exists[prefix] ? 'replace' : 'initial'}` &&
        (!body.action.endsWith('.unbind') || exists[prefix]), 'AUTH_SETUP_STATE_CHANGED', 409);
      slot.oldBindingId = oldBinding(session, prior); slot.factor = body.identityMethod ?? (passwordHash ? 'password' : 'wallet');
      requireThat(slot.factor !== 'password' || passwordHash, 'AUTH_INDEPENDENT_METHOD_REQUIRED', 409);
      requireThat(slot.factor === 'password' || methodStates(user, prior, session).wallet.enabled, 'AUTH_INDEPENDENT_METHOD_REQUIRED', 409);
      slot.oldEmail = registration?.email ?? recovery?.email;
      slot.existingCodeRequired = Boolean(prior?.secret); slot.existingAnswerRequired = Boolean(recovery);
      slot.prepared = {};
      if (prefix === 'wallet') {
        // Same selected asset account only. Different-address replacement is not supported.
        requireThat(user.wallets.some(value => value.account === session.account && value.chainId === session.chainId), 'AUTH_CHANGE_INPUT_REFUSED', 400);
        requireThat(body.action !== 'wallet.initial' || slot.factor !== 'wallet', 'AUTH_INDEPENDENT_METHOD_REQUIRED', 409);
        const bindings = walletBindingsFor(user, prior);
        slot.prepared.walletBindings = { version: 1, identities: body.action === 'wallet.unbind' ? bindings.filter(value => value.account !== session.account || value.chainId !== session.chainId) : [...bindings, { account: session.account, chainId: session.chainId }] };
        slot.prepared.newWallet = body.action === 'wallet.initial' ? { account: session.account, chainId: session.chainId } : null;
      } else if (prefix === 'ca') {
        requireThat(verifyCa, 'AUTH_METHOD_UNAVAILABLE', 409);
        const currentBindings = caBindingsFor(user, prior), fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
        requireThat(body.action === 'ca.initial' ? body.oldFingerprint === undefined : fingerprint(body.oldFingerprint) && currentBindings.includes(body.oldFingerprint), 'AUTH_CHANGE_INPUT_REFUSED', 400);
        requireThat(body.action === 'ca.unbind' ? body.newFingerprint === undefined : fingerprint(body.newFingerprint) && !currentBindings.includes(body.newFingerprint), 'AUTH_CHANGE_INPUT_REFUSED', 400);
        slot.prepared.caBindings = { version: 1, fingerprints: body.action === 'ca.initial' ? [body.newFingerprint] : currentBindings.flatMap(value => value !== body.oldFingerprint ? [value] : body.action === 'ca.unbind' ? [] : [body.newFingerprint]) };
        slot.prepared.newFingerprint = body.newFingerprint ?? null;
        slot.prepared.oldFingerprint = body.oldFingerprint ?? null;
      } else if (prefix === 'password' && body.action !== 'password.unbind') {
        requireThat(typeof body.newPassword === 'string' && body.newPassword.length >= 12 && Buffer.byteLength(body.newPassword) <= 1024, 'AUTH_PASSWORD_INPUT_REFUSED', 400);
        slot.prepared.passwordHash = await costly(() => hashPassword(body.newPassword));
      } else if (body.action === 'totp.initial' || body.action === 'totp.replace') slot.prepared.secret = newTotpSecret();
      else if (body.action === 'methods') {
        requireThat(Array.isArray(body.enabledMethods) && body.enabledMethods.length <= 4 && body.enabledMethods.every(method => METHODS.includes(method)) &&
          new Set(body.enabledMethods).size === body.enabledMethods.length, 'AUTH_METHODS_REFUSED', 400);
        const desired = METHODS.filter(method => body.enabledMethods.includes(method));
        const available = methodStates(user, { ...prior, enabledMethods: undefined }, session);
        requireThat(desired.every(method => available[method].enabled), 'AUTH_METHOD_UNAVAILABLE', 409);
        requireThat(desired.some(method => ['password', 'wallet', 'ca'].includes(method)), 'AUTH_INDEPENDENT_METHOD_REQUIRED', 409);
        slot.prepared.enabledMethods = desired;
      } else if (prefix === 'email' || prefix === 'recovery') {
        let email; try { email = emailIdentity(body.email); } catch { throw new MethodChangeError('AUTH_CHANGE_INPUT_REFUSED', 400); }
        slot.prepared.email = email;
        if (prefix === 'recovery') {
          requireThat(registration && registration.email === email, 'AUTH_REGISTRATION_EMAIL_MISMATCH', 409);
          const answer = answerText(body.answer); requireThat(answer && QUESTIONS.includes(body.questionId), 'AUTH_RECOVERY_INPUT_REFUSED', 400);
          slot.prepared.profile = { version: 1, email, questionId: body.questionId, answerHash: await costly(() => hashPassword(answer)) };
        } else requireThat(!registration || registration.email !== email, 'AUTH_SETUP_STATE_CHANGED', 409);
      }
      current(session, slot);
      // The first legacy email migration is the only bootstrap with no old verified address.
      requireThat(slot.oldEmail || body.action === 'email.initial', 'AUTH_VERIFIED_EMAIL_REQUIRED', 409);
      slot.email = slot.oldEmail ?? slot.prepared.email;
      slot.newBindingId = keyed([slot.action, slot.prepared]); slot.binding = binding(slot); slot.stage = 'identity';
      slot.message = ['8415wallet account method change', `Origin: ${origin}`, `Tenant: ${tenant}`, `Account: ${session.account}`,
        `Chain ID: ${session.chainId}`, `Purpose: ${slot.action}; no login or transaction authority`, `Verification method: ${slot.factor}`, `Request: ${slot.id}`,
        `Old binding: ${slot.oldBindingId}`, `New binding: ${slot.newBindingId}`, `Credential revision: ${session.revision}`,
        `Nonce: ${slot.nonce}`, `Expires: ${new Date(slot.expiresAt).toISOString()}`].join('\n');
      return { changeId: slot.id, action: slot.action, origin, tenant, account: session.account, chainId: session.chainId,
        factor: slot.factor, ...(slot.factor === 'wallet' ? { message: slot.message } : {}),
        existingCodeRequired: slot.existingCodeRequired, existingAnswerRequired: slot.existingAnswerRequired,
        emailMasked: maskEmail(slot.email), expiresAt: slot.expiresAt };
    } catch (error) { if (slots.get(session.id) === slot) slots.delete(session.id); throw error; }
    finally { body.newPassword = ''; body.answer = ''; }
  }
  const otpHash = (slot, purpose, code) => keyed([slot.binding, purpose, slot.id, code]);
  async function deliver(session, slot, email, purpose) {
    current(session, slot); limit(`send:${session.username}`, 5); limit(`destination:${digest(email.toLowerCase())}`, 5);
    const code = randomInt(100_000_000).toString().padStart(8, '0');
    slot[purpose === 'old' ? 'codeHash' : 'newCodeHash'] = otpHash(slot, purpose, code);
    try { await sendOtp({ to: email, code, purpose: purpose === 'old' ? 'method-change' : 'registration', expiresAt: slot.expiresAt, tenant, origin }); }
    catch { throw new MethodChangeError('AUTH_EMAIL_UNAVAILABLE', 503); }
    current(session, slot);
  }
  async function verify(session, body) {
    fields(body, ['changeId', 'originalPassword', 'signature', 'existingCode', 'recovery', 'existingAnswer']);
    const slot = slots.get(session.id); current(session, slot);
    requireThat(slot.id === body.changeId && slot.stage === 'identity'); slot.stage = 'verifying';
    limit(`identity:${session.username}`, 10);
    try {
      const prior = await credentialFor(session); unchanged(session, slot, prior);
      if (slot.factor === 'password') {
        requireThat(body.signature === undefined, 'AUTH_CHANGE_INPUT_REFUSED', 400);
        const valid = await costly(() => verifyPassword(body.originalPassword, passwordFor(users.get(session.username), prior)));
        unchanged(session, slot, prior); requireThat(valid);
      } else {
        requireThat(body.originalPassword === undefined && typeof body.signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(body.signature));
        let recovered; try { recovered = verifyMessage(slot.message, body.signature); } catch { throw new MethodChangeError(); }
        requireThat(recovered === session.account);
      }
      const profile = recoveryFor(prior);
      if (profile) {
        const answer = answerText(body.existingAnswer), valid = await costly(() => verifyPassword(answer ?? '', profile.answerHash));
        unchanged(session, slot, prior); requireThat(answer && valid);
      } else requireThat(body.existingAnswer === undefined, 'AUTH_CHANGE_INPUT_REFUSED', 400);
      if (prior?.secret) {
        requireThat(body.recovery === undefined || typeof body.recovery === 'boolean', 'AUTH_CHANGE_INPUT_REFUSED', 400);
        const next = withConsumedCode(prior, body.existingCode, body.recovery === true);
        slot.oldFactor = body.recovery === true ? { kind: 'recovery', hash: digest(`${prior.recoverySalt}:${body.existingCode}`) } : { kind: 'totp', step: next.lastStep };
      } else requireThat(body.existingCode === undefined && body.recovery === undefined, 'AUTH_CHANGE_INPUT_REFUSED', 400);
      // No old code/recovery code is consumed until the exact change commits.
      unchanged(session, slot, await credentialFor(session));
      await deliver(session, slot, slot.email, 'old'); slot.stage = 'email';
      return { changeId: slot.id, emailMasked: maskEmail(slot.email), digits: 8, expiresAt: slot.expiresAt };
    } catch (error) { if (slots.get(session.id) === slot) slots.delete(session.id); throw error; }
    finally { body.originalPassword = ''; body.existingAnswer = ''; body.existingCode = ''; body.signature = ''; }
  }
  function checkOtp(session, slot, code, purpose) {
    current(session, slot); limit(`otp:${session.username}`, 10);
    const valid = ++slot.attempts <= 5 && typeof code === 'string' && /^\d{8}$/.test(code) &&
      equal(slot[purpose === 'old' ? 'codeHash' : 'newCodeHash'], otpHash(slot, purpose, code));
    if (!valid) { if (slot.attempts >= 5) slots.delete(session.id); throw new MethodChangeError(); }
  }
  async function confirm(session, body) {
    fields(body, ['changeId', 'code']); const slot = slots.get(session.id); current(session, slot);
    requireThat(slot.id === body.changeId && slot.stage === 'email'); checkOtp(session, slot, body.code, 'old'); slot.stage = 'confirming';
    try {
      unchanged(session, slot, await credentialFor(session));
      slot.expiresAt = Math.min(slot.expiresAt, stamp() + PROOF_LIFE); slot.binding = binding(slot);
      const changeProof = randomToken(); slot.proofHash = digest(changeProof); slot.attempts = 0;
      const needsNewEmail = slot.action.startsWith('email.') && slot.prepared.email !== slot.email;
      if (needsNewEmail) await deliver(session, slot, slot.prepared.email, 'new');
      slot.needsNewEmail = needsNewEmail;
      if (slot.prepared.newFingerprint) slot.caMessage = [slot.message, 'Proof purpose: new CA binding possession only', `Exact binding: ${slot.binding}`, `Old certificate: ${slot.prepared.oldFingerprint ?? 'none'}`, `New certificate: ${slot.prepared.newFingerprint}`, `Proof expires: ${new Date(slot.expiresAt).toISOString()}`].join('\n');
      if (slot.prepared.newWallet) slot.walletMessage = [slot.message, 'Proof purpose: same-account wallet binding possession only', `Exact binding: ${slot.binding}`, `New wallet: ${session.account}`, `Proof expires: ${new Date(slot.expiresAt).toISOString()}`].join('\n');
      slot.stage = 'authorized';
      return { changeProof, action: slot.action, expiresAt: slot.expiresAt, newEmailRequired: needsNewEmail,
        ...(slot.caMessage ? { caMessage: slot.caMessage } : {}),
        ...(slot.walletMessage ? { walletMessage: slot.walletMessage } : {}),
        ...(needsNewEmail ? { emailMasked: maskEmail(slot.prepared.email), digits: 8 } : {}),
        ...(slot.prepared.secret ? { secret: slot.prepared.secret, uri: provisioningUri(slot.prepared.secret, tenant, session.username) } : {}) };
    } catch (error) { if (slots.get(session.id) === slot) slots.delete(session.id); throw error; }
    finally { body.code = ''; }
  }
  function consumeOldFactor(prior, slot) {
    const next = { ...prior };
    if (slot.oldFactor?.kind === 'totp') {
      requireThat(Number.isSafeInteger(slot.oldFactor.step) && slot.oldFactor.step > (prior.lastStep ?? -1)); next.lastStep = slot.oldFactor.step;
    } else if (slot.oldFactor?.kind === 'recovery') {
      const index = prior.recoveryHashes.findIndex(hash => equal(hash, slot.oldFactor.hash)); requireThat(index >= 0);
      next.recoveryHashes = [...prior.recoveryHashes]; next.recoveryHashes.splice(index, 1);
    }
    return next;
  }
  async function commit(session, body) {
    fields(body, ['changeProof', 'code', 'newEmailCode', 'signature', 'certificateChain', 'algorithm']); const slot = slots.get(session.id); current(session, slot);
    requireThat(slot.stage === 'authorized' && typeof body.changeProof === 'string' && equal(slot.proofHash, digest(body.changeProof)) && slot.binding === binding(slot));
    if (slot.needsNewEmail) checkOtp(session, slot, body.newEmailCode, 'new');
    else requireThat(body.newEmailCode === undefined, 'AUTH_CHANGE_INPUT_REFUSED', 400);
    if (!slot.prepared.secret) requireThat(body.code === undefined, 'AUTH_CHANGE_INPUT_REFUSED', 400);
    // Claim before queueing; only the final transaction can consume the proof.
    slot.stage = 'verifying-new'; let codes;
    try {
      if (slot.prepared.newWallet) {
        requireThat(body.certificateChain === undefined && body.algorithm === undefined && typeof body.signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(body.signature), 'AUTH_CHANGE_INPUT_REFUSED', 400);
        let recovered; try { recovered = verifyMessage(slot.walletMessage, body.signature); } catch { throw new MethodChangeError(); }
        requireThat(recovered === slot.prepared.newWallet.account && slot.prepared.newWallet.chainId === session.chainId);
      } else if (slot.prepared.newFingerprint) {
        let proof;
        try { proof = await costly(() => verifyCa({ message: slot.caMessage, signature: body.signature, certificateChain: body.certificateChain, algorithm: body.algorithm })); }
        catch { throw new MethodChangeError(); }
        requireThat(proof?.fingerprint === slot.prepared.newFingerprint);
      } else requireThat(body.signature === undefined && body.certificateChain === undefined && body.algorithm === undefined, 'AUTH_CHANGE_INPUT_REFUSED', 400);
      unchanged(session, slot, await credentialFor(session));
      slot.stage = 'queued';
      const update = prior => {
        unchanged(session, slot, prior); requireThat(slot.stage === 'queued' && slot.binding === binding(slot));
        let next = consumeOldFactor(prior, slot);
        if (slot.prepared.walletBindings) {
          next.walletBindings = structuredClone(slot.prepared.walletBindings);
          // Binding is not an implicit global enable: preserve any explicit disabled-method decision.
          // The separate methods change controls enablement without reviving other owned signers.
        } else if (slot.prepared.caBindings) {
          next.caBindings = structuredClone(slot.prepared.caBindings);
          if (Array.isArray(next.enabledMethods)) {
            if (slot.action === 'ca.initial') next.enabledMethods = [...new Set([...next.enabledMethods, 'ca'])];
            else if (!next.caBindings.fingerprints.length) next.enabledMethods = next.enabledMethods.filter(method => method !== 'ca');
          }
        } else if (slot.prepared.passwordHash) {
          next.passwordHash = slot.prepared.passwordHash; delete next.passwordBinding;
          if (slot.action === 'password.initial' && Array.isArray(next.enabledMethods)) next.enabledMethods = [...new Set([...next.enabledMethods, 'password'])];
        } else if (slot.action === 'password.unbind') {
          next.passwordHash = null; next.passwordBinding = 'unbound';
          if (Array.isArray(next.enabledMethods)) next.enabledMethods = next.enabledMethods.filter(method => method !== 'password');
        } else if (slot.prepared.secret) {
          const step = matchTotp(slot.prepared.secret, body.code, stamp()); requireThat(step !== null);
          const recovery = recoveryCodes(); codes = recovery.codes;
          Object.assign(next, { secret: slot.prepared.secret, lastStep: step, recoverySalt: recovery.salt, recoveryHashes: recovery.hashes });
          if (Array.isArray(next.enabledMethods)) next.enabledMethods = [...new Set([...next.enabledMethods, 'totp'])];
        } else if (slot.action === 'totp.unbind') {
          for (const field of ['secret', 'lastStep', 'recoverySalt', 'recoveryHashes']) delete next[field];
          if (Array.isArray(next.enabledMethods)) next.enabledMethods = next.enabledMethods.filter(method => method !== 'totp');
        } else if (slot.action === 'methods') next.enabledMethods = [...slot.prepared.enabledMethods];
        else if (slot.action.startsWith('recovery.')) next.recoveryProfile = { ...slot.prepared.profile, emailVerifiedAt: stamp() };
        else if (slot.action.startsWith('email.') && next.recoveryProfile) next.recoveryProfile = { ...next.recoveryProfile, email: slot.prepared.email, emailVerifiedAt: stamp() };
        const available = methodStates(users.get(session.username), next, session);
        requireThat(['password', 'wallet', 'ca'].some(method => available[method].enabled), 'AUTH_INDEPENDENT_METHOD_REQUIRED', 409);
        slot.committing = true; slot.stage = 'committing'; slot.committedProofHash = slot.proofHash; slot.proofHash = null;
        return { ...next, revision: session.revision + 1 };
      };
      if (slot.action.startsWith('email.')) await directory.commit(session.username,
        { version: 1, email: slot.prepared.email, verifiedAt: stamp() }, null, update);
      else await store.transaction(`${tenant}:${session.username}`, update);
      slots.delete(session.id); revokeAccount(session.username);
      return { updated: true, loggedOut: true, action: slot.action, ...(codes ? { enrolled: true, recoveryCodes: codes } : {}) };
    } catch (error) {
      // An unsubmitted bad new TOTP may be corrected without redoing the combined proof.
      if (!slot.committing && slots.get(session.id) === slot && slot.prepared.secret && error instanceof MethodChangeError &&
        error.message === 'AUTH_CHANGE_REFUSED' && ++slot.attempts < 5) slot.stage = 'authorized';
      else if (slots.get(session.id) === slot) slots.delete(session.id);
      throw error;
    } finally { body.code = ''; body.newEmailCode = ''; body.changeProof = ''; body.signature = ''; body.certificateChain = ''; }
  }
  async function handler(path, body, session) {
    const handlers = { 'account/change/start': start, 'account/change/verify': verify, 'account/change/confirm': confirm,
      'account/change/commit': commit, 'account/change/cancel': cancel };
    requireThat(Object.hasOwn(handlers, path), 'AUTH_ROUTE_REFUSED', 404); return handlers[path](session, body);
  }
  return Object.freeze({ status, authenticatorStatus, handler, cancel });
}
