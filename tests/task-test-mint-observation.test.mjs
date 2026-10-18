// Synthetic read-only fixtures; not deployed-contract or chain acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interface, keccak256, ZeroAddress } from 'ethers';
import { freezeTaskPolicy, freezeChildOperation } from '../src/agent/taskContract.ts';
import { createTaskReceiptAdapter } from '../server/task-receipt-adapter.mjs';
import { encodeTestSeriesMint, testSeriesMintRequest } from '../server/task-test-mint-contract.mjs';
const a=n=>'0x'+n.repeat(40), h=n=>'0x'+n.repeat(64);
const actor=a('1'), recipient=a('2'), collection=a('3'), transactionHash=h('a'), blockHash=h('b');
const abi=new Interface([
  'function tokenByArtworkId(bytes32) view returns(uint256)',
  'function tokenByMasterArtworkHash(bytes32) view returns(uint256)', 'function uri(uint256) view returns(string)',
  'event SeriesCreated(uint256 indexed tokenId,bytes32 indexed artworkId,bytes32 indexed masterArtworkHash,address distributionWallet,bytes32 metadataHash,string metadataURI)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)', 'event URI(string value,uint256 indexed id)',
]);
function fixture() {
  const code='0x6000', operation={ kind:'artfi-test-series-mint',chainId:'560048',actor,taskId:'synthetic:mint',
    collection:{contract:collection,runtimeCodeHash:keccak256(code)}, artworkId:h('4'),masterArtworkHash:h('5'),metadataHash:h('6'),
    distributionWallet:recipient,metadataURI:'ipfs://synthetic-test-only' };
  const task=freezeTaskPolicy({schema:'8415-agent-task/1',taskId:operation.taskId,tenant:'default',origin:'https://wallet.example',
    chainId:'560048',actor,expiresAt:'2000',fees:{perOperationWei:'1000000',totalWei:'1000000'},intent:{kind:'exact-operation',operation}});
  const wire=encodeTestSeriesMint(testSeriesMintRequest(operation));
  const child=freezeChildOperation({schema:'8415-agent-child/1',operationId:'mint-op',taskDigest:task.digest,operation,nonce:'1',expiresAt:'1500',
    wire:{to:wire.to,calldataHash:keccak256(wire.data),valueWei:'0'},fees:{gasLimit:'100000',maxFeePerGasWei:'10'},market:null});
  const input={task,child,executor:{digest:h('d')},attempt:{executorDigest:h('d'),grantPolicyVersion:'1',transactionHash},observationPolicy:{minimumConfirmations:'2'}};
  const log=(name,args)=>({...abi.encodeEventLog(abi.getEvent(name),args),address:collection,transactionHash,blockHash,blockNumber:'0x64',transactionIndex:'0x0',removed:false});
  const receipt={transactionHash,from:actor,to:collection,blockHash,blockNumber:'0x64',transactionIndex:'0x0',status:'0x1',logs:[
    log('SeriesCreated',[9n,operation.artworkId,operation.masterArtworkHash,recipient,operation.metadataHash,operation.metadataURI]),
    log('TransferSingle',[actor,ZeroAddress,recipient,9n,100n]),log('URI',[operation.metadataURI,9n])]};
  const tx={hash:transactionHash,from:actor,to:collection,nonce:'0x1',value:'0x0',input:wire.data,chainId:'0x88bb0',
    blockHash,blockNumber:'0x64',transactionIndex:'0x0',gas:'0x186a0',maxFeePerGas:'0xa'};
  const state={pending:false,head:'0x65',canonical:blockHash},calls=[];
  const provider={async request({method,params=[]}) {
    calls.push(method);
    if(method==='eth_chainId')return '0x88bb0';
    // Block zero is what the fixed-genesis check reads; a case can replace it.
    if(method==='eth_getBlockByNumber' && params[0]==='0x0')return state.genesis===null?null
      :{number:'0x0',hash:state.genesis??'0xbbe312868b376a3001692a646dd2d7d1e4406380dfd86b98aa8a34d1557c971b'};
    if(method==='eth_getCode')return code;
    if(method==='eth_getTransactionReceipt')return state.pending?null:structuredClone(receipt);
    if(method==='eth_getTransactionByHash')return structuredClone(tx);
    if(method==='eth_getBlockByNumber')return {number:'0x64',hash:state.canonical};
    if(method==='eth_blockNumber')return state.head;
    if(method==='eth_call'){const parsed=abi.parseTransaction({data:params[0].data});return abi.encodeFunctionResult(parsed.name,[parsed.name==='uri'?operation.metadataURI:9n]);}
    assert.fail('Unexpected/write RPC '+method);
  }};
  return {input,receipt,tx,state,calls,adapter:createTaskReceiptAdapter({provider,observationPolicy:input.observationPolicy,now:()=>2500000})};
}
test('mint observer binds actual events, transaction and depth, then returns the same concrete token',async()=>{
  const f=fixture(), observation=await f.adapter.observe(f.input), result=await f.adapter.observeMintResult(f.input,observation);
  assert.equal(observation.state,'confirmed-at-depth');assert.equal(observation.effect,'exact-operation-observed');
  assert.equal(result.tokenId,'9');assert.equal(result.quantity,'100');assert.equal(result.transactionHash,transactionHash);
  const record={schema:'8415-task-test-mint-inventory/1',available:true,input:f.input,result,
    sourceTaskDigest:f.input.task.digest,sourceChildDigest:f.input.child.digest};
  assert.equal(await f.adapter.verifyMintInventoryRecord(record),true);
  for(const changes of [{tokenId:'8'},{issuer:recipient},{runtimeCodeHash:h('f')},{metadataURI:'ipfs://other'},{finality:'finalized'}])
    assert.equal(await f.adapter.verifyMintInventoryRecord({...record,result:{...result,...changes}}),false);
  assert.equal(f.calls.some(m=>/send|sign|accounts/.test(m)),false);
});
test('mint pending, shallow, reverted and reorg observations cannot supply inventory evidence',async()=>{
  for(const change of [f=>{f.state.pending=true;},f=>{f.state.head='0x64';},f=>{f.receipt.status='0x0';},f=>{f.state.canonical=h('c');}]) {
    const f=fixture();change(f);const observation=await f.adapter.observe(f.input);
    assert.notEqual(observation.state,'confirmed-at-depth');assert.equal(observation.effect,'not-established');
    await assert.rejects(f.adapter.observeMintResult(f.input,observation));
  }
});
test('mint observation rejects foreign calldata, fees, recipient or removed event',async()=>{
  for(const change of [f=>{f.tx.input='0x';},f=>{f.tx.maxFeePerGas='0xb';},f=>{f.receipt.to=actor;},f=>{f.receipt.logs[0].removed=true;}]) {
    const f=fixture();change(f);await assert.rejects(f.adapter.observe(f.input));
  }
});
const moduleText=readFileSync(new URL('../web/task-authorization.mjs',import.meta.url),'utf8')
  .replace('./task-listing-results.mjs',new URL('../web/task-listing-results.mjs',import.meta.url).href)
  .replace('./observation-source-contract.mjs',new URL('../web/observation-source-contract.mjs',import.meta.url).href)
  .replace('./task-observer-context.mjs',new URL('../web/task-observer-context.mjs',import.meta.url).href)
  .replace('../dist/browser/agent/taskContract.js',new URL('../src/agent/taskContract.ts',import.meta.url).href)
  .replace('../dist/browser/agent/receiptTask.js',new URL('../src/agent/receiptTask.ts',import.meta.url).href)
  .replace('../dist/browser/agent/receiptObservation.js',new URL('../src/agent/receiptObservation.ts',import.meta.url).href)
  .replace('../dist/browser/vendor/ethers.js',import.meta.resolve('ethers'));
