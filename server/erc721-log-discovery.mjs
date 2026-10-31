/** Read-only, bounded candidate discovery. Ownership remains the inventory reader's job.
 * An allowlist and a bounded log window cannot establish complete wallet inventory. */
import { keccak256Utf8 } from '../src/codec/keccak.ts';
const TRANSFER = keccak256Utf8('Transfer(address,address,uint256)');
const address = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v) && !/^0x0+$/.test(v);
const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const quantity = v => typeof v === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v);
const word = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const check = ok => { if (!ok) throw Error('NFT_LOG_DISCOVERY_REFUSED'); };
const hex = v => '0x' + v.toString(16);
export function createErc721LogDiscovery({ rpcForPrincipal, contracts, fromBlock,
  maximumBlocks = 256, maximumLogsPerQuery = 1024, lifetimeMs = 30000, now = Date.now }) {
  check(typeof rpcForPrincipal === 'function' && Array.isArray(contracts) && contracts.length > 0 &&
    contracts.length <= 64 && contracts.every(address) && new Set(contracts).size === contracts.length &&
    quantity(fromBlock) && Number.isSafeInteger(maximumBlocks) && maximumBlocks > 0 && maximumBlocks <= 256 &&
    Number.isSafeInteger(maximumLogsPerQuery) && maximumLogsPerQuery > 0 && maximumLogsPerQuery <= 1024 &&
    Number.isSafeInteger(lifetimeMs) && lifetimeMs > 0 && lifetimeMs <= 60000 && typeof now === 'function');
  const configuredContracts = Object.freeze([...contracts]), first = BigInt(fromBlock);
  return Object.freeze({ async listForPrincipal({ principal, readId }) {
    check(principal && address(principal.account) && typeof principal.chainId === 'string' &&
      /^(?:0|[1-9][0-9]{0,77})$/.test(principal.chainId) && BigInt(principal.chainId) > 0n &&
      BigInt(principal.chainId) < 1n << 256n && typeof readId === 'string' && /^[0-9a-f]{32}$/.test(readId));
    const scope = Object.freeze(structuredClone(principal));
    const rpc = await rpcForPrincipal(scope); check(rpc && typeof rpc.request === 'function');
    const request = rpc.request.bind(rpc), read = (method, params) => request({ method, params });
    const verifyChain = async () => { const chain = await read('eth_chainId', []);
      check(quantity(chain) && BigInt(chain).toString() === scope.chainId); };
    await verifyChain();
    const finalized = await read('eth_getBlockByNumber', ['finalized', false]);
    check(finalized && quantity(finalized.number) && hash(finalized.hash));
    const number = finalized.number, blockHash = finalized.hash, last = BigInt(number);
    check(last >= first && last - first < BigInt(maximumBlocks));
    const accountTopic = '0x' + '0'.repeat(24) + scope.account.slice(2);
    const seen = new Map(), candidates = new Map();
    for (const contract of configuredContracts) {
      for (const direction of ['incoming', 'outgoing']) {
        const topics = direction === 'incoming' ? [TRANSFER, null, accountTopic] : [TRANSFER, accountTopic];
        const logs = await read('eth_getLogs', [{ address: contract, fromBlock: hex(first), toBlock: number, topics }]);
        // A result at the cap is ambiguous: providers can silently truncate there.
        check(Array.isArray(logs) && logs.length < maximumLogsPerQuery);
        for (const log of logs) {
          check(log && log.removed === false && log.address === contract && log.data === '0x' &&
            Array.isArray(log.topics) && log.topics.length === 4 && log.topics[0] === TRANSFER &&
            log.topics.slice(1).every(word) && /^0x0{24}/.test(log.topics[1]) && /^0x0{24}/.test(log.topics[2]) &&
            log.topics[direction === 'incoming' ? 2 : 1] === accountTopic && quantity(log.blockNumber) &&
            BigInt(log.blockNumber) >= first && BigInt(log.blockNumber) <= last && hash(log.blockHash) &&
            (log.blockNumber !== number || log.blockHash === blockHash) && hash(log.transactionHash) &&
            quantity(log.transactionIndex) && quantity(log.logIndex));
          const identity = log.blockNumber + ':' + log.logIndex;
          const fingerprint = JSON.stringify([log.address, log.topics, log.blockHash, log.transactionHash, log.transactionIndex]);
          check(!seen.has(identity) || seen.get(identity) === fingerprint); seen.set(identity, fingerprint);
          const tokenId = BigInt(log.topics[3]).toString(), key = contract + ':' + tokenId;
          candidates.set(key, { contract, tokenId, standard: 'ERC-721',
            metadata: { state: 'unavailable', name: null, description: null, imageUrl: null } });
          check(candidates.size <= 1024);
        }
      }
    }
    await verifyChain();
    const after = await read('eth_getBlockByNumber', [number, false]);
    check(after && after.number === number && after.hash === blockHash);
    const observedAt = now(); check(Number.isSafeInteger(observedAt) && observedAt >= 0 && Number.isSafeInteger(observedAt + lifetimeMs));
    return { scope: { ...scope }, readId, observedAt, validUntil: observedAt + lifetimeMs,
      inventoryState: 'partial', blockNumber: number, blockHash,
      tokens: [...candidates.values()].sort((a, b) => a.contract.localeCompare(b.contract) ||
        (BigInt(a.tokenId) < BigInt(b.tokenId) ? -1 : BigInt(a.tokenId) > BigInt(b.tokenId) ? 1 : 0)) };
  } });
}
