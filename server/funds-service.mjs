/** Read-only port for an independently configured authoritative owner inventory and
 * original financial-principal ledger. No RPC URL, credential, catalog or grant
 * budget is accepted from the caller. A production adapter is NOT supplied here. */
import { buildCurrencyFunds, buildCurrencyFundsList } from '../src/wallet/currencyFunds.ts';
export class FundsError extends Error {
  constructor(code = 'FUNDS_SOURCE_UNAVAILABLE', status = 503) { super(code); this.status = status; }
}
const check = (ok, code = 'FUNDS_SOURCE_REFUSED', status = 503) => { if (!ok) throw new FundsError(code, status); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k) && 'value' in Object.getOwnPropertyDescriptor(value, k));
/** reader.readForPrincipal(context) returns {schema, scope, readId, observedAt,
 * validUntil, inventoryState, currencies}. scope echoes context.principal exactly.
 * It must independently resolve current-owner holdings and original principal,
 * verify ownership, chain, common block and complete escrow enumeration per row.
 * inventoryState describes coverage, never inferred from an empty list. Partial
 * inventory can contain individually complete rows, but is never a full balance.
 * readId binds this observation to this request; expiry is not chain finality.
 * nftId is an opaque authorized reference, NOT an inferred contract/token id.
 */
export function createFundsService({ reader = null, origin, tenant, now = Date.now, validateSession }) {
  const readMethod = reader === null ? null : reader.readForPrincipal;
  check(reader === null || typeof readMethod === 'function', 'FUNDS_CONFIG_REFUSED', 500);
  // Capture the configured capability once; later object mutation is not reconfiguration.
  const readForPrincipal = readMethod === null ? null : readMethod.bind(reader);
  return Object.freeze({ async read(body, session) {
    check(exact(body, ['readId']) && typeof body.readId === 'string' && /^[a-f0-9]{32}$/.test(body.readId), 'FUNDS_REQUEST_REFUSED', 400);
    await validateSession(session);
    check(reader !== null, 'FUNDS_NOT_ENABLED');
    const principal = Object.freeze({ tenant, origin, username: session.username, account: session.account, chainId: session.chainId });
    const context = Object.freeze({ principal, readId: body.readId });
    let source;
    try { source = await readForPrincipal(context); }
    catch { throw new FundsError(); }
    await validateSession(session);
    check(exact(source, ['schema', 'scope', 'readId', 'observedAt', 'validUntil', 'inventoryState', 'currencies']) &&
      source.schema === '8415-authoritative-funds/1' && exact(source.scope, Object.keys(principal)) &&
      Object.keys(principal).every(k => source.scope[k] === principal[k]) && source.readId === body.readId);
    check(['complete','partial','stale','unavailable'].includes(source.inventoryState) && Array.isArray(source.currencies) && source.currencies.length <= 256);
    check(Number.isSafeInteger(source.observedAt) && source.observedAt >= 0 && source.observedAt <= now() &&
      Number.isSafeInteger(source.validUntil) && source.validUntil >= source.observedAt);
    const inventoryState = source.inventoryState === 'unavailable' ? 'unavailable' : source.validUntil <= now() ? 'stale' : source.inventoryState;
    let currencies;
    try {
      check(source.currencies.every(row => row.currency?.chainId === principal.chainId && Array.isArray(row.escrows) && row.escrows.length <= 4096));
      currencies = buildCurrencyFundsList(source.currencies.map(row => inventoryState === 'stale' || inventoryState === 'unavailable' ? { ...row, state: inventoryState } : row));
    } catch { throw new FundsError('FUNDS_SOURCE_REFUSED'); }
    // Validate and project ALL original principal records, even when an unknown
    // outcome makes the aggregate unavailable. Never manufacture event history.
    currencies = currencies.map((row, index) => {
      const input = source.currencies[index];
      if (inventoryState === 'stale' || inventoryState === 'unavailable' || input.state !== 'ready' || input.escrowState !== 'complete')
        return Object.freeze({ ...row, principalRecords: null });
      const seen = new Map();
      try {
        for (const line of input.escrows) {
          buildCurrencyFunds({ ...input, escrows: [line] });
          const record = { reservationId: line.reservationId, nftId: line.nftId, amountBaseUnits: line.amountBaseUnits, state: line.state, blockHash: line.blockHash };
          const prior = seen.get(record.reservationId);
          check(!prior || Object.keys(record).every(k => prior[k] === record[k]));
          if (!prior) seen.set(record.reservationId, Object.freeze(record));
        }
      } catch { throw new FundsError('FUNDS_SOURCE_REFUSED'); }
      return Object.freeze({ ...row, principalRecords: Object.freeze([...seen.values()]) });
    });
    // Construct a whitelist projection. Never serialize the source or ledger.
    const state = inventoryState === 'complete' ? currencies.every(row => row.state === 'ready') ? 'ready' : 'partial' : inventoryState;
    return Object.freeze({ schema: '8415-currency-funds/1', scope: Object.freeze({ tenant, origin, account: session.account, chainId: session.chainId }),
      readId: body.readId, state, inventoryState, observedAt: source.observedAt, validUntil: source.validUntil, currencies });
  }});
}
