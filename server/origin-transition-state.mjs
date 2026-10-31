/** First-generation origin transition supports origin-independent credentials only.
 * It never translates grants, saved owner policies, nonce indexes or UNKNOWN.
 * Their presence requires the separate durable-scope migration protocol. */
import { createHash } from 'node:crypto';
const check = ok => { if (!ok) throw Error('AUTH_ORIGIN_SCOPE_MIGRATION_REQUIRED'); };
const credentialFields = new Set(['revision', 'registration', 'recoveryProfile', 'passwordHash', 'passwordBinding',
  'secret', 'lastStep', 'recoverySalt', 'recoveryHashes', 'enabledMethods', 'walletBindings', 'caBindings']);
export function validateOriginTransitionScope({ tenant, fromOrigin, toOrigin }) {
  check(typeof tenant === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(tenant));
  let from, to; try { from = new URL(fromOrigin); to = new URL(toOrigin); } catch { check(false); }
  check(from.origin === fromOrigin && to.origin === toOrigin && from.protocol === 'https:' &&
    to.protocol === 'https:' && from.hostname === to.hostname && to.port === '' && fromOrigin !== toOrigin);
  return Object.freeze({ tenant, fromOrigin, toOrigin });
}
export function inspectOriginIndependentState(records, input) {
  const scope = validateOriginTransitionScope(input);
  check(records && typeof records === 'object' && !Array.isArray(records));
  // The snapshot comes from the existing store's serialized gate, never HTTP.
  // Unknown keys/generations are refused rather than presumed origin independent.
  for (const [key, record] of Object.entries(records)) {
    check(record && typeof record === 'object' && !Array.isArray(record));
    if (key === '@registration:' + scope.tenant) continue;
    check(key.startsWith(scope.tenant + ':') && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(key.slice(scope.tenant.length + 1)));
    check(Object.keys(record).every(field => credentialFields.has(field)));
  }
  let raw; try { raw = JSON.stringify(records); } catch { check(false); }
  check(typeof raw === 'string' && Buffer.byteLength(raw) <= 4 * 1024 * 1024);
  // Embedded origin/scope data in a future credential version must not slip past
  // the top-level whitelist. Do not emit credential contents or identifiers.
  const visit = value => {
    if (!value || typeof value !== 'object') { check(value !== scope.fromOrigin && value !== scope.toOrigin); return; }
    check(!Object.keys(value).some(k => ['origin', 'scope', 'principal', 'grant', 'nonce', 'queue'].includes(k)));
    for (const child of Object.values(value)) visit(child);
  };
  visit(records);
  return Object.freeze({ schema: '8415wallet-origin-independent-state/1', ...scope,
    stateSha256: createHash('sha256').update(raw).digest('hex'), recordCount: Object.keys(records).length });
}
