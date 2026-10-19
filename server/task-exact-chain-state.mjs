/** Exact-chain and maximum-cost checks. Read-only; no funding, fee defaults or retries. */
export const HOODI_GENESIS = '0xbbe312868b376a3001692a646dd2d7d1e4406380dfd86b98aa8a34d1557c971b';
const quantity = v => {
  if (typeof v !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(v)) throw Error('TASK_EXACT_CHAIN_QUANTITY_REFUSED');
  return BigInt(v);
};
export async function verifyTaskExactChain(provider, chainId) {
  if (quantity(await provider.request({method:'eth_chainId',params:[]})) !== BigInt(chainId)) throw Error('TASK_EXACT_CHAIN_ID_REFUSED');
  if (chainId === '560048') {
    const block = await provider.request({method:'eth_getBlockByNumber',params:['0x0',false]});
    if (!block || quantity(block.number) !== 0n || typeof block.hash !== 'string' ||
        block.hash.toLowerCase() !== HOODI_GENESIS) throw Error('TASK_EXACT_HOODI_GENESIS_REFUSED');
    if (quantity(await provider.request({method:'eth_chainId',params:[]})) !== 560048n) throw Error('TASK_EXACT_CHAIN_ID_REFUSED');
  }
}
export async function verifyTaskExactFunding(provider, {actor,valueWei,gasLimit,maxFeePerGasWei,block='pending'}) {
  // All values come from the already normalized child/encoding or planner result.
  const required = BigInt(valueWei) + BigInt(gasLimit) * BigInt(maxFeePerGasWei);
  if (required < 0n || required >= (1n << 256n)) throw Error('TASK_EXACT_COST_OVERFLOW');
  const balance = quantity(await provider.request({method:'eth_getBalance',params:[actor,block]}));
  if (balance < required) throw Error('TASK_EXACT_BALANCE_INSUFFICIENT');
  return Object.freeze({balanceWei:balance.toString(),maximumCostWei:required.toString(),block});
}

