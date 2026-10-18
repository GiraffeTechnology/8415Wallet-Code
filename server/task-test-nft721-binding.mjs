/** Server-owned admission for the original test-only ERC721 deployment.
 * Authorization task IDs and the producer's opaque full/bytes32 pair are distinct.
 * Digests are provenance pins, never remote attestation or source authority.
 */
import { normalizeTestNFT721Mint, verifyTestNFT721MintPreflight, readTestNFT721MintResult } from './task-test-nft721-contract.mjs';
import { normalizeExistingOperation } from '../src/agent/taskContract.ts';
const fail=()=>{throw Error('TASK_TEST_721_BINDING_REFUSED');};
const fields=(v,names)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v);
  if(Reflect.ownKeys(d).length!==names.length||names.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value')))fail();};
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v);
const addr=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0+$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
export function normalizeTestNFT721Bindings(input=[]) {
  if(!Array.isArray(input)||input.length>10000)fail();const rows=new Map();
  for(const row of input){fields(row,['taskId','binding']);if(!id(row.taskId))fail();const b=row.binding;
    fields(b,['schema','artifactDigest','chainId','collection','runtimeCodeHash','issuer','taskId','taskIdBytes32']);
    if(b.schema!=='8415-hoodi-test-nft-deployment/1'||b.chainId!=='560048'||!id(b.taskId)||
      !['artifactDigest','runtimeCodeHash','taskIdBytes32'].every(k=>hash(b[k]))||!['collection','issuer'].every(k=>addr(b[k])))fail();
    const value=Object.freeze({taskId:row.taskId,binding:Object.freeze(Object.fromEntries(
      ['schema','artifactDigest','chainId','collection','runtimeCodeHash','issuer','taskId','taskIdBytes32'].map(k=>[k,b[k]])))}), prior=rows.get(row.taskId);
    if(prior&&JSON.stringify(prior)!==JSON.stringify(value))fail();rows.set(row.taskId,value);
  }
  return Object.freeze([...rows].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,v])=>v));
}
export function testNFT721OperationRequest(op) {
  op=normalizeExistingOperation(op);
  if(op.kind!=='artfi-test-nft721-mint')fail();
  return normalizeTestNFT721Mint({schema:'8415-artfi-test-nft721-mint/1',taskId:op.sourceTaskId,taskIdBytes32:op.taskIdBytes32,
    chainId:op.chainId,actor:op.actor,collection:op.collection.contract,runtimeCodeHash:op.collection.runtimeCodeHash,
    sourceHash:op.sourceHash,assetKind:op.assetKind,metadataHash:op.metadataHash,metadataURI:op.metadataURI});
}
export function testNFT721BindingForOperation(rows,op) {
  const b=rows.find(r=>r.taskId===op.taskId)?.binding;
  if(!b||b.chainId!==op.chainId||b.collection!==op.collection.contract||b.runtimeCodeHash!==op.collection.runtimeCodeHash||
    b.issuer!==op.actor||b.taskId!==op.sourceTaskId||b.taskIdBytes32!==op.taskIdBytes32||b.artifactDigest!==op.artifactDigest)
    throw Error('TASK_TEST_721_DEPLOYMENT_NOT_ADMITTED');
  return b;
}
export async function verifyTestNFT721OperationPreflight({operation,bindings,provider,snapshotBlock='latest'}) {
  // Both the normalized policy and the server-owned deployment must agree before
  // any provider read. The contract separately enforces its atomic mint checks.
  const op=normalizeExistingOperation(operation),rows=normalizeTestNFT721Bindings(bindings);
  const request=testNFT721OperationRequest(op),binding=testNFT721BindingForOperation(rows,op);
  return verifyTestNFT721MintPreflight({request,binding,provider,allowedWallets:[request.actor],snapshotBlock});
}
export async function readTestNFT721OperationResult({operation,bindings,provider,transactionHash}) {
  // Snapshot before the first asynchronous provider read. A late mutation of the
  // caller's object cannot relabel verified evidence with another task/artifact.
  const op=normalizeExistingOperation(operation),rows=normalizeTestNFT721Bindings(bindings);
  const r=await readTestNFT721MintResult({request:testNFT721OperationRequest(op),
    binding:testNFT721BindingForOperation(rows,op),provider,transactionHash});
  return Object.freeze({...r,schema:'8415-wallet-test-nft721-result/1',taskId:op.taskId,
    sourceTaskId:r.taskId,artifactDigest:op.artifactDigest});
}
export function normalizeTestNFT721OperationResult(raw,op,observation) {
  const names=['schema','taskId','sourceTaskId','taskIdBytes32','artifactDigest','chainId','collection','runtimeCodeHash','issuer',
    'sourceHash','assetKind','metadataHash','metadataURI','transactionHash','blockHash','blockNumber','tokenId','standard','quantity','testOnly','finality'];
  fields(raw,names);
  if(raw.schema!=='8415-wallet-test-nft721-result/1'||raw.taskId!==op.taskId||raw.sourceTaskId!==op.sourceTaskId||
    raw.taskIdBytes32!==op.taskIdBytes32||raw.artifactDigest!==op.artifactDigest||raw.chainId!==op.chainId||
    raw.collection!==op.collection.contract||raw.runtimeCodeHash!==op.collection.runtimeCodeHash||raw.issuer!==op.actor||
    raw.sourceHash!==op.sourceHash||raw.assetKind!==op.assetKind||raw.metadataHash!==op.metadataHash||raw.metadataURI!==op.metadataURI||
    raw.transactionHash!==observation.originalTransactionHash||raw.blockHash!==observation.blockHash||
    observation.state!=='confirmed-at-depth'||observation.effect!=='exact-operation-observed'||
    typeof raw.blockNumber!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(raw.blockNumber)||
    BigInt(raw.blockNumber)!==BigInt(observation.blockNumber)||typeof raw.tokenId!=='string'||!/^[1-9][0-9]{0,77}$/.test(raw.tokenId)||
    BigInt(raw.tokenId)>=(1n<<256n)||raw.standard!=='ERC-721'||raw.quantity!=='1'||raw.testOnly!==true||
    raw.finality!=='canonical-at-observed-block-not-finality')fail();
  return Object.freeze(Object.fromEntries(names.map(k=>[k,raw[k]])));
}

