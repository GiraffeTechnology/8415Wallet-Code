const insist = value => { if (!value) throw new Error('KIT_DISPLAY_REFUSED'); };
/** No default endpoint, URL import, credential form or cross-origin probing. */
export function kitDisplayBase(basePath, origin) {
  insist(typeof basePath === 'string' && /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(basePath) && basePath.length <= 512);
  const base = new URL(origin);
  insist(base.origin === origin && !base.username && !base.password &&
    (base.protocol === 'https:' || base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)));
  return new URL(basePath.replace(/\/$/, ''), origin).href;
}
/** A transient composed reader for display. It never replaces the selected execution session. */
export async function readKitDisplay({ wallet, tokenId, instant, basePath, origin, guard, compose }) {
  insist(typeof guard === 'function' && typeof compose === 'function' && typeof tokenId === 'bigint' && tokenId >= 0n && tokenId < (1n << 256n));
  insist(typeof instant === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(instant) && BigInt(instant) < (1n << 64n));
  const baseUrl = kitDisplayBase(basePath, origin), reader = wallet.reader;
  const chainId = reader.source.chainId, contract = reader.source.address;
  const same = () => { guard(); insist(wallet.reader === reader && reader.source.chainId === chainId && reader.source.address === contract); };
  same();
  // The selected direct chain's existing identity/conformance gate remains first.
  const before = await wallet.assetView(tokenId); same();
  const display = compose({ baseUrl, chain: reader, source: { chainId, address: contract }, account: wallet.account, guard: same });
  const asset = await display.assetView(tokenId); same();
  const temporal = await display.temporalQuery(tokenId, BigInt(instant)); same();
  const after = await wallet.assetView(tokenId); same();
  insist(asset.identity.registerId === before.identity.registerId && after.identity.registerId === before.identity.registerId &&
    asset.identity.verificationProfile === before.identity.verificationProfile && after.identity.verificationProfile === before.identity.verificationProfile);
  return Object.freeze({ schema: '8415wallet-kit-display/1', asset, temporal,
    source: Object.freeze({ chainId: chainId.toString(), contract, tokenId: tokenId.toString(), basePath }),
    canExecute: false, changesRuntimeConfiguration: false,
    readSemantics: 'SEQUENTIAL_CURRENT_READS_NOT_ATOMIC',
    notes: Object.freeze([
      'Projection reads use the existing Kit adapter with chain identity cross-checking enabled. Backend disagreement or unavailability is not a register fact.',
      'Owner, conformance, clock, settlement and authority remain direct-chain facts. Kit is not a replacement source for them.',
      'This temporary display session never supplies a request, grant or transaction authority to the original session.',
      'No fallback, cache, historical-chain snapshot or attestation of legal title is provided. Direct-chain standalone use remains independent.',
    ]) });
}
