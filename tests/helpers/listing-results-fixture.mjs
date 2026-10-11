import { createHash } from 'node:crypto';
import { MemoryCredentialStore } from '../../server/store.mjs';
import { createTaskListingResults } from '../../server/task-listing-results.mjs';
const H = n => `0x${n.toString(16).padStart(64, '0')}`;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function listingEvidenceFixture(store = new MemoryCredentialStore()) {
  const state = { quantities: [], scans: 0, reads: 0, sourceCalls: 0, offline: false, reorg: false, at: 1800000000000, duplicate: false };
  const canonicalReader = { sourceId: 'synthetic-listing-reader', async request({ method, params }) {
    state.reads++; if (state.offline) throw Error('SYNTHETIC_OFFLINE');
    if (method === 'eth_chainId') return '0x1';
    if (method !== 'eth_getBlockByNumber') throw Error('WRITE_FORBIDDEN');
    const n = params[0] === 'latest' ? 100 : Number(BigInt(params[0]));
    return { number: `0x${n.toString(16)}`, hash: H(state.reorg && n === 10 ? 999 : n) };
  } };
  async function observationSource(input) {
    state.sourceCalls++;
    const c = input.child.child;
    const order = { schema: 'artfi-nft-sale-order/1', nativeAction: 'list', chainId: c.chainId, protocol: c.protocol, seller: c.seller,
      nft: { ...c.nft, standard: c.nft.standard === 'ERC-1155' ? 'erc1155' : 'erc721' }, components: { offer: [{ startAmount: c.nft.quantity }] },
      binding: Object.fromEntries(['taskDigest', 'nativePlanId', 'nativeOperationId', 'reviewDigest', 'orderHash', 'typedDataDigest', 'valuationPolicyDigest', 'quoteEvidenceDigest'].map(k => [k, c[k]])) };
    const orderDigest = digest(order);
    return { order, observer: { async observe({ cursor } = {}) {
      state.scans++; const start = cursor?.nextBlock ?? 10, quantity = state.quantities.shift(), next = start + 1;
      const fills = quantity ? [{ kind: 'NFT_SALE_FILL', state: 'CONFIRMED', verified: true, canonical: true, finality: 'NOT_EVALUATED',
        chainId: c.chainId, sourceId: canonicalReader.sourceId, observationPolicyId: 'synthetic-listing-policy', orderHash: c.orderHash, orderDigest,
        transactionHash: H(1000 + start), blockHash: H(start), blockNumber: start, fillId: `1:${H(1000 + start)}:0`, confirmations: 101 - start,
        observedAt: state.at, evidenceDigest: '6'.repeat(64), quantity, requestedQuantity: c.nft.quantity, orderQuantity: c.nft.quantity,
        gross: String(BigInt(quantity) * 100n), fees: String(BigInt(quantity) * 5n), sellerNet: String(BigInt(quantity) * 95n),
        sellerNetBasis: 'TOKEN_PROCEEDS_EXCLUDING_GAS', authorizationChanged: false, budgetChanged: false }] : [];
      if (state.duplicate && fills.length) fills.push(structuredClone(fills[0]));
      return { kind: 'NFT_LISTED_ORDER_OBSERVATION', state: fills.length ? 'CONFIRMED' : 'UNKNOWN', verified: fills.length > 0,
        chainId: c.chainId, sourceId: canonicalReader.sourceId, observationPolicyId: 'synthetic-listing-policy', orderHash: c.orderHash, orderDigest,
        fills, nextCursor: { schema: 'artfi-listed-order-cursor/1', bindingDigest: '5'.repeat(64), nextBlock: next, checkpoint: { number: start, hash: H(start) } },
        scanStatus: 'SCANNED', scan: { fromBlock: 10, throughBlock: 30, pages: 1, coverageScope: 'THIS_INVOCATION_ONLY', scannedFromBlock: start, scannedThroughBlock: start },
        cumulativeCompletion: 'NOT_EVALUATED', onchainOrderStatus: 'NOT_EVALUATED', authorizationChanged: false, budgetChanged: false, resendAuthorized: false };
    } } };
  }
  const make = () => createTaskListingResults({ store, observationSource, canonicalReader, observationPolicyId: 'synthetic-listing-policy', now: () => state.at });
  return { state, store, results: make(), make, observationSource, canonicalReader };
}
