/** Fixed TEST-ONLY ArtFiCharityEditions single-series contract.
 * Source: GiraffeTechnology/ArtFi@5e7cc4cd482be71431d904439ef79d1ab5d7eade
 * packages/contracts/src/ArtFiCharityEditions.sol blob dcbe596fc0b5a029353f78391c5a5e9e8d8dd327.
 * Source identity is NOT a deployed runtime code hash. No arbitrary call/batch ABI.
 */
import { Interface, id, keccak256, ZeroAddress } from 'ethers';
const abi = new Interface([
  'function createSeries(bytes32 artworkId,bytes32 masterArtworkHash,bytes32 metadataHash,address distributionWallet,string metadataURI) returns(uint256)',
  'function hasRole(bytes32,address) view returns(bool)', 'function paused() view returns(bool)',
  'function tokenByArtworkId(bytes32) view returns(uint256)', 'function tokenByMasterArtworkHash(bytes32) view returns(uint256)',
  'function EDITIONS_PER_ARTWORK() view returns(uint256)', 'function uri(uint256) view returns(string)',
  'event SeriesCreated(uint256 indexed tokenId,bytes32 indexed artworkId,bytes32 indexed masterArtworkHash,address distributionWallet,bytes32 metadataHash,string metadataURI)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event URI(string value,uint256 indexed id)',
]);
const fail = code => { throw Error(code); };
const address = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v) && v !== ZeroAddress;
const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export function normalizeTestSeriesMint(input) {
  const names = ['schema','taskId','chainId','actor','collection','runtimeCodeHash','artworkId','masterArtworkHash','metadataHash','distributionWallet','metadataURI'];
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) fail('TASK_TEST_MINT_SCHEMA_REFUSED');
  const d = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(d).length !== names.length || names.some(k => !Object.hasOwn(d,k) || !Object.hasOwn(d[k],'value')))
    fail('TASK_TEST_MINT_SCHEMA_REFUSED');
  if (input.schema !== '8415-artfi-test-series-mint/1' || input.chainId !== '560048' ||
      typeof input.taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.taskId) ||
      !['actor','collection','distributionWallet'].every(k => address(input[k])) ||
      !['runtimeCodeHash','artworkId','masterArtworkHash','metadataHash'].every(k => hash(input[k])) ||
      typeof input.metadataURI !== 'string' || Buffer.byteLength(input.metadataURI) > 512 ||
      !/^(https:\/\/|ipfs:\/\/)/.test(input.metadataURI)) fail('TASK_TEST_MINT_SCOPE_REFUSED');
  return Object.freeze(Object.fromEntries(names.map(k => [k,input[k]])));
}
export function encodeTestSeriesMint(input) {
  const r = normalizeTestSeriesMint(input);
  return Object.freeze({ to:r.collection, valueWei:'0', data:abi.encodeFunctionData('createSeries',
    [r.artworkId,r.masterArtworkHash,r.metadataHash,r.distributionWallet,r.metadataURI]) });
}
/** Convert only the canonical typed operation; parent task normalization binds
 * operation.taskId to its complete original task ID, without hashing it away. */
