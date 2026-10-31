/** Read-only balances joined to an independently supplied original-principal ledger.
 * The ledger owns currency coverage and escrow truth. RPC balances never create
 * a complete ledger, release a reservation, or supply spending authority. */
import { encodeCall } from '../src/codec/abi.ts';
import { buildCurrencyFunds } from '../src/wallet/currencyFunds.ts';
const check = ok => { if (!ok) throw Error('FUNDS_RPC_READER_REFUSED'); };
const quantity = v => typeof v === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v);
const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const word = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export function createRpcFundsReader({ ledgerReader, rpcForPrincipal, now = Date.now, lifetimeMs = 30000 }) {
  check(ledgerReader && typeof ledgerReader.readForPrincipal === 'function' && typeof rpcForPrincipal === 'function' &&
    typeof now === 'function' && Number.isSafeInteger(lifetimeMs) && lifetimeMs > 0 && lifetimeMs <= 60000);
  const readLedger = ledgerReader.readForPrincipal.bind(ledgerReader);
  return Object.freeze({ async readForPrincipal({ principal, readId }) {
    check(principal && typeof principal.account === 'string' && /^0x[0-9a-f]{40}$/.test(principal.account) &&
      !/^0x0+$/.test(principal.account) && typeof principal.chainId === 'string' &&
      /^(?:0|[1-9][0-9]{0,77})$/.test(principal.chainId) && BigInt(principal.chainId) > 0n &&
      BigInt(principal.chainId) < 1n << 256n && typeof readId === 'string' && /^[0-9a-f]{32}$/.test(readId));
    const scope = Object.freeze(structuredClone(principal));
    const rpc = await rpcForPrincipal(scope); check(rpc && typeof rpc.request === 'function');
    const request = rpc.request.bind(rpc), read = (method, params) => request({ method, params });
    const verifyChain = async () => { const chain = await read('eth_chainId', []);
      check(quantity(chain) && BigInt(chain).toString() === scope.chainId); };
    await verifyChain();
    const block = await read('eth_getBlockByNumber', ['finalized', false]);
    check(block && quantity(block.number) && hash(block.hash));
    const blockNumber = block.number, blockHash = block.hash;
    const source = structuredClone(await readLedger(Object.freeze({ principal: scope, readId, blockNumber, blockHash })));
    check(exact(source, ['scope', 'readId', 'observedAt', 'validUntil', 'inventoryState', 'blockNumber', 'blockHash', 'currencies']) &&
      exact(source.scope, Object.keys(scope)) && Object.keys(scope).every(k => source.scope[k] === scope[k]) &&
      source.readId === readId && source.blockNumber === blockNumber && source.blockHash === blockHash &&
      ['complete', 'partial', 'stale', 'unavailable'].includes(source.inventoryState) &&
      Number.isSafeInteger(source.observedAt) && source.observedAt >= 0 && source.observedAt <= now() &&
      Number.isSafeInteger(source.validUntil) && source.validUntil >= source.observedAt &&
      Array.isArray(source.currencies) && source.currencies.length <= 256);
    const inventoryState = source.inventoryState === 'unavailable' ? 'unavailable' :
      source.inventoryState === 'stale' || source.validUntil <= now() ? 'stale' : source.inventoryState;
    const currencies = [], seen = new Set();
    for (const row of source.currencies) {
      check(exact(row, ['currency', 'escrowState', 'escrows']) &&
        exact(row.currency, ['chainId', 'kind', 'contract', 'decimals']) && row.currency.chainId === scope.chainId &&
        Array.isArray(row.escrows) && row.escrows.length <= 4096);
      const currency = row.currency, key = `${currency.chainId}:${currency.kind}:${currency.contract}`;
      check(!seen.has(key)); seen.add(key);
      const input = { ...row, balanceBasis: 'wallet-liquid', balanceBaseUnits: null, blockHash,
        state: inventoryState === 'stale' || inventoryState === 'unavailable' ? inventoryState : 'ready' };
      // Validate currency and coverage even when balances must remain suppressed.
      buildCurrencyFunds({ ...input, state: 'unavailable' });
      if (input.state === 'ready') {
        if (currency.kind === 'native') {
          const balance = await read('eth_getBalance', [scope.account, blockNumber]);
          check(quantity(balance)); input.balanceBaseUnits = BigInt(balance).toString();
        } else {
          const code = await read('eth_getCode', [currency.contract, blockNumber]);
          check(typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/.test(code));
          const call = data => read('eth_call', [{ to: currency.contract, data }, blockNumber]);
          const decimals = await call(encodeCall('decimals()', [], []));
          check(word(decimals) && BigInt(decimals) === BigInt(currency.decimals));
          const balance = await call(encodeCall('balanceOf(address)', ['address'], [scope.account]));
          check(word(balance)); input.balanceBaseUnits = BigInt(balance).toString();
        }
        // Validates original reservation identity, common block and exact uint256 arithmetic.
        // An UNKNOWN line deliberately projects unavailable; it is never dropped here.
        buildCurrencyFunds(input);
      }
      currencies.push(input);
    }
    await verifyChain();
    const after = await read('eth_getBlockByNumber', [blockNumber, false]);
    check(after && after.number === blockNumber && after.hash === blockHash);
    const finished = now(); check(Number.isSafeInteger(finished) && finished >= source.observedAt && Number.isSafeInteger(finished + lifetimeMs));
    const validUntil = Math.min(source.validUntil, finished + lifetimeMs);
    return { schema: '8415-authoritative-funds/1', scope: { ...scope }, readId,
      observedAt: source.observedAt, validUntil,
      inventoryState: inventoryState === 'unavailable' ? 'unavailable' : validUntil <= finished ? 'stale' : inventoryState,
      currencies };
  } });
}
