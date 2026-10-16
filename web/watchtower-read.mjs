import { parseFeedContinuity, readFeedContinuity } from './feed-continuity.mjs';

const insist = value => { if (!value) throw new Error('WATCHTOWER_READ_REFUSED'); };
/** An optional current-feed read, not a runtime binding, attestation verifier or action gate. */
export async function readWatchtowerComparison({ wallet, tokenId, text, instant, guard, readFreshness }) {
  insist(typeof guard === 'function' && typeof readFreshness === 'function');
  insist(typeof instant === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(instant) && BigInt(instant) < (1n << 64n));
  const declaration = parseFeedContinuity(text);
  const feed = declaration.feeds[declaration.feeds.length - 1];
  // A different chain needs a separately authorized provider, never an endpoint from an import.
  insist(feed.chainId === declaration.projection.chainId);
  const reader = wallet.reader;
  const same = () => {
    guard();
    insist(wallet.reader === reader && reader.source.chainId.toString() === declaration.projection.chainId &&
      reader.source.address.toLowerCase() === declaration.projection.contract);
  };
  same();
  const reviewed = await readFeedContinuity({ wallet, tokenId, text, guard: same });
  same();
  const temporal = await wallet.temporalQuery(tokenId, BigInt(instant));
  same();
  const freshness = await readFreshness(feed, declaration.projection.registerId);
  same();
  // Recheck the immutable projection binding after the optional feed reads.
  const after = await wallet.assetView(tokenId);
  same();
  insist(after.identity.registerId === declaration.projection.registerId);
  return Object.freeze({ schema: '8415wallet-watchtower-comparison/1',
    projectionObservation: reviewed.projectionObservation, instant,
    assertedCurrentFeed: feed, pairing: 'UNVERIFIED_CONFIGURATION',
    predecessorLinks: 'UNVERIFIED_CONFIGURATION_NOT_QUERIED',
    temporal, freshness, canExecute: false, changesRuntimeConfiguration: false,
    readSemantics: 'SEQUENTIAL_LIVE_READS_NOT_ATOMIC_OR_HISTORICAL_CHAIN_SNAPSHOT',
    notes: Object.freeze([
      'The current feed was explicitly read. Its pairing to the register is still a configuration assertion, not an on-chain link.',
      'Freshness is current feed reorg exposure, not registrar finality or freshness at the historical query instant.',
      'Predecessor feeds were not read and do not lend their status, sequence or trust to this feed.',
      'No signature, entitlement, legal identity, settlement policy or transaction authority is established.',
      'A later admission can change a provisional historical answer. This display does not undo an earlier completed act.',
    ]) });
}
