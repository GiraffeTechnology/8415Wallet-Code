import { validateAuthorizationContext } from './authorization-context.mjs';
/** Strict owner-policy HTTP decoder. Legacy policy status remains readable;
 * changing and recovery require the qualified change protocol. This decoder
 * authenticates no human factor and grants no execution authority. */
const refuse = () => new Error('TASK_POLICY_WIRE_REFUSED');
const check = value => { if (!value) throw refuse(); };
const MODE = ['ON', 'OFF'], FACTORS = ['password-or-bound-wallet', 'previously-verified-email'];
const SCOPE = ['origin', 'tenant', 'username', 'account', 'chainId', 'agentId'];
const TOKEN = /^[A-Za-z0-9_-]{43}$/, HASH = /^[a-f0-9]{64}$/;
export const TASK_POLICY_CHANGE_PROTOCOL = '8415-task-policy-change-wire/1';
export function taskPolicyChangeQuery(reference, protocol = TASK_POLICY_CHANGE_PROTOCOL) {
  check([TASK_POLICY_CHANGE_PROTOCOL,'8415-task-policy-change-wire/2'].includes(protocol));
  reference = snapshot(reference);
  check(reference && typeof reference.changeId === 'string' && TOKEN.test(reference.changeId) &&
    typeof reference.changeDigest === 'string' && HASH.test(reference.changeDigest));
  return Object.freeze({ protocol, changeId: reference.changeId,
    changeDigest: reference.changeDigest, expectedRevision: version(reference.previousRevision) });
}
function snapshot(value, depth = 0) {
  check(depth <= 8);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  check(value && typeof value === 'object');
  if (Array.isArray(value)) {
    check(value.length <= 16); array(value);
    return Object.freeze(value.map(item => snapshot(item, depth + 1)));
  }
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  check(keys.length <= 32 && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    keys.every(key => typeof key === 'string' && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable));
  return Object.freeze(Object.fromEntries(keys.map(key => [key, snapshot(descriptors[key].value, depth + 1)])));
}
function record(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable));
}
function array(value) {
  check(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype);
  const fields = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(fields).length === value.length + 1);
  for (let i = 0; i < value.length; i++) check(fields[i] && Object.hasOwn(fields[i], 'value') && fields[i].enumerable);
  return value;
}
function version(value) {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n);
  return value;
}
const integer = value => { check(Number.isSafeInteger(value) && value >= 0); return value; };
const maskedEmail = value => { check(typeof value === 'string' && value.length > 0 && value.length <= 320 &&
  !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)); return value; };
