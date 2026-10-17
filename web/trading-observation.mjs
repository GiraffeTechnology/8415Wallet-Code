/** Reporting only: current feed liveness never substitutes for projection finality. */
export function describeTradingObservation(temporal, freshness) {
  const finality = temporal?.finality;
  const resolved = temporal?.resolution?.kind === 'resolved' &&
    temporal.resolution.holderAgreesWithEntry === true;
  const projection = resolved && finality?.display === 'final' && finality.reported === true
    ? 'final'
    : resolved && finality?.display === 'provisional' && finality.reported === false
      ? 'provisional' : 'unavailable-or-uncovered';
  const statuses = { FRESH_FINAL: 'reorg-safe', FRESH_PENDING: 'fresh-reorg-exposed',
    STALE: 'stale', UNKNOWN: 'unknown' };
  const reported = freshness?.reported;
  const known = typeof reported === 'string' && Object.hasOwn(statuses, reported) &&
    freshness.display === statuses[reported];
  const feed = known && reported === 'STALE' ? 'stale'
    : known && (reported === 'FRESH_FINAL' || reported === 'FRESH_PENDING') ? 'fresh'
      : 'unknown';
  const interpretation = feed === 'stale' ? 'feed-not-current'
    : feed === 'fresh' && projection === 'final' ? 'projection-final-feed-fresh'
      : feed === 'fresh' && projection === 'provisional' ? 'projection-provisional-feed-fresh'
        : 'insufficient-observation';
  const summaries = {
    'feed-not-current': 'The configured feed is not current. This is distinct from ordinary registration pending, whatever the projection reports.',
    'projection-final-feed-fresh': 'The projection reports finality at the query instant; the configured feed is currently fresh. This does not establish commercial settlement.',
    'projection-provisional-feed-fresh': 'The projection answer is provisional while the configured feed is currently fresh. A later admission may change the answer; freshness does not promise when it arrives.',
    'insufficient-observation': 'No combined final/provisional-and-fresh conclusion is available. An unknown feed or unavailable/uncovered projection is not ordinary pending.',
  };
  return Object.freeze({ projection, feed, interpretation, summary: summaries[interpretation],
    pairing: 'UNVERIFIED_CONFIGURATION', commercialCompletion: 'NOT_DETERMINED', canExecute: false,
    caveat: 'Sequential live observations, not an atomic snapshot. Feed freshness is current, not freshness at the historical query instant. Pairing remains an unverified configuration assertion. Contest remains separate. No release, refund, entitlement, legal identity, sale completion or safe-trade verdict follows.' });
}
