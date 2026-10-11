/** Validation/projection only. Current quantities come exclusively from the
 * service's durable consumer summary; publication and browser state add none. */
const check = value => { if (!value) { const error = Error('TASK_LISTING_OBSERVATION_REFUSED'); error.code = error.message; throw error; } };
const count = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0+$/.test(value);
const digest = value => typeof value === 'string' && /^(?:0x)?[0-9a-f]{64}$/i.test(value);
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const aggregate = value => {
  check(value && Object.keys(value).sort().join(',') === 'fees,gross,quantity,sellerNet' && Object.values(value).every(uint));
  check(BigInt(value.gross) === BigInt(value.fees) + BigInt(value.sellerNet)); return value;
};
export const listingCompletion = state => ({ listed: 'listed-awaiting-evidence', partial: 'listing-partial',
  'observed-at-depth': 'listing-observed-at-depth', unknown: 'listing-unknown', reorg: 'listing-reorg' })[state];
export function normalizeListingResult(value, expected) {
  const s = structuredClone(value), b = s?.binding;
  check(s?.kind === 'TASK_LISTING_OBSERVATION_SUMMARY' && b && Object.keys(b).length === 10 &&
    b.taskDigest === expected.taskDigest && b.childDigest === expected.childDigest && b.chainId === expected.chainId &&
    b.orderHash === expected.orderHash && b.requestedQuantity === expected.requestedQuantity &&
    b.minimumConfirmations === Number(expected.minimumConfirmations) && count(b.minimumConfirmations) && b.minimumConfirmations >= 1 &&
    digest(b.orderDigest) && /^[A-Za-z0-9_-]{1,128}$/.test(b.sourceId) && /^[A-Za-z0-9_-]{1,128}$/.test(b.observationPolicyId) &&
    uint(b.orderQuantity) && BigInt(b.orderQuantity) >= BigInt(b.requestedQuantity) && BigInt(b.orderQuantity) <= 1000000n);
  check(['FRESH', 'STALE'].includes(s.freshness) && count(s.revision) && count(s.availableFillCount) && count(s.invalidatedFillCount) &&
    s.availableFillCount + s.invalidatedFillCount <= 10000 && typeof s.reconciliationBlocked === 'boolean' &&
    (s.checkedAt === null || count(s.checkedAt)) && (s.head === null || count(s.head.number) && hash(s.head.hash)) &&
    (s.reason === null || typeof s.reason === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(s.reason)));
  for (const key of ['finality', 'cumulativeCompletion', 'onchainOrderStatus', 'currentOwnership', 'currentBalances', 'usdProceeds']) check(s[key] === 'NOT_EVALUATED');
  for (const key of ['authorizationChanged', 'budgetChanged', 'quotaChanged', 'resendAuthorized', 'relistAuthorized']) check(s[key] === false);
  check(s.sellerNetBasis === 'TOKEN_PROCEEDS_EXCLUDING_GAS' && ['UNKNOWN', 'VERIFIED_FILLS'].includes(s.saleStatus));
  const last = aggregate(s.lastKnownAggregate); check(BigInt(last.quantity) <= BigInt(b.orderQuantity));
  if (s.freshness === 'FRESH') {
    const current = aggregate(s.aggregate);
    check(!s.reconciliationBlocked && s.reason === 'TASK_LISTING_ANCHORS_REVALIDATED' && s.checkedAt !== null && s.head !== null &&
      Object.keys(current).every(k => current[k] === last[k]) && (BigInt(current.quantity) > 0n) === (s.availableFillCount > 0) &&
      s.saleStatus === (current.quantity === '0' ? 'UNKNOWN' : 'VERIFIED_FILLS'));
  } else check(s.aggregate === null && s.saleStatus === 'UNKNOWN');
  const state = s.freshness === 'FRESH' ? (s.aggregate.quantity === '0' ? 'listed' :
    BigInt(s.aggregate.quantity) < BigInt(b.requestedQuantity) ? 'partial' : 'observed-at-depth') :
    s.invalidatedFillCount > 0 || /REORG|INVALIDAT/.test(s.reason ?? '') ? 'reorg' : 'unknown';
  return freeze({ state, summary: s });
}
export function historicalListingResult(result) {
  if (!result) return result;
  return freeze({ state: result.state === 'reorg' ? 'reorg' : 'unknown', summary: { ...result.summary,
    freshness: 'STALE', saleStatus: 'UNKNOWN', aggregate: null, reason: result.summary.reason ?? 'TASK_LISTING_HISTORICAL' } });
}