function scope(value, session, account, authorityOrigin = session.origin) {
  check(account && account.origin === session.origin && account.tenant === session.tenant &&
    typeof account.account === 'string' && account.account.toLowerCase() === session.account.toLowerCase() &&
    account.chainId === session.chainId);
  record(value, SCOPE);
  let origin; try { origin = new URL(value.origin).origin; } catch { throw refuse(); }
  check(typeof value.origin === 'string' && value.origin === origin && value.origin === authorityOrigin &&
    typeof value.tenant === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value.tenant) && value.tenant === session.tenant &&
    typeof value.username === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value.username) &&
    !['__proto__', 'constructor', 'prototype'].includes(value.username) && value.username === account.username &&
    typeof value.account === 'string' && /^0x[0-9a-f]{40}$/.test(value.account) && !/^0x0+$/.test(value.account) &&
    value.account === session.account.toLowerCase() && typeof value.chainId === 'string' &&
    /^[1-9][0-9]{0,77}$/.test(value.chainId) && BigInt(value.chainId) < 1n << 256n && value.chainId === session.chainId &&
    typeof value.agentId === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(value.agentId));
  return Object.freeze(Object.fromEntries(SCOPE.map(key => [key, value[key]])));
}
function exactFactors(value) { check(JSON.stringify(array(value)) === JSON.stringify(FACTORS)); }
function canonicalMessage(request, changeDigest) {
  return [`8415wallet owner policy change: Per-operation human verification ${request.mode}`,
    `Scope: ${JSON.stringify(request.scope)}`, ...(request.originBinding?[`Transport binding: ${JSON.stringify(request.originBinding)}`]:[]), 'Applies only to still-valid, in-scope authorizations; no new task authority.',
    request.mode === 'OFF' ? 'Preparation, signing, submission, continuation and receipts will not ask again within existing authority.' :
      'Future not-yet-submitted operations use ON verification. Existing submitted/unknown attempts are reconciled without resubmission.',
    `Revision: ${request.expectedRevision}`, `Credential revision: ${request.credentialRevision}`,
    `Change: ${request.changeId}`, `Nonce: ${request.nonce}`, `Digest: ${changeDigest}`,
    `Expires at: ${request.expiresAt}`, 'Purpose: policy change only; no login, recovery, or transaction signature.'].join('\n');
}
export function createTaskVerificationPolicyWire({ crypto = globalThis.crypto } = {}) {
  async function digest(value) {
    check(typeof crypto?.subtle?.digest === 'function');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function expected(session, account, context) {
    check(account?.origin===session.origin && account.tenant===session.tenant && account.username===session.username &&
      account.account.toLowerCase()===session.account.toLowerCase() && account.chainId===session.chainId);
    if(context===null)return {context:null,origin:session.origin,binding:null,protocol:TASK_POLICY_CHANGE_PROTOCOL};
    context=await validateAuthorizationContext(context,session,session.origin,crypto);
    return {context,origin:context.authorizationOrigin,binding:context.continuation===null?null:
      {schema:'8415-owner-change-origin/1',transportOrigin:session.origin,authorizationOrigin:context.authorizationOrigin,continuation:context.continuation},
      protocol:context.continuation===null?TASK_POLICY_CHANGE_PROTOCOL:'8415-task-policy-change-wire/2'};
  }
  function reconciliation(raw, reference, scopeDigest, revision) {
    record(raw, ['changeId', 'changeDigest', 'expectedRevision', 'state', 'reason', 'automaticRetryAllowed', 'committedChange']);
    check(reference && raw.changeId === reference.changeId && raw.changeDigest === reference.changeDigest &&
      version(raw.expectedRevision) === reference.previousRevision && raw.automaticRetryAllowed === false);
    check(['committed', 'pending', 'committing', 'not-committed', 'unknown'].includes(raw.state));
    if (raw.state === 'committed') {
      const entry = raw.committedChange;
      record(entry, ['revision', 'previousRevision', 'mode', 'changeId', 'changeDigest', 'scopeDigest',
        'credentialRevision', 'verifiedFactors', 'changedAt']);
      check(raw.reason === null && entry.changeId === raw.changeId && entry.changeDigest === raw.changeDigest &&
        version(entry.previousRevision) === raw.expectedRevision && entry.mode === reference.mode &&
        version(entry.revision) === (BigInt(raw.expectedRevision) + 1n).toString() &&
        BigInt(entry.revision) <= BigInt(revision) && entry.scopeDigest === scopeDigest);
      integer(entry.credentialRevision); integer(entry.changedAt);
      const factors = array(entry.verifiedFactors);
      check(factors.length === 2 && ['password', 'wallet'].includes(factors[0]) && factors[1] === 'verified-email');
    } else {
      check(raw.committedChange === null);
      if (raw.state === 'not-committed') {
        check(['cancelled', 'replaced', 'revision-superseded'].includes(raw.reason));
        if (raw.reason === 'revision-superseded') check(BigInt(revision) > BigInt(raw.expectedRevision));
      } else check(raw.reason === (raw.state === 'unknown' ? 'unresolved' : null));
    }
    return raw;
  }
  async function status(raw, session, account, reference = null, authorizationContext = null) {
    const authority=await expected(session,account,authorizationContext);
    raw = snapshot(raw);
    check(account && account.origin === session.origin && account.tenant === session.tenant &&
      account.account.toLowerCase() === session.account.toLowerCase() && account.chainId === session.chainId);
    // Read descriptors before reading a schema property to reject accessors.
    const base = ['schema', 'scope', 'mode', 'revision', 'label', 'appliesTo', 'grantsAuthority',
      'factorsForOFF', 'factorsForEverySave', 'changeCount', 'lastChange'];
    const schema = Object.getOwnPropertyDescriptor(raw ?? {}, 'schema'); check(schema && Object.hasOwn(schema, 'value'));
    const v2 = schema.value === '8415-task-human-verification/2';
    const qualified = Object.hasOwn(raw, 'changeProtocol');
    record(raw, [...base, ...(v2 ? ['enforcedFromRevision'] : []),
      ...(qualified ? ['changeProtocol', 'pendingChange', 'reconciliation'] : [])]);
    if (qualified) check(raw.changeProtocol === authority.protocol);
    if (reference) check(qualified);
    check(v2 || raw.schema === '8415-task-human-verification/1');
    const boundScope = scope(raw.scope, session, account, authority.origin), scopeDigest = await digest(boundScope);
    version(raw.revision); integer(raw.changeCount);
    check(MODE.includes(raw.mode) && BigInt(raw.changeCount) === BigInt(raw.revision) &&
      raw.label === 'Per-operation human verification' && raw.appliesTo === 'still-valid-in-scope-authorizations' &&
      raw.grantsAuthority === false); exactFactors(raw.factorsForOFF); exactFactors(raw.factorsForEverySave);
    if (v2) check(BigInt(version(raw.enforcedFromRevision)) > 0n && BigInt(raw.enforcedFromRevision) <= BigInt(raw.revision));
    let lastChange = null;
    if (raw.changeCount === 0) check(!v2 && raw.mode === 'ON' && raw.lastChange === null);
    else {
      const entry = raw.lastChange;
      record(entry, ['revision', 'previousRevision', 'mode', 'changeId', 'changeDigest', 'scopeDigest',
        'credentialRevision', 'verifiedFactors', 'changedAt']);
      check(version(entry.revision) === raw.revision && (BigInt(version(entry.previousRevision)) + 1n).toString() === raw.revision &&
        entry.mode === raw.mode && typeof entry.changeId === 'string' && TOKEN.test(entry.changeId) &&
        typeof entry.changeDigest === 'string' && HASH.test(entry.changeDigest) && entry.scopeDigest === scopeDigest);
      integer(entry.credentialRevision); integer(entry.changedAt); const factors = array(entry.verifiedFactors);
      check(v2 || raw.mode === 'OFF' ? factors.length === 2 && ['password', 'wallet'].includes(factors[0]) && factors[1] === 'verified-email' : factors.length === 0);
      lastChange = Object.freeze({ ...entry, verifiedFactors: Object.freeze([...factors]) });
    }
    const context = Object.freeze({ origin: session.origin, tenant: boundScope.tenant,
      account: session.account, chainId: boundScope.chainId });
    // The actual source supplies applicability, not an Agent permission inventory.
    // Never reinterpret missing inventory as an empty grant list or all authority.
    let pendingChange = null, reconciled = null;
    if (qualified) {
      if (raw.pendingChange !== null) {
        const p = raw.pendingChange;
        record(p, ['changeId', 'changeDigest', 'expectedRevision', 'mode', 'stage', 'issuedAt', 'expiresAt']);
        check(typeof p.changeId === 'string' && TOKEN.test(p.changeId) && typeof p.changeDigest === 'string' &&
          HASH.test(p.changeDigest) && MODE.includes(p.mode) && ['identity', 'verifying', 'email', 'committing'].includes(p.stage));
        version(p.expectedRevision); integer(p.issuedAt); integer(p.expiresAt);
        check(p.expiresAt > p.issuedAt && p.expiresAt - p.issuedAt <= 300000);
        pendingChange = p;
      }
      if (reference) {
        check(reference.scopeKey === scopeDigest);
        reconciled = reconciliation(raw.reconciliation, reference, scopeDigest, raw.revision);
        // The query may resolve a draft retained by another session. The safe
        // summary enumerates only this session's current draft, not that query.
        if (pendingChange?.changeId === reference.changeId && pendingChange.changeDigest === reference.changeDigest) {
          check(pendingChange.expectedRevision === reference.previousRevision && pendingChange.mode === reference.mode);
          if (['pending', 'committing'].includes(reconciled.state))
            check((reconciled.state === 'committing') === (pendingChange.stage === 'committing'));
        }
      } else check(raw.reconciliation === null);
    }
    const view = Object.freeze({ mode: raw.mode, revision: raw.revision, context,
      scopeKey: scopeDigest, walletLabel: boundScope.tenant, agentId: boundScope.agentId,
      agentLabel: boundScope.agentId, scopeLabel: raw.appliesTo+(authority.binding?' · Authorization origin: '+authority.origin:''), permissions: null,
      canChange: qualified, changeState: pendingChange || reference && !['committed', 'not-committed'].includes(reconciled?.state) ? 'unknown' : 'settled' });
    return Object.freeze({ view, lastChange, scope: boundScope, scopeDigest, schema: raw.schema,
      authorizationContext: authority.context, changeProtocol: qualified ? raw.changeProtocol : null, pendingChange, reconciliation: reconciled });
  }
  async function prepared(raw, { session, account, reviewed, mode, identityMethod, now, authorizationContext = null }) {
    const authority=await expected(session,account,authorizationContext);
    raw = snapshot(raw);
    check(['password', 'wallet'].includes(identityMethod));
    const qualified = Object.hasOwn(raw, 'changeProtocol');
    if (qualified) check(raw.changeProtocol === authority.protocol);
    record(raw, ['request', 'changeDigest', 'identityMethod', 'emailMasked', ...(identityMethod === 'wallet' ? ['message'] : []),
      ...(qualified ? ['changeProtocol'] : [])]);
    if (reviewed.canChange) check(qualified);
    record(raw.request, ['schema', 'scope', ...(authority.binding?['originBinding']:[]), 'mode', 'expectedRevision', 'credentialRevision', 'changeId', 'nonce', 'issuedAt', 'expiresAt']);
    const r = raw.request, boundScope = scope(r.scope, session, account, authority.origin);
    check(r.schema === (authority.binding?'8415-task-human-verification-change/3':'8415-task-human-verification-change/2') &&
      (authority.binding===null || JSON.stringify(r.originBinding)===JSON.stringify(authority.binding)) && MODE.includes(mode) && r.mode === mode &&
      version(r.expectedRevision) === reviewed.revision && raw.identityMethod === identityMethod &&
      typeof r.changeId === 'string' && TOKEN.test(r.changeId) && typeof r.nonce === 'string' && TOKEN.test(r.nonce));
    integer(r.credentialRevision); integer(r.issuedAt); integer(r.expiresAt); integer(now);
    check(r.expiresAt > r.issuedAt && r.expiresAt - r.issuedAt <= 300000 && now >= r.issuedAt && now < r.expiresAt);
    check(await digest(boundScope) === reviewed.scopeKey);
    const request = Object.freeze({ schema: r.schema, scope: boundScope, ...(authority.binding?{originBinding:authority.binding}:{}), mode, expectedRevision: r.expectedRevision,
      credentialRevision: r.credentialRevision, changeId: r.changeId, nonce: r.nonce, issuedAt: r.issuedAt, expiresAt: r.expiresAt });
    check(typeof raw.changeDigest === 'string' && HASH.test(raw.changeDigest) && await digest(request) === raw.changeDigest);
    const message = canonicalMessage(request, raw.changeDigest);
    if (identityMethod === 'wallet') check(raw.message === message);
    const principal = Object.freeze({ origin: account.origin, tenant: account.tenant, username: account.username,
      account: account.account, chainId: account.chainId });
    return Object.freeze({ request, session, authorizationContext:authority.context, account: principal, changeId: r.changeId, changeDigest: raw.changeDigest,
      identityMethod, emailMasked: maskedEmail(raw.emailMasked), issuedAt: r.issuedAt, expiresAt: r.expiresAt,
      message: identityMethod === 'wallet' ? message : null });
  }
  function verified(raw, prepared, now) {
    raw = snapshot(raw);
    record(raw, ['changeId', 'changeDigest', 'emailMasked', 'digits', 'expiresAt']); integer(now);
    check(raw.changeId === prepared.changeId && raw.changeDigest === prepared.changeDigest && raw.digits === 8 &&
      raw.emailMasked === prepared.emailMasked && raw.expiresAt === prepared.expiresAt && now >= prepared.issuedAt && now < raw.expiresAt);
    return Object.freeze({ ...raw });
  }
  async function committed(raw, prepared) {
    const decoded = await status(raw, prepared.session, prepared.account,null,prepared.authorizationContext??null), entry = decoded.lastChange, r = prepared.request;
    check(decoded.schema === '8415-task-human-verification/2' && decoded.view.mode === r.mode &&
      decoded.view.revision === (BigInt(r.expectedRevision) + 1n).toString() && entry &&
      entry.changeId === prepared.changeId && entry.changeDigest === prepared.changeDigest &&
      entry.previousRevision === r.expectedRevision && entry.credentialRevision === r.credentialRevision &&
      entry.verifiedFactors[0] === prepared.identityMethod && entry.changedAt >= r.issuedAt && entry.changedAt < r.expiresAt &&
      JSON.stringify(decoded.scope) === JSON.stringify(r.scope));
    return raw;
  }
  function cancelled(raw, reference, decodedStatus) {
    raw = snapshot(raw);
    record(raw, ['changeProtocol', 'cancelled', 'reconciliation']);
    check(raw.changeProtocol === decodedStatus.changeProtocol && typeof raw.cancelled === 'boolean' &&
      reference.scopeKey === decodedStatus.scopeDigest);
    const result = reconciliation(raw.reconciliation, reference, decodedStatus.scopeDigest, decodedStatus.view.revision);
    if (raw.cancelled) check(result.state === 'not-committed' && result.reason === 'cancelled');
    return result;
  }
  return Object.freeze({ status, prepared, verified, committed, cancelled });
}
