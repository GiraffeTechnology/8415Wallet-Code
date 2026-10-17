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

const onHoodi=block=>({async request({method}){return method==='eth_chainId'?'0x88bb0':block;}});
test('a block zero that is missing, renumbered or unhashed is refused, and case is not significant',async()=>{
  for(const block of [null,undefined,{number:'0x1',hash:HOODI_GENESIS},{number:'0x0',hash:null},
      {number:'0x0'},{number:'0x0',hash:HOODI_GENESIS.slice(0,-1)+'c'}]) {
    await assert.rejects(verifyTaskExactChain(onHoodi(block),'560048'),/GENESIS_REFUSED|QUANTITY_REFUSED/);
  }
  // The same genesis in upper case is the same block, and is accepted.
  await verifyTaskExactChain(onHoodi({number:'0x0',hash:'0x'+HOODI_GENESIS.slice(2).toUpperCase()}),'560048');
});
test('a chain that answers with another id or a malformed quantity is refused before any block read',async()=>{
  for(const [answer,expected] of [['0x1',/CHAIN_ID_REFUSED/],['0xaa36a7',/CHAIN_ID_REFUSED/],
      ['0x',/QUANTITY_REFUSED/],['0x0001',/QUANTITY_REFUSED/],['560048',/QUANTITY_REFUSED/],[null,/QUANTITY_REFUSED/]]) {
    const methods=[];
    await assert.rejects(verifyTaskExactChain({async request({method}){methods.push(method);
      if(method==='eth_chainId')return answer;assert.fail('refused chains must not reach a block read');}},'560048'),expected);
    assert.deepEqual(methods,['eth_chainId']);
  }
});
test('the funding summary is frozen and reports the block it was read at',async()=>{
  const provider={async request(){return '0x'+(10n**21n).toString(16);}};
  const summary=await verifyTaskExactFunding(provider,{actor,valueWei:'1',gasLimit:'21000',maxFeePerGasWei:'2',block:'0x2a'});
  assert.ok(Object.isFrozen(summary));
  assert.equal(summary.block,'0x2a');
  assert.equal(summary.maximumCostWei,(1n+21000n*2n).toString());
});
