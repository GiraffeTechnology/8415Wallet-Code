import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256, ZeroAddress } from 'ethers';
import { normalizeTestNFT721Mint, encodeTestNFT721Mint, verifyTestNFT721MintPreflight, readTestNFT721MintResult } from '../server/task-test-nft721-contract.mjs';
const h=n=>'0x'+n.repeat(64), actor='0x'+'1'.repeat(40), collection='0x'+'2'.repeat(40), code='0x6000', tx=h('a'), block=h('b');
const request=()=>({schema:'8415-artfi-test-nft721-mint/1',taskId:'synthetic:original-full-task',taskIdBytes32:h('3'),
  chainId:'560048',actor,collection,runtimeCodeHash:keccak256(code),sourceHash:h('4'),assetKind:0,
  metadataHash:h('5'),metadataURI:'ipfs://synthetic-test-only'});
const binding=r=>({schema:'8415-hoodi-test-nft-deployment/1',artifactDigest:h('6'),chainId:r.chainId,
  collection:r.collection,runtimeCodeHash:r.runtimeCodeHash,issuer:r.actor,taskId:r.taskId,taskIdBytes32:r.taskIdBytes32});
const abi=new Interface([
  'function mintTestNFT(bytes32,uint8,bytes32,string) returns(uint256)',
  'function issuer() view returns(address)','function taskId() view returns(bytes32)',
  'function tokenBySourceHash(bytes32) view returns(uint256)',
  'function testSource(uint256) view returns(tuple(bytes32 sourceHash,bytes32 metadataHash,uint8 assetKind))',
  'function ownerOf(uint256) view returns(address)','function tokenURI(uint256) view returns(string)',
  'event TestNFTMinted(uint256 indexed tokenId,bytes32 indexed taskId,bytes32 indexed sourceHash,address issuer,uint8 assetKind,bytes32 metadataHash,string metadataURI)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
function fixture({wrongTask=false,omitTransfer=false}={}) {
  const r=request(), calls=[]; let observed=false;
  const log=(name,args)=>({...abi.encodeEventLog(abi.getEvent(name),args),address:collection,blockHash:block,transactionHash:tx,removed:false});
  const logs=[log('TestNFTMinted',[11n,r.taskIdBytes32,r.sourceHash,actor,r.assetKind,r.metadataHash,r.metadataURI]),
    ...(omitTransfer?[]:[log('Transfer',[ZeroAddress,actor,11n])])];
  const provider={async request({method,params}) {
    calls.push(method);
    if(method==='eth_chainId')return '0x88bb0';
    if(method==='eth_getBlockByNumber')return {number:'0x10',hash:block};
    if(method==='eth_getCode')return code;
    if(method==='eth_getTransactionReceipt'){observed=true;return {transactionHash:tx,status:'0x1',from:actor,to:collection,blockNumber:'0x10',blockHash:block,logs};}
    if(method==='eth_call') {
      const parsed=abi.parseTransaction({data:params[0].data}), name=parsed.name;
      const value=name==='issuer'||name==='ownerOf'?actor:name==='taskId'?(wrongTask?h('9'):r.taskIdBytes32):
        name==='tokenBySourceHash'?(observed?11n:0n):name==='tokenURI'?r.metadataURI:[r.sourceHash,r.metadataHash,r.assetKind];
      return abi.encodeFunctionResult(name,[value]);
    }
    assert.fail('Unexpected write RPC '+method);
  }};
  return {request:r,binding:binding(r),provider,calls};
}
test('fixed ERC721 four-argument encoding keeps producer task-ID mapping separate',()=>{
  const r=request(), wire=encodeTestNFT721Mint(r), parsed=abi.parseTransaction({data:wire.data});
  assert.equal(wire.valueWei,'0');assert.equal(parsed.name,'mintTestNFT');assert.equal(parsed.args.length,4);
  assert.equal(parsed.args[0],r.sourceHash);assert.equal(parsed.args[1],0n);
  assert.equal(normalizeTestNFT721Mint(r).taskIdBytes32,r.taskIdBytes32);
  assert.throws(()=>normalizeTestNFT721Mint({...r,tokenId:'1'}),/SCHEMA_REFUSED/);
});
test('wrong asset kind, chain, whitespace URI and arbitrary calldata are refused',()=>{
  for(const patch of [{assetKind:2},{chainId:'11155111'},{metadataURI:'ipfs://has space'},{data:'0x'}])
    assert.throws(()=>normalizeTestNFT721Mint({...request(),...patch}),/REFUSED/);
});
test('preflight requires artifact/deployment binding and immutable issuer/task without predicting token',async()=>{
  const f=fixture(), out=await verifyTestNFT721MintPreflight({...f,allowedWallets:[actor]});
  assert.equal(out.blockHash,block);assert.equal(Object.hasOwn(out,'tokenId'),false);
  assert.equal(f.calls.some(m=>/sign|send/.test(m)),false);
  const mismatch=fixture({wrongTask:true});
  await assert.rejects(verifyTestNFT721MintPreflight({...mismatch,allowedWallets:[actor]}),/IMMUTABLE_BINDING_REFUSED/);
  const absent=fixture();
  await assert.rejects(verifyTestNFT721MintPreflight({...absent,binding:null,allowedWallets:[actor]}),/SCHEMA_REFUSED/);
  assert.equal(absent.calls.length,0);
});
test('actual ERC721 mint result requires both events plus immutable and source/owner/URI mapping',async()=>{
  const f=fixture(), result=await readTestNFT721MintResult({...f,transactionHash:tx});
  assert.equal(result.tokenId,'11');assert.equal(result.standard,'ERC-721');assert.equal(result.quantity,'1');
  assert.equal(result.taskIdBytes32,f.request.taskIdBytes32);assert.equal(result.testOnly,true);
  const absent=fixture({omitTransfer:true});
  await assert.rejects(readTestNFT721MintResult({...absent,transactionHash:tx}),/EVENT_REFUSED/);
});

