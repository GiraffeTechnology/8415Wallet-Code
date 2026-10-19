import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256, ZeroAddress } from 'ethers';
import { normalizeTestSeriesMint, encodeTestSeriesMint, verifyTestSeriesMintPreflight, readTestSeriesMintResult } from '../server/task-test-mint-contract.mjs';
const actor='0x'+'1'.repeat(40), recipient='0x'+'2'.repeat(40), collection='0x'+'3'.repeat(40);
const h=n=>'0x'+n.repeat(64), tx=h('a'), block=h('b'), code='0x6000';
const r=()=>({schema:'8415-artfi-test-series-mint/1',taskId:'synthetic:mint',chainId:'560048',actor,collection,
  runtimeCodeHash:keccak256(code),artworkId:h('4'),masterArtworkHash:h('5'),metadataHash:h('6'),
  distributionWallet:recipient,metadataURI:'ipfs://synthetic-test-only'});
const abi=new Interface([
  'function createSeries(bytes32,bytes32,bytes32,address,string) returns(uint256)',
  'function hasRole(bytes32,address) view returns(bool)','function paused() view returns(bool)',
  'function EDITIONS_PER_ARTWORK() view returns(uint256)','function tokenByArtworkId(bytes32) view returns(uint256)',
  'function tokenByMasterArtworkHash(bytes32) view returns(uint256)','function uri(uint256) view returns(string)',
  'event SeriesCreated(uint256 indexed tokenId,bytes32 indexed artworkId,bytes32 indexed masterArtworkHash,address distributionWallet,bytes32 metadataHash,string metadataURI)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event URI(string value,uint256 indexed id)',
]);
function fixture({role=true,paused=false,quantity=100n,reorg=false}={}) {
  const request=r(), calls=[];
  const log=(name,args)=>({...abi.encodeEventLog(abi.getEvent(name),args),address:collection,blockHash:block,transactionHash:tx,removed:false});
  const logs=[log('SeriesCreated',[9n,request.artworkId,request.masterArtworkHash,recipient,request.metadataHash,request.metadataURI]),
    log('TransferSingle',[actor,ZeroAddress,recipient,9n,quantity]),log('URI',[request.metadataURI,9n])];
  let receiptMode=false;
  const provider={async request({method,params}) {
    calls.push(method);
    if(method==='eth_chainId')return '0x88bb0';
    if(method==='eth_getBlockByNumber')return {number:'0x10',hash:reorg?h('c'):block};
    if(method==='eth_getCode')return code;
    if(method==='eth_getTransactionReceipt'){receiptMode=true;return {transactionHash:tx,status:'0x1',from:actor,to:collection,blockNumber:'0x10',blockHash:block,logs};}
    if(method==='eth_call') {
      const parsed=abi.parseTransaction({data:params[0].data}), name=parsed.name;
      const value=name==='hasRole'?role:name==='paused'?paused:name==='EDITIONS_PER_ARTWORK'?100n:name==='uri'?request.metadataURI:receiptMode?9n:0n;
      return abi.encodeFunctionResult(name,[value]);
    }
    assert.fail('Write/unexpected RPC '+method);
  }};
  return {request,provider,calls};
}
test('typed mint encodes only the original five-field createSeries with zero value',()=>{
  const request=r(), wire=encodeTestSeriesMint(request);
  assert.equal(wire.valueWei,'0');assert.equal(wire.to,collection);
  const decoded=abi.parseTransaction({data:wire.data});
  assert.equal(decoded.name,'createSeries');assert.equal(decoded.args.length,5);
  assert.deepEqual([...decoded.args].slice(0,3),[request.artworkId,request.masterArtworkHash,request.metadataHash]);
  assert.throws(()=>normalizeTestSeriesMint({...request,data:'0x1234'}),/SCHEMA_REFUSED/);
  assert.throws(()=>normalizeTestSeriesMint({...request,chainId:'11155111'}),/SCOPE_REFUSED/);
});
test('planned mint preflight checks pinned code, creator role, pause and uniqueness using reads only',async()=>{
  const f=fixture(), out=await verifyTestSeriesMintPreflight({...f,allowedWallets:[actor,recipient]});
  assert.equal(out.blockHash,block);assert.equal(out.valueWei,'0');
  assert.equal(f.calls.some(m=>/send|sign/.test(m)),false);
});
test('wrong role, paused contract or unapproved recipient refuses planned mint',async()=>{
  for(const options of [{role:false},{paused:true}]) {
    const f=fixture(options);
    await assert.rejects(verifyTestSeriesMintPreflight({...f,allowedWallets:[actor,recipient]}),/PREFLIGHT_REFUSED/);
  }
  const f=fixture();
  await assert.rejects(verifyTestSeriesMintPreflight({...f,allowedWallets:[actor]}),/WALLET_REFUSED/);
});
test('mint result records token ID from actual matching events, not a predicted series counter',async()=>{
  const f=fixture(), result=await readTestSeriesMintResult({...f,transactionHash:tx});
  assert.equal(result.tokenId,'9');assert.equal(result.quantity,'100');assert.equal(result.testOnly,true);
  assert.equal(result.standard,'ERC-1155');assert.equal(result.finality,'canonical-at-observed-block-not-finality');
});
test('wrong minted quantity or canonical block refuses result evidence',async()=>{
  const wrong=fixture({quantity:99n});
  await assert.rejects(readTestSeriesMintResult({...wrong,transactionHash:tx}),/EVENT_REFUSED/);
  const reorg=fixture({reorg:true});
  await assert.rejects(readTestSeriesMintResult({...reorg,transactionHash:tx}),/BLOCK_CHANGED/);
});

