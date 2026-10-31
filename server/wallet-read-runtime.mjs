/** Fixed source composition. Inputs are process-owned capabilities, never config
 * module paths or HTTP-selected URLs. Missing authority remains unavailable. */
import { createRpcFundsReader } from './rpc-funds-reader.mjs';
import { createRpcNftInventoryReader } from './nft-inventory-reader.mjs';
import { createErc721LogDiscovery } from './erc721-log-discovery.mjs';
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_getLogs']);
const check = ok => { if (!ok) throw Error('WALLET_READ_COMPOSITION_REFUSED'); };
export function composeWalletReadRuntime({ sources = null, fundsReader = null, nftInventoryReader = null, now = Date.now } = {}) {
  if (sources === null) return Object.freeze({ fundsReader, nftInventoryReader,
    state: fundsReader !== null && nftInventoryReader !== null ? 'configured' : fundsReader !== null || nftInventoryReader !== null ? 'partial' : 'unavailable',
    codes: Object.freeze([...(fundsReader === null ? ['FUNDS_SOURCE_UNBOUND'] : []), ...(nftInventoryReader === null ? ['NFT_SOURCE_UNBOUND'] : [])]) });
  check(sources && typeof sources === 'object' && !Array.isArray(sources) &&
    Reflect.ownKeys(sources).every(k => ['rpcForPrincipal', 'ledgerReader', 'nftDiscovery', 'nftLogDiscovery', 'nftDetailsReader'].includes(k)));
  const { rpcForPrincipal = null, ledgerReader = null, nftDiscovery = null,
    nftLogDiscovery = null, nftDetailsReader = null } = sources;
  check(rpcForPrincipal === null || typeof rpcForPrincipal === 'function');
  check(ledgerReader === null || typeof ledgerReader.readForPrincipal === 'function');
  check(nftDiscovery === null || typeof nftDiscovery.listForPrincipal === 'function');
  check(nftDetailsReader === null || typeof nftDetailsReader.readForPrincipal === 'function');
  check(nftDiscovery === null || nftLogDiscovery === null);
  const readonlyRpc = rpcForPrincipal === null ? null : async principal => {
    const port = await rpcForPrincipal(principal); check(port && typeof port.request === 'function');
    const request = port.request.bind(port);
    return Object.freeze({ request({ method, params }) {
      check(READ_METHODS.has(method) && Array.isArray(params));
      return request({ method, params: structuredClone(params) });
    } });
  };
  const discovery = nftDiscovery ?? (nftLogDiscovery === null || readonlyRpc === null ? null :
    createErc721LogDiscovery({ ...nftLogDiscovery, rpcForPrincipal: readonlyRpc, now }));
  const composedFunds = readonlyRpc !== null && ledgerReader !== null ? createRpcFundsReader({ ledgerReader, rpcForPrincipal: readonlyRpc, now }) : null;
  const composedNft = readonlyRpc !== null && discovery !== null ? createRpcNftInventoryReader({ discovery, rpcForPrincipal: readonlyRpc, detailsReader: nftDetailsReader, now }) : null;
  check(fundsReader === null || composedFunds === null); check(nftInventoryReader === null || composedNft === null);
  const funds = fundsReader ?? composedFunds, nft = nftInventoryReader ?? composedNft;
  return Object.freeze({ fundsReader: funds, nftInventoryReader: nft,
    state: funds !== null && nft !== null ? 'configured' : funds !== null || nft !== null ? 'partial' : 'unavailable',
    codes: Object.freeze([...(funds === null ? ['FUNDS_SOURCE_UNBOUND'] : []), ...(nft === null ? ['NFT_SOURCE_UNBOUND'] : [])]) });
}
