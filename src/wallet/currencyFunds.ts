/** Privacy-safe currency/NFT funds projection for a verified server read.
 * No financial authority: callers must authenticate and obtain the original
 * principal ledger, not grant budgets, exposure counters or allocated references.
 * This module never reads RPC, moves funds, authorizes spend or guesses an FX rate.
 */
export type FundsCurrency = {
  readonly chainId: string; readonly kind: 'native' | 'erc20';
  readonly contract: string | null; readonly decimals: number;
};
export type PrincipalFundsLine = {
  readonly kind: 'financial-principal'; readonly reservationId: string;
  readonly nftId: string; readonly currency: FundsCurrency;
  readonly amountBaseUnits: string;
  readonly state: 'held' | 'released' | 'refunded' | 'unknown';
  readonly blockHash: string;
};
export type CurrencyFundsInput = {
  readonly currency: FundsCurrency;
  readonly state: 'ready' | 'loading' | 'stale' | 'unavailable';
  /** Explicitly distinguish a liquid wallet balance from a portfolio total that already includes escrow. */
  readonly balanceBasis: 'wallet-liquid' | 'total-includes-escrow';
  readonly balanceBaseUnits: string | null;
  readonly blockHash: string | null;
  readonly escrowState: 'complete' | 'stale' | 'unavailable';
  readonly escrows: readonly PrincipalFundsLine[];
};
function check(ok: unknown): asserts ok { if (!ok) throw Error('CURRENCY_FUNDS_REFUSED'); }
function amount(value: unknown): bigint {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value));
  const n = BigInt(value); check(n < 1n << 256n); return n;
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
function currency(value: FundsCurrency): FundsCurrency {
  check(value && amount(value.chainId) > 0n && Number.isSafeInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 255);
  check(value.kind === 'native' ? value.contract === null :
    value.kind === 'erc20' && typeof value.contract === 'string' && /^0x[0-9a-f]{40}$/.test(value.contract) && !/^0x0+$/.test(value.contract));
  return Object.freeze({ chainId: value.chainId, kind: value.kind, contract: value.contract, decimals: value.decimals });
}
function key(c: FundsCurrency) { return c.chainId + ':' + c.kind + ':' + (c.contract ?? 'native'); }
function identifier(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value));
}
export function formatFundsUnits(value: string, decimals: number): string {
  const n = amount(value); check(Number.isSafeInteger(decimals) && decimals >= 0 && decimals <= 255);
  if (decimals === 0) return n.toString();
  const scale = 10n ** BigInt(decimals);
  return (n / scale).toString() + '.' + (n % scale).toString().padStart(decimals, '0');
}
/** Returns only the current wallet's authorized currency/NFT summary fields.
 * The output contains no payer/payee, owner/holder, private endpoint or input object.
 * A ready empty escrow set requires an explicit complete source inventory.
 */
export function buildCurrencyFunds(input: CurrencyFundsInput) {
  const c = currency(input.currency);
  check(['ready', 'loading', 'stale', 'unavailable'].includes(input.state));
  check(['complete', 'stale', 'unavailable'].includes(input.escrowState) && Array.isArray(input.escrows));
  check(['wallet-liquid', 'total-includes-escrow'].includes(input.balanceBasis));
  const base = { currency: c, canExecute: false as const };
  const unavailable = (state: 'loading' | 'stale' | 'unavailable', reason: string) =>
    Object.freeze({ ...base, state, reason, totalBaseUnits: null, unreleasedBaseUnits: null,
      availableBaseUnits: null, nftEscrows: Object.freeze([]), blockHash: null });
  if (input.state !== 'ready') return unavailable(input.state, 'BALANCE_' + input.state.toUpperCase());
  if (input.escrowState !== 'complete') return unavailable(input.escrowState, 'ESCROW_' + input.escrowState.toUpperCase());
  check(input.balanceBaseUnits !== null && hash(input.blockHash));
  const balance = amount(input.balanceBaseUnits), seen = new Map<string, PrincipalFundsLine>();
  const nft = new Map<string, bigint>();
  let held = 0n;
  for (const line of input.escrows) {
    check(line.kind === 'financial-principal');
    identifier(line.reservationId); identifier(line.nftId);
    const lc = currency(line.currency);
    check(key(lc) === key(c) && lc.decimals === c.decimals && line.blockHash === input.blockHash);
    const value = amount(line.amountBaseUnits);
    check(['held', 'released', 'refunded', 'unknown'].includes(line.state));
    const previous = seen.get(line.reservationId);
    if (previous) {
      check(previous.nftId === line.nftId && previous.amountBaseUnits === line.amountBaseUnits && previous.state === line.state);
      continue; // The same original financial reservation may appear in two read views, never count twice.
    }
    seen.set(line.reservationId, line);
    if (line.state === 'unknown') return unavailable('unavailable', 'PRINCIPAL_OUTCOME_UNKNOWN');
    if (line.state === 'held') { held += value; nft.set(line.nftId, (nft.get(line.nftId) ?? 0n) + value); }
  }
  const total = input.balanceBasis === 'wallet-liquid' ? balance + held : balance;
  check(total < 1n << 256n && held <= total);
  return Object.freeze({ ...base, state: 'ready' as const, reason: null,
    totalBaseUnits: total.toString(), unreleasedBaseUnits: held.toString(),
    availableBaseUnits: (total - held).toString(), blockHash: input.blockHash,
    nftEscrows: Object.freeze([...nft].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([nftId, value]) => Object.freeze({ nftId, unreleasedBaseUnits: value.toString() }))) });
}
/** No cross-currency conversion or aggregate total is produced. */
export function buildCurrencyFundsList(inputs: readonly CurrencyFundsInput[]) {
  const seen = new Set<string>();
  return Object.freeze(inputs.map(input => {
    const k = key(currency(input.currency)); check(!seen.has(k)); seen.add(k); return buildCurrencyFunds(input);
  }));
}