export function testSeriesMintRequest(operation) {
  if (operation?.kind !== 'artfi-test-series-mint') fail('TASK_TEST_MINT_SCHEMA_REFUSED');
  return normalizeTestSeriesMint({ schema:'8415-artfi-test-series-mint/1',taskId:operation.taskId,
    chainId:operation.chainId,actor:operation.actor,collection:operation.collection.contract,
    runtimeCodeHash:operation.collection.runtimeCodeHash,artworkId:operation.artworkId,
    masterArtworkHash:operation.masterArtworkHash,metadataHash:operation.metadataHash,
    distributionWallet:operation.distributionWallet,metadataURI:operation.metadataURI });
}
function reader(provider) {
  if (typeof provider?.request !== 'function') fail('TASK_TEST_MINT_PROVIDER_REQUIRED');
  const request = provider.request.bind(provider);
  return async (method, params=[]) => {
    if (!['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getTransactionReceipt'].includes(method))
      fail('TASK_TEST_MINT_WRITE_REFUSED');
    return structuredClone(await request({method,params:structuredClone(params)}));
  };
}
async function chain(read) { const c=await read('eth_chainId'); if(typeof c!=='string' || !/^0x[0-9a-f]+$/i.test(c) || BigInt(c)!==560048n) fail('TASK_TEST_MINT_CHAIN_REFUSED'); }
async function contract(read,r,block) {
  const code=await read('eth_getCode',[r.collection,block]);
  if(typeof code!=='string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || keccak256(code)!==r.runtimeCodeHash) fail('TASK_TEST_MINT_CODE_REFUSED');
}
async function call(read,r,name,args,block) {
  const raw=await read('eth_call',[{to:r.collection,data:abi.encodeFunctionData(name,args)},block]);
  return abi.decodeFunctionResult(name,raw)[0];
}
export async function verifyTestSeriesMintPreflight({request,provider,allowedWallets,snapshotBlock='latest'}) {
  const r=normalizeTestSeriesMint(request), read=reader(provider);
  if(!Array.isArray(allowedWallets) || ![r.actor,r.distributionWallet].every(a=>allowedWallets.includes(a))) fail('TASK_TEST_MINT_WALLET_REFUSED');
  await chain(read);
  const b=await read('eth_getBlockByNumber',[snapshotBlock,false]);
  if(!b || !hash(b.hash) || typeof b.number!=='string') fail('TASK_TEST_MINT_BLOCK_REFUSED');
  await contract(read,r,b.number);
  if(await call(read,r,'hasRole',[id('SERIES_CREATOR_ROLE'),r.actor],b.number)!==true ||
      await call(read,r,'paused',[],b.number)!==false ||
      await call(read,r,'EDITIONS_PER_ARTWORK',[],b.number)!==100n ||
      await call(read,r,'tokenByArtworkId',[r.artworkId],b.number)!==0n ||
      await call(read,r,'tokenByMasterArtworkHash',[r.masterArtworkHash],b.number)!==0n)
    fail('TASK_TEST_MINT_PREFLIGHT_REFUSED');
  if((await read('eth_getBlockByNumber',[b.number,false]))?.hash!==b.hash) fail('TASK_TEST_MINT_BLOCK_CHANGED');
  return Object.freeze({...encodeTestSeriesMint(r),blockNumber:b.number,blockHash:b.hash});
}
export async function readTestSeriesMintResult({request,provider,transactionHash}) {
  const r=normalizeTestSeriesMint(request), read=reader(provider); if(!hash(transactionHash)) fail('TASK_TEST_MINT_TX_REFUSED');
  await chain(read);
  const receipt=await read('eth_getTransactionReceipt',[transactionHash]);
  if(!receipt || receipt.transactionHash!==transactionHash || receipt.status!=='0x1' || !same(receipt.from,r.actor) ||
      !same(receipt.to,r.collection) || !hash(receipt.blockHash) || !Array.isArray(receipt.logs)) fail('TASK_TEST_MINT_RECEIPT_REFUSED');
  const block=await read('eth_getBlockByNumber',[receipt.blockNumber,false]);
  if(block?.hash!==receipt.blockHash) fail('TASK_TEST_MINT_BLOCK_CHANGED');
  await contract(read,r,receipt.blockNumber);
  const logs=[];
  for(const log of receipt.logs) if(same(log.address,r.collection)) {
    if(log.removed===true || log.blockHash!==receipt.blockHash || log.transactionHash!==transactionHash) fail('TASK_TEST_MINT_LOG_REFUSED');
    try { const parsed=abi.parseLog(log); if(parsed) logs.push(parsed); } catch { /* unrelated collection events are not mint evidence */ }
  }
  const series=logs.filter(l=>l.name==='SeriesCreated');
  if(series.length!==1) fail('TASK_TEST_MINT_EVENT_REFUSED');
  const a=series[0].args, tokenId=a.tokenId;
  if(tokenId<=0n || a.artworkId!==r.artworkId || a.masterArtworkHash!==r.masterArtworkHash ||
      !same(a.distributionWallet,r.distributionWallet) || a.metadataHash!==r.metadataHash || a.metadataURI!==r.metadataURI ||
      logs.filter(l=>l.name==='TransferSingle' && same(l.args.operator,r.actor) && l.args.from===ZeroAddress &&
        same(l.args.to,r.distributionWallet) && l.args.id===tokenId && l.args.value===100n).length!==1 ||
      logs.filter(l=>l.name==='URI' && l.args.id===tokenId && l.args.value===r.metadataURI).length!==1)
    fail('TASK_TEST_MINT_EVENT_REFUSED');
  if(await call(read,r,'tokenByArtworkId',[r.artworkId],receipt.blockNumber)!==tokenId ||
      await call(read,r,'tokenByMasterArtworkHash',[r.masterArtworkHash],receipt.blockNumber)!==tokenId ||
      await call(read,r,'uri',[tokenId],receipt.blockNumber)!==r.metadataURI) fail('TASK_TEST_MINT_MAPPING_REFUSED');
  if((await read('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash) fail('TASK_TEST_MINT_BLOCK_CHANGED');
  return Object.freeze({schema:'8415-artfi-test-series-mint-result/1',taskId:r.taskId,chainId:r.chainId,
    collection:r.collection,runtimeCodeHash:r.runtimeCodeHash,issuer:r.actor,transactionHash,
    blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,tokenId:tokenId.toString(),standard:'ERC-1155',
    quantity:'100',artworkId:r.artworkId,masterArtworkHash:r.masterArtworkHash,metadataHash:r.metadataHash,
    metadataURI:r.metadataURI,distributionWallet:r.distributionWallet,testOnly:true,
    finality:'canonical-at-observed-block-not-finality'});
}

