/** Original ERC721 ABI, synthetic receipts only. No signing, listener or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256,ZeroAddress} from 'ethers';
import {normalizeTestNFT721Bindings,verifyTestNFT721OperationPreflight,readTestNFT721OperationResult} from '../server/task-test-nft721-binding.mjs';
const h=n=>'0x'+n.repeat(64),actor='0x'+'1'.repeat(40),collection='0x'+'2'.repeat(40),code='0x6000',tx=h('a'),block=h('b');
const abi=new Interface([
 'function issuer() view returns(address)','function taskId() view returns(bytes32)',
 'function tokenBySourceHash(bytes32) view returns(uint256)',
 'function testSource(uint256) view returns(tuple(bytes32 sourceHash,bytes32 metadataHash,uint8 assetKind))',
 'function ownerOf(uint256) view returns(address)','function tokenURI(uint256) view returns(string)',
 'event TestNFTMinted(uint256 indexed tokenId,bytes32 indexed taskId,bytes32 indexed sourceHash,address issuer,uint8 assetKind,bytes32 metadataHash,string metadataURI)',
 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
function fixture() {
 const operation={kind:'artfi-test-nft721-mint',taskId:'wallet:mint:1',sourceTaskId:'producer:task:original',taskIdBytes32:h('3'),
   artifactDigest:h('4'),chainId:'560048',actor,collection:{contract:collection,runtimeCodeHash:keccak256(code)},sourceHash:h('5'),
   assetKind:1,metadataHash:h('6'),metadataURI:'ipfs://synthetic-test-only'};
 const row={taskId:operation.taskId,binding:{schema:'8415-hoodi-test-nft-deployment/1',artifactDigest:operation.artifactDigest,chainId:'560048',
   collection,runtimeCodeHash:keccak256(code),issuer:actor,taskId:operation.sourceTaskId,taskIdBytes32:operation.taskIdBytes32}};
 const bindings=normalizeTestNFT721Bindings([row]),calls=[],state={canonical:block,token:11n,owner:actor,sourceHash:operation.sourceHash};
 const log=(name,args)=>({...abi.encodeEventLog(abi.getEvent(name),args),address:collection,blockHash:block,transactionHash:tx,removed:false});
 const logs=[log('TestNFTMinted',[11n,operation.taskIdBytes32,operation.sourceHash,actor,operation.assetKind,operation.metadataHash,operation.metadataURI]),
   log('Transfer',[ZeroAddress,actor,11n])];
 const receipt={transactionHash:tx,status:'0x1',from:actor,to:collection,blockNumber:'0x10',blockHash:block,logs};
 const provider={async request({method,params=[]}) {
   calls.push(method);
   if(method==='eth_chainId')return '0x88bb0';
   if(method==='eth_getBlockByNumber')return {number:'0x10',hash:state.canonical};
   if(method==='eth_getCode')return code;
   if(method==='eth_getTransactionReceipt')return structuredClone(receipt);
   if(method==='eth_call'){
     const parsed=abi.parseTransaction({data:params[0].data}),name=parsed.name;
     const value=name==='issuer'?actor:name==='ownerOf'?state.owner:name==='taskId'?operation.taskIdBytes32:
       name==='tokenBySourceHash'?state.token:name==='tokenURI'?operation.metadataURI:[state.sourceHash,operation.metadataHash,operation.assetKind];
     return abi.encodeFunctionResult(name,[value]);
   }
   assert.fail('Unexpected/write RPC '+method);
 }};
 return {operation,bindings,provider,transactionHash:tx,state,receipt,calls};
}
test('actual receipt-derived ERC721 token keeps both task identities and exact reviewed artifact pin',async()=>{
 const f=fixture(),result=await readTestNFT721OperationResult(f);
 assert.equal(result.schema,'8415-wallet-test-nft721-result/1');assert.equal(result.taskId,f.operation.taskId);
 assert.equal(result.sourceTaskId,f.operation.sourceTaskId);assert.equal(result.taskIdBytes32,f.operation.taskIdBytes32);
 assert.equal(result.artifactDigest,f.operation.artifactDigest);assert.equal(result.tokenId,'11');assert.equal(result.quantity,'1');
 assert.equal(f.calls.some(m=>/sign|send|accounts/.test(m)),false);
 assert.equal(result.finality,'canonical-at-observed-block-not-finality');
});
test('provider-time input mutation cannot relabel the captured task or artifact after verification',async()=>{
 const f=fixture(),original=f.provider.request.bind(f.provider),taskId=f.operation.taskId,artifactDigest=f.operation.artifactDigest;
 let mutated=false;
 f.provider={async request(args){if(!mutated){mutated=true;f.operation.taskId='mutated:task';f.operation.artifactDigest=h('e');}
   return original(args);}};
 const result=await readTestNFT721OperationResult(f);
 assert.equal(result.taskId,taskId);assert.equal(result.artifactDigest,artifactDigest);
});
test('normalized mint preflight uses only original contract reads and never predicts an ID',async()=>{
 const f=fixture();f.state.token=0n;
 const result=await verifyTestNFT721OperationPreflight({...f,snapshotBlock:'0x10'});
 assert.equal(result.valueWei,'0');assert.equal(result.to,f.operation.collection.contract);
 assert.equal(Object.hasOwn(result,'tokenId'),false);assert.equal(f.calls.some(m=>/sign|send|accounts/.test(m)),false);
});
test('unadmitted task or altered artifact refuses before provider calls',async()=>{
 for(const patch of [{taskId:'different'},{sourceTaskId:'different'},{artifactDigest:h('9')},{taskIdBytes32:h('9')}]) {
   const f=fixture();f.operation={...f.operation,...patch};
   await assert.rejects(readTestNFT721OperationResult(f),/NOT_ADMITTED/);assert.equal(f.calls.length,0);
 }
});
test('missing pair event, canonical drift or wrong owner/source mappings cannot become mint evidence',async()=>{
 for(const mutate of [f=>{f.receipt.logs.pop();},f=>{f.receipt.logs[0].removed=true;},f=>{f.state.canonical=h('c');},
   f=>{f.state.owner=collection;},f=>{f.state.sourceHash=h('d');},f=>{f.state.token=12n;}]) {
   const f=fixture();mutate(f);await assert.rejects(readTestNFT721OperationResult(f));
 }
});

