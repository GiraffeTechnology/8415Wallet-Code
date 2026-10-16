/** Synthetic read-only checks, not actual RPC or funding evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {HOODI_GENESIS,verifyTaskExactChain,verifyTaskExactFunding} from '../server/task-exact-chain-state.mjs';
const actor='0x'+'1'.repeat(40);
test('Hoodi ID alone is insufficient: block zero must match the fixed genesis',async()=>{
  for(const hash of ['0x'+'0'.repeat(64),'0x'+'1'.repeat(64)]) {
    const provider={async request({method}){return method==='eth_chainId'?'0x88bb0':{number:'0x0',hash};}};
    await assert.rejects(verifyTaskExactChain(provider,'560048'),/GENESIS_REFUSED/);
  }
  const methods=[],provider={async request({method,params}){methods.push(method);
    if(method==='eth_chainId')return '0x88bb0';assert.deepEqual(params,['0x0',false]);return {number:'0x0',hash:HOODI_GENESIS};}};
  await verifyTaskExactChain(provider,'560048');assert.deepEqual(methods,['eth_chainId','eth_getBlockByNumber','eth_chainId']);
});
test('genesis check preserves existing non-Hoodi chains and refuses a chain switch',async()=>{
  let reads=0;
  await verifyTaskExactChain({async request({method}){assert.equal(method,'eth_chainId');return '0xaa36a7';}},'11155111');
  await assert.rejects(verifyTaskExactChain({async request({method}){
    if(method==='eth_chainId')return ++reads===1?'0x88bb0':'0x1';return {number:'0x0',hash:HOODI_GENESIS};
  }},'560048'),/CHAIN_ID_REFUSED/);
});
test('funding uses integer value plus the exact maximum gas fee, including equality',async()=>{
  const request={actor,valueWei:'9007199254740993123',gasLimit:'21000',maxFeePerGasWei:'9007199254740993'};
  const required=BigInt(request.valueWei)+BigInt(request.gasLimit)*BigInt(request.maxFeePerGasWei);
  for(const delta of [-1n,0n,1n]) {
    const provider={async request({method,params}){assert.equal(method,'eth_getBalance');assert.deepEqual(params,[actor,'pending']);return '0x'+(required+delta).toString(16);}};
    if(delta<0n)await assert.rejects(verifyTaskExactFunding(provider,request),/BALANCE_INSUFFICIENT/);
    else assert.equal((await verifyTaskExactFunding(provider,request)).maximumCostWei,required.toString());
  }
});
test('malformed balances and uint256 cost overflow refuse without any signing or funding',async()=>{
  for(const balance of ['01','0x00','0x','0x-1',42,null])await assert.rejects(verifyTaskExactFunding({async request(){return balance;}},
    {actor,valueWei:'1',gasLimit:'1',maxFeePerGasWei:'1'}),/QUANTITY_REFUSED/);
  await assert.rejects(verifyTaskExactFunding({async request(){assert.fail('overflow must refuse before RPC');}},
    {actor,valueWei:((1n<<256n)-1n).toString(),gasLimit:'1',maxFeePerGasWei:'1'}),/COST_OVERFLOW/);
});

