import { validateAuthorizationContext } from './authorization-context.mjs';
/** Exact, scope-bound presentation decoding for the owner asset-control API.
 * Validating a response is not verification of a human factor or permission to act.
 */
import { assetControlTarget } from './asset-control-transport.mjs';
const refuse = () => { throw new Error('ASSET_CONTROL_WIRE_REFUSED'); };
const check = value => { if (!value) refuse(); };
const revision = value => { check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n); return value; };
const integer = value => { check(Number.isSafeInteger(value) && value >= 0); return value; };
function record(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const d = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(d).length === keys.length && keys.every(k => Object.hasOwn(d, k) && Object.hasOwn(d[k], 'value') && d[k].enumerable));
}
function array(value, maximum = 10000) {
  check(Array.isArray(value) && value.length <= maximum);
  const d = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(d).length === value.length + 1);
  for (let i = 0; i < value.length; i++) check(d[i] && Object.hasOwn(d[i], 'value') && d[i].enumerable);
  return value;
}
function boundScope(value, session, account, authorizationOrigin=session.origin) {
  record(value, ['origin', 'tenant', 'username', 'account', 'chainId', 'agentId']);
  check(session?.serverId && account && account.origin === session.origin && account.tenant === session.tenant &&
    account.account?.toLowerCase() === session.account?.toLowerCase() && account.chainId === session.chainId);
  check(value.origin === authorizationOrigin && value.tenant === session.tenant && value.username === account.username &&
    value.account === session.account.toLowerCase() && value.chainId === session.chainId &&
    typeof value.agentId === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(value.agentId));
  return Object.fromEntries(['origin', 'tenant', 'username', 'account', 'chainId', 'agentId'].map(k => [k, value[k]]));
}
export function createAssetControlWire({ crypto = globalThis.crypto } = {}) {
  async function digest(value) {
    check(typeof crypto?.subtle?.digest === 'function');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  async function authority(session,context){
    if(context===null)return {origin:session.origin,binding:null,context:null};
    context=await validateAuthorizationContext(context,session,session.origin,crypto);
    return {origin:context.authorizationOrigin,context,binding:context.continuation===null?null:
      {schema:'8415-owner-change-origin/1',transportOrigin:session.origin,authorizationOrigin:context.authorizationOrigin,continuation:context.continuation}};
  }
  async function status(raw, session, account, authorizationContext=null) {
    const selected=await authority(session,authorizationContext);
    record(raw, ['schema', 'scope', 'revision', 'entries', 'label', 'defaultValue', 'evaluation',
      'appliesTo', 'grantsAuthority', 'factorsForOFF', 'factorsForEverySave', 'changeCount', 'lastChange', 'canSave', 'executionScope']);
    const scope = boundScope(raw.scope, session, account,selected.origin);
    check(raw.schema === '8415-asset-control-state/1' && raw.defaultValue === true && raw.grantsAuthority === false &&
      raw.evaluation === 'NOT_EVALUATED' && raw.appliesTo === 'still-valid-in-scope-authorizations' &&
      raw.executionScope === 'supported-actual-task-bindings' && typeof raw.canSave === 'boolean');
    const factors = ['password-or-bound-wallet', 'previously-verified-email'];
    check(JSON.stringify(array(raw.factorsForOFF, 2)) === JSON.stringify(factors) &&
      JSON.stringify(array(raw.factorsForEverySave, 2)) === JSON.stringify(factors));
    const version = revision(raw.revision); integer(raw.changeCount);
    check(BigInt(raw.changeCount) === BigInt(version));
    const seen = new Set(), entries = [];
    for (const entry of array(raw.entries)) {
      record(entry, ['key', 'target', 'value', 'revision', 'policyRevision', 'changedAt', 'changeId']);
      const target = assetControlTarget(entry.target), key = await digest(target);
      check(entry.key === key && !seen.has(key) && typeof entry.value === 'boolean'); seen.add(key);
      check(BigInt(revision(entry.revision)) > 0n && BigInt(revision(entry.policyRevision)) <= BigInt(version) &&
        BigInt(entry.policyRevision) > 0n && typeof entry.changeId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(entry.changeId));
      integer(entry.changedAt); entries.push(Object.freeze({ ...entry, target }));
    }
    check(version !== '0' || entries.length === 0 && raw.lastChange === null);
    check(version === '0' || raw.lastChange !== null);
    // lastChange is not sufficient to reconcile an arbitrary previous write.
    // Keep it out of the view until exact request/audit validation is implemented.
    return Object.freeze({ ...(selected.binding?{authorizationContext:selected.context}:{}), scope: Object.freeze(scope), scopeDigest: await digest(scope), revision: version,
      entries: Object.freeze(entries), canSave: raw.canSave, grantsAuthority: false });
  }
  async function catalog(raw, view) {
    record(raw, ['schema', 'scopeDigest', 'entries', 'digest', 'ownershipVerified', 'grantsAuthority', 'inventoryComplete']);
    check(raw.schema === '8415-asset-control-catalog/1' && raw.scopeDigest === view.scopeDigest &&
      raw.ownershipVerified === false && raw.grantsAuthority === false && typeof raw.inventoryComplete === 'boolean');
    const entries = [], seen = new Set();
    for (const entry of array(raw.entries)) {
      record(entry, ['subject', 'path']); record(entry.subject, ['chainId', 'standard', 'contract', 'tokenId']);
      const s = entry.subject;
      check(s.chainId === view.scope.chainId && ['native', 'ERC-20', 'ERC-721', 'ERC-1155'].includes(s.standard));
      check(s.standard === 'native' ? s.contract === null : typeof s.contract === 'string' && /^0x[0-9a-f]{40}$/.test(s.contract) && !/^0x0+$/.test(s.contract));
      if (['native', 'ERC-20'].includes(s.standard)) check(s.tokenId === null); else revision(s.tokenId);
      const subject = { chainId: s.chainId, standard: s.standard, contract: s.contract, tokenId: s.tokenId };
      const path = ['all', ['native', 'ERC-20'].includes(s.standard) ? 'category:fungible' : 'category:nonfungible',
        'subcategory:' + await digest({ chainId: s.chainId, standard: s.standard }), 'asset:' + await digest(subject)];
      check(JSON.stringify(array(entry.path, 4)) === JSON.stringify(path) && !seen.has(path[3])); seen.add(path[3]);
      entries.push({ subject, path });
    }
    const sorted = [...entries].sort((a, b) => a.path[3] < b.path[3] ? -1 : a.path[3] > b.path[3] ? 1 : 0);
    check(JSON.stringify(sorted) === JSON.stringify(entries));
    check(raw.digest === await digest({ schema: raw.schema, scopeDigest: raw.scopeDigest, entries }));
    const branches = [{ path: ['all'], standard: null },
      { path: ['all', 'category:fungible'], standard: null }, { path: ['all', 'category:nonfungible'], standard: null }];
    for (const standard of ['native', 'ERC-20', 'ERC-721', 'ERC-1155']) branches.push({
      path: ['all', ['native', 'ERC-20'].includes(standard) ? 'category:fungible' : 'category:nonfungible',
        'subcategory:' + await digest({ chainId: view.scope.chainId, standard })], standard });
    return Object.freeze({ entries: Object.freeze(entries), branches: Object.freeze(branches), inventoryComplete: raw.inventoryComplete,
      ownershipVerified: false, grantsAuthority: false, digest: raw.digest });
  }
  async function prepared(raw, { session, account, reviewed, patch, identityMethod, now = Date.now(), authorizationContext=reviewed.authorizationContext??null }) {
    const selected=await authority(session,authorizationContext);
    record(raw, ['request', 'changeDigest', 'identityMethod', 'emailMasked', ...(identityMethod === 'wallet' ? ['message'] : [])]);
    const r = raw.request;
    record(r, ['schema', 'scope', ...(selected.binding?['originBinding']:[]), 'patch', 'expectedRevision', 'credentialRevision', 'changeId', 'nonce', 'issuedAt', 'expiresAt']);
    const scope = boundScope(r.scope, session, account,selected.origin);
    record(r.patch, ['target', 'value', 'expectedFieldRevision']);
    const target = assetControlTarget(r.patch.target);
    check(r.schema === (selected.binding?'8415-asset-control-change/2':'8415-asset-control-change/1') &&
      (!selected.binding || JSON.stringify(r.originBinding)===JSON.stringify(selected.binding)) && JSON.stringify(scope) === JSON.stringify(reviewed.scope) &&
      revision(r.expectedRevision) === reviewed.revision && raw.identityMethod === identityMethod &&
      ['password', 'wallet'].includes(identityMethod) && typeof r.patch.value === 'boolean');
    const canonicalPatch = { target, value: r.patch.value, expectedFieldRevision: revision(r.patch.expectedFieldRevision) };
    check(JSON.stringify(canonicalPatch) === JSON.stringify(patch));
    integer(r.credentialRevision); integer(r.issuedAt); integer(r.expiresAt); integer(now);
    check(r.expiresAt > r.issuedAt && r.expiresAt - r.issuedAt <= 300000 && now >= r.issuedAt && now < r.expiresAt);
    check([r.changeId, r.nonce].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v)) &&
      typeof raw.emailMasked === 'string' && raw.emailMasked.length > 0 && raw.emailMasked.length <= 320 &&
      !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(raw.emailMasked));
    const request = { schema: r.schema, scope, ...(selected.binding?{originBinding:selected.binding}:{}), expectedRevision: r.expectedRevision, patch: canonicalPatch,
      credentialRevision: r.credentialRevision, changeId: r.changeId, nonce: r.nonce, issuedAt: r.issuedAt, expiresAt: r.expiresAt };
    check(raw.changeDigest === await digest(request));
    const message = [`8415wallet owner policy change: asset control ${patch.value ? 'ON' : 'OFF'}`,
      `Scope: ${JSON.stringify(scope)}`, ...(selected.binding?[`Transport binding: ${JSON.stringify(selected.binding)}`]:[]), 'Applies only to still-valid, in-scope authorizations; no new task authority.',
      `Exact field: ${JSON.stringify(target)}`, `Exact value: ${patch.value}; field revision: ${patch.expectedFieldRevision}`,
      'Only this corresponding setting changes. Other settings, bounded grants and UNKNOWN reconciliation remain.',
      `Revision: ${request.expectedRevision}`, `Credential revision: ${request.credentialRevision}`,
      `Change: ${request.changeId}`, `Nonce: ${request.nonce}`, `Digest: ${raw.changeDigest}`,
      `Expires at: ${request.expiresAt}`, 'Purpose: policy change only; no login, recovery, or transaction signature.'].join('\n');
    if (identityMethod === 'wallet') check(raw.message === message);
    return Object.freeze({ request, changeDigest: raw.changeDigest, identityMethod, emailMasked: raw.emailMasked,
      message: identityMethod === 'wallet' ? message : null });
  }
  function verified(raw, prepared, now = Date.now()) {
    record(raw, ['changeId', 'changeDigest', 'emailMasked', 'digits', 'expiresAt']); integer(now);
    check(raw.changeId === prepared.request.changeId && raw.changeDigest === prepared.changeDigest &&
      raw.emailMasked === prepared.emailMasked && raw.digits === 8 && raw.expiresAt === prepared.request.expiresAt &&
      now >= prepared.request.issuedAt && now < raw.expiresAt);
    return Object.freeze({ ...raw });
  }
  async function reconciliation(raw, reference, view) {
    record(raw, ['schema', 'scope', 'revision', 'changeId', 'changeDigest', 'expectedRevision', 'state', 'automaticRetryAllowed', 'committedChange']);
    check(raw.schema === '8415-asset-control-reconciliation/1' && JSON.stringify(raw.scope) === JSON.stringify(view.scope) &&
      raw.changeId === reference.changeId && raw.changeDigest === reference.changeDigest &&
      raw.expectedRevision === reference.expectedRevision && raw.automaticRetryAllowed === false &&
      ['committed', 'committing', 'pending', 'not-committed', 'unknown'].includes(raw.state));
    revision(raw.revision);
    if (raw.state === 'committed') {
      const event = raw.committedChange;
      record(event, ['request', 'changeDigest', 'verifiedFactors', 'changedAt']);
      check(event.request.changeId === reference.changeId && event.request.expectedRevision === reference.expectedRevision &&
        JSON.stringify(event.request.scope) === JSON.stringify(view.scope) &&
        event.changeDigest === reference.changeDigest && await digest(event.request) === reference.changeDigest);
      const factors = array(event.verifiedFactors, 2);
      check(factors.length === 2 && ['password', 'wallet'].includes(factors[0]) && factors[1] === 'verified-email');
      integer(event.changedAt);
      check(event.changedAt >= event.request.issuedAt && event.changedAt < event.request.expiresAt &&
        BigInt(raw.revision) > BigInt(reference.expectedRevision));
    } else check(raw.committedChange === null);
    return Object.freeze({ ...raw });
  }
  return Object.freeze({ status, catalog, prepared, verified, reconciliation });
}