const {normalizeTestMintResult}=await import('data:text/javascript;base64,'+Buffer.from(moduleText).toString('base64'));
test('browser mint evidence preserves actual token while refusing extra or unbound fields',async()=>{
  const f=fixture(), observation=await f.adapter.observe(f.input), result=await f.adapter.observeMintResult(f.input,observation);
  assert.deepEqual(normalizeTestMintResult(result,f.input.task,observation),result);
  for(const raw of [{...result,tokenId:'09'},{...result,transactionHash:h('e')},{...result,quantity:'99'},{...result,finality:'finalized'},{...result,approval:true}])
    assert.throws(()=>normalizeTestMintResult(raw,f.input.task,observation));
  assert.throws(()=>normalizeTestMintResult(result,f.input.task,{...observation,state:'reorged'}));
  assert.equal(normalizeTestMintResult(null,f.input.task,null),null);
});


test('a receipt observed on another genesis supplies no observation at all',async()=>{
  // The same receipt, events and depth as the passing case above: only block
  // zero differs. Chain560048 with another genesis is another chain, and a
  // mined receipt read there is not evidence about this one.
  for(const genesis of [`0x${'c'.repeat(64)}`,null]) {
    const f=fixture();f.state.genesis=genesis;
    await assert.rejects(f.adapter.observe(f.input),/TASK_EXACT_HOODI_GENESIS_REFUSED/);
    assert.deepEqual(f.calls.filter(m=>m==='eth_getTransactionReceipt'),[],'a refused chain was still read for a receipt');
  }
});
