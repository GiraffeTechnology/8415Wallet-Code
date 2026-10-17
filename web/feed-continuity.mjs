/** Original PRD section 5: record configuration assertions, never verify feed lineage. */
const refuse = () => { throw new Error('FEED_CONTINUITY_INPUT_REFUSED'); };
const check = value => { if (!value) refuse(); };
const integer = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) > 0n && BigInt(value) < (1n << 256n);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0+$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
function fields(value, keys) {
  check(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}
function feedKey(feed) { return [feed.chainId, feed.address, feed.assetId].join(':'); }
/** Oldest asserted feed first, current asserted feed last. No URLs or credentials. */
export function parseFeedContinuity(text) {
  check(typeof text === 'string' && new TextEncoder().encode(text).byteLength <= 16384);
  let raw; try { raw = JSON.parse(text); } catch { refuse(); }
  fields(raw, ['schema','projection','feeds']);
  check(raw.schema === '8415wallet-feed-continuity/1');
  fields(raw.projection, ['chainId','contract','registerId']);
  check(integer(raw.projection.chainId) && address(raw.projection.contract) && hash(raw.projection.registerId));
  check(Array.isArray(raw.feeds) && raw.feeds.length >= 1 && raw.feeds.length <= 32);
  const feeds = raw.feeds.map(feed => {
    fields(feed, ['chainId','address','assetId']);
    check(integer(feed.chainId) && address(feed.address) && hash(feed.assetId));
    return Object.freeze({ chainId: feed.chainId, address: feed.address, assetId: feed.assetId });
  });
  return Object.freeze({ schema: raw.schema,
    projection: Object.freeze({ chainId: raw.projection.chainId, contract: raw.projection.contract, registerId: raw.projection.registerId }),
    feeds: Object.freeze(feeds) });
}
export function describeFeedContinuity(declaration) {
  // Re-parse the whitelisted schema so this public entry never trusts a forged approval flag.
  const value = parseFeedContinuity(JSON.stringify(declaration));
  const identities = value.feeds.map(feedKey);
  return Object.freeze({
    declaration: value,
    rows: Object.freeze(value.feeds.map((feed, index) => Object.freeze({
      position: index, role: index === value.feeds.length - 1 ? 'asserted-current' : 'asserted-predecessor',
      feed, previousPosition: index === 0 ? null : index - 1,
      repeatedIdentity: identities.indexOf(identities[index]) !== identities.lastIndexOf(identities[index]),
      pairing: 'UNVERIFIED_CONFIGURATION', predecessorLink: index === 0 ? 'NOT_DECLARED' : 'UNVERIFIED_CONFIGURATION',
    }))),
    canExecute: false, changesRuntimeConfiguration: false,
    notes: Object.freeze([
      'The register-to-feed pairing and every predecessor link are configuration assertions, not on-chain facts checked by this wallet.',
      'Order is supplied by the importer. Repeated feed identities are retained, not collapsed into a verified lineage.',
      'No feed was selected, queried, migrated or made trusted. No predecessor status, sequence number or freshness is inherited.',
      'This record supplies no projection finality, identity, legal title, task grant or transaction authority.',
    ]),
  });
}
/** Read only the already selected projection through its existing conformance/identity gate. */
export async function readFeedContinuity({ wallet, tokenId, text, guard }) {
  const declaration = parseFeedContinuity(text); // Capture before the first await.
  check(typeof tokenId === 'bigint' && tokenId >= 0n && tokenId < (1n << 256n) && typeof guard === 'function');
  guard();
  const reader = wallet.reader, chainId = reader.source.chainId, contract = reader.source.address;
  check(chainId.toString() === declaration.projection.chainId && contract.toLowerCase() === declaration.projection.contract);
  const observed = await wallet.assetView(tokenId);
  guard();
  check(wallet.reader === reader && reader.source.chainId === chainId && reader.source.address === contract &&
    observed.tokenId === tokenId && observed.identity.chainId === chainId &&
    observed.identity.address.toLowerCase() === declaration.projection.contract &&
    observed.identity.registerId === declaration.projection.registerId);
  return Object.freeze({ schema: '8415wallet-feed-continuity-review/1',
    projectionObservation: Object.freeze({ chainId: chainId.toString(), contract: declaration.projection.contract,
      registerId: observed.identity.registerId, tokenId: tokenId.toString(), observedAt: observed.observedAt.toString() }),
    ...describeFeedContinuity(declaration) });
}
