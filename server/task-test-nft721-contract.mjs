/** Independent TEST-ONLY ERC721 leaf, never the Charity ERC1155/RWA path.
 * Source ArtFi PR213 c5ada0e5dc88089fa057e336b21d448853bd4151,
 * blob79544484c4ac2837d06e9f801f5d415240ddc68f.
 * No signer, broadcast, store writer, arbitrary ABI or task-ID hash derivation.
 */
import { Interface, keccak256, ZeroAddress } from 'ethers';
const abi=new Interface([
  'function mintTestNFT(bytes32,uint8,bytes32,string) returns(uint256)',
  'function issuer() view returns(address)','function taskId() view returns(bytes32)',
  'function tokenBySourceHash(bytes32) view returns(uint256)',
  'function testSource(uint256) view returns(tuple(bytes32 sourceHash,bytes32 metadataHash,uint8 assetKind))',
  'function ownerOf(uint256) view returns(address)','function tokenURI(uint256) view returns(string)',
  'event TestNFTMinted(uint256 indexed tokenId,bytes32 indexed taskId,bytes32 indexed sourceHash,address issuer,uint8 assetKind,bytes32 metadataHash,string metadataURI)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
]);
const fail=code=>{throw Error(code);};
const hash=v=>typeof v==='string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const address=v=>typeof v==='string' && /^0x[0-9a-f]{40}$/.test(v) && v!==ZeroAddress;
const same=(a,b)=>typeof a==='string' && typeof b==='string' && a.toLowerCase()===b.toLowerCase();
const identity=v=>typeof v==='string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
function fields(value,names) {
  if(!value || Object.getPrototypeOf(value)!==Object.prototype) fail('TASK_TEST_721_SCHEMA_REFUSED');
  const d=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(d).length!==names.length || names.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value'))) fail('TASK_TEST_721_SCHEMA_REFUSED');
}
export function normalizeTestNFT721Mint(input) {
  const names=['schema','taskId','taskIdBytes32','chainId','actor','collection','runtimeCodeHash','sourceHash','assetKind','metadataHash','metadataURI'];
  fields(input,names);
  const uri=input.metadataURI, bytes=typeof uri==='string'?Buffer.from(uri):null;
  if(input.schema!=='8415-artfi-test-nft721-mint/1' || input.chainId!=='560048' || !identity(input.taskId) ||
    !['taskIdBytes32','runtimeCodeHash','sourceHash','metadataHash'].every(k=>hash(input[k])) ||
    !['actor','collection'].every(k=>address(input[k])) || ![0,1].includes(input.assetKind) ||
    !bytes || bytes.length>512 || [...bytes].some(b=>b<=32||b===127) ||
    !((uri.startsWith('https://')&&bytes.length>8)||(uri.startsWith('ipfs://')&&bytes.length>7))) fail('TASK_TEST_721_SCOPE_REFUSED');
  return Object.freeze(Object.fromEntries(names.map(k=>[k,input[k]])));
}
function deployment(request,binding) {
  fields(binding,['schema','artifactDigest','chainId','collection','runtimeCodeHash','issuer','taskId','taskIdBytes32']);
  if(binding.schema!=='8415-hoodi-test-nft-deployment/1' || !hash(binding.artifactDigest) ||
    binding.chainId!==request.chainId || binding.collection!==request.collection || binding.runtimeCodeHash!==request.runtimeCodeHash ||
    binding.issuer!==request.actor || binding.taskId!==request.taskId || binding.taskIdBytes32!==request.taskIdBytes32)
    fail('TASK_TEST_721_DEPLOYMENT_BINDING_REFUSED');
  // This server-owned record must come from reviewed artifact/deployment evidence.
  // A caller-provided digest is provenance metadata, not remote attestation.
}
export function encodeTestNFT721Mint(input) {
  const r=normalizeTestNFT721Mint(input);
  return Object.freeze({to:r.collection,valueWei:'0',data:abi.encodeFunctionData('mintTestNFT',
    [r.sourceHash,r.assetKind,r.metadataHash,r.metadataURI])});
}
function reader(provider) {
  if(typeof provider?.request!=='function') fail('TASK_TEST_721_PROVIDER_REQUIRED');
  const request=provider.request.bind(provider);
  return async(method,params=[])=>{
    if(!['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getTransactionReceipt'].includes(method)) fail('TASK_TEST_721_WRITE_REFUSED');
    return structuredClone(await request({method,params:structuredClone(params)}));
  };
}
async function chain(read) {
  const value=await read('eth_chainId');
  if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value)||BigInt(value)!==560048n) fail('TASK_TEST_721_CHAIN_REFUSED');
}
async function contract(read,r,block) {
  const code=await read('eth_getCode',[r.collection,block]);
  if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||keccak256(code)!==r.runtimeCodeHash) fail('TASK_TEST_721_CODE_REFUSED');
}
async function call(read,r,name,args,block) {
  const raw=await read('eth_call',[{to:r.collection,data:abi.encodeFunctionData(name,args)},block]);
  return abi.decodeFunctionResult(name,raw)[0];
}
async function immutableBinding(read,r,block) {
  await contract(read,r,block);
  if(!same(await call(read,r,'issuer',[],block),r.actor)||await call(read,r,'taskId',[],block)!==r.taskIdBytes32)
    fail('TASK_TEST_721_IMMUTABLE_BINDING_REFUSED');
}
export async function verifyTestNFT721MintPreflight({request,binding,provider,allowedWallets,snapshotBlock='latest'}) {
  const r=normalizeTestNFT721Mint(request); deployment(r,binding);
  if(!Array.isArray(allowedWallets)||!allowedWallets.includes(r.actor)) fail('TASK_TEST_721_WALLET_REFUSED');
  const read=reader(provider); await chain(read);
  const block=await read('eth_getBlockByNumber',[snapshotBlock,false]);
  if(!block||!hash(block.hash)||typeof block.number!=='string') fail('TASK_TEST_721_BLOCK_REFUSED');
  await immutableBinding(read,r,block.number);
  if(await call(read,r,'tokenBySourceHash',[r.sourceHash],block.number)!==0n) fail('TASK_TEST_721_SOURCE_ALREADY_MINTED');
  if((await read('eth_getBlockByNumber',[block.number,false]))?.hash!==block.hash) fail('TASK_TEST_721_BLOCK_CHANGED');
  return Object.freeze({...encodeTestNFT721Mint(r),blockNumber:block.number,blockHash:block.hash});
}
export async function readTestNFT721MintResult({request,binding,provider,transactionHash}) {
  const r=normalizeTestNFT721Mint(request); deployment(r,binding); if(!hash(transactionHash)) fail('TASK_TEST_721_TX_REFUSED');
  const read=reader(provider); await chain(read);
  const receipt=await read('eth_getTransactionReceipt',[transactionHash]);
  if(!receipt||receipt.transactionHash!==transactionHash||receipt.status!=='0x1'||!same(receipt.from,r.actor)||
    !same(receipt.to,r.collection)||!hash(receipt.blockHash)||!Array.isArray(receipt.logs)) fail('TASK_TEST_721_RECEIPT_REFUSED');
  if((await read('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash) fail('TASK_TEST_721_BLOCK_CHANGED');
  await immutableBinding(read,r,receipt.blockNumber);
  const logs=[];
  for(const log of receipt.logs) if(same(log.address,r.collection)) {
    if(log.removed===true||log.blockHash!==receipt.blockHash||log.transactionHash!==transactionHash) fail('TASK_TEST_721_LOG_REFUSED');
    try { const parsed=abi.parseLog(log); if(parsed) logs.push(parsed); } catch { /* Unknown logs are not evidence. */ }
  }
  const minted=logs.filter(l=>l.name==='TestNFTMinted');
  if(minted.length!==1) fail('TASK_TEST_721_EVENT_REFUSED');
  const a=minted[0].args, tokenId=a.tokenId;
  if(tokenId<=0n||a.taskId!==r.taskIdBytes32||a.sourceHash!==r.sourceHash||!same(a.issuer,r.actor)||
    a.assetKind!==BigInt(r.assetKind)||a.metadataHash!==r.metadataHash||a.metadataURI!==r.metadataURI||
    logs.filter(l=>l.name==='Transfer'&&l.args.from===ZeroAddress&&same(l.args.to,r.actor)&&l.args.tokenId===tokenId).length!==1)
    fail('TASK_TEST_721_EVENT_REFUSED');
  const source=await call(read,r,'testSource',[tokenId],receipt.blockNumber);
  if(await call(read,r,'tokenBySourceHash',[r.sourceHash],receipt.blockNumber)!==tokenId||
    source.sourceHash!==r.sourceHash||source.metadataHash!==r.metadataHash||source.assetKind!==BigInt(r.assetKind)||
    !same(await call(read,r,'ownerOf',[tokenId],receipt.blockNumber),r.actor)||
    await call(read,r,'tokenURI',[tokenId],receipt.blockNumber)!==r.metadataURI) fail('TASK_TEST_721_MAPPING_REFUSED');
  if((await read('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash) fail('TASK_TEST_721_BLOCK_CHANGED');
  return Object.freeze({schema:'8415-artfi-test-nft721-result/1',taskId:r.taskId,taskIdBytes32:r.taskIdBytes32,chainId:r.chainId,
    collection:r.collection,runtimeCodeHash:r.runtimeCodeHash,issuer:r.actor,sourceHash:r.sourceHash,
    assetKind:r.assetKind,metadataHash:r.metadataHash,metadataURI:r.metadataURI,transactionHash,
    blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,tokenId:tokenId.toString(),standard:'ERC-721',
    quantity:'1',testOnly:true,finality:'canonical-at-observed-block-not-finality'});
}

