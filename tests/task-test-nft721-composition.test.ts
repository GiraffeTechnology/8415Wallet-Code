/** In-memory service composition only: no real wallet, HTTP, signer, RPC or chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskAuthorizationService} from '../server/task-authorization.mjs';
import {createTaskTestAssetAuthorization,testMintInventoryKey} from '../server/task-test-asset-authorization.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {freezeChildOperation} from '../src/agent/taskContract.ts';
import {bindTaskObservation,freezeTaskObservationPolicy} from '../src/agent/receiptObservation.ts';
import {encodeTestNFT721Mint} from '../server/task-test-nft721-contract.mjs';
import {testNFT721OperationRequest} from '../server/task-test-nft721-binding.mjs';
import {hashControlBytes} from '../src/controls/authorization.ts';
import type {FrozenTask,FrozenChild} from '../src/agent/taskContract.ts';
type ExecutionInput={task:FrozenTask;child:FrozenChild;executor:{digest:string};grantPolicyVersion:string};
type ObservationInput=Parameters<typeof bindTaskObservation>[1];
type Progress={task:{digest:string};budget:{reservations:{childDigest:string}[];revision:string}};
const h=(n:string)=>'0x'+n.repeat(64),actor='0x'+'1'.repeat(40),collection='0x'+'2'.repeat(40),epoch=1800000000000;
async function fixture(){
 const op={kind:'artfi-test-nft721-mint',taskId:'wallet:mint:1',sourceTaskId:'producer:original',taskIdBytes32:h('3'),artifactDigest:h('4'),
   chainId:'560048',actor,collection:{contract:collection,runtimeCodeHash:h('5')},sourceHash:h('6'),assetKind:0,metadataHash:h('7'),
   metadataURI:'https://metadata.example.invalid:9446/api/test-nft/metadata/'+h('7').slice(2)};
 const deployment={schema:'8415-hoodi-test-nft-deployment/1',artifactDigest:op.artifactDigest,chainId:'560048',collection,
   runtimeCodeHash:op.collection.runtimeCodeHash,issuer:actor,taskId:op.sourceTaskId,taskIdBytes32:op.taskIdBytes32};
 const publication={schema:'8415-hoodi-test-metadata-publication/1',taskId:op.taskId,chainId:'560048',uri:op.metadataURI,
   sourceHash:op.sourceHash,assetKind:0,metadataHash:op.metadataHash,byteLength:546};
 const inventory={schema:'8415-agent-test-assets/1',chainId:'560048',origin:'https://wallet.example.invalid',tenant:'xiongan',
   expiresAt:String(epoch/1000+3600),wallets:[actor],assets:[{taskId:op.taskId,actor,standard:'ERC-721',contract:collection,
   runtimeCodeHash:op.collection.runtimeCodeHash,issuer:actor,sourceHash:op.sourceHash,mint:{state:'planned',deployment,
   metadataPublication:publication,metadataTimeoutMs:1000}}]};
 const store=new MemoryCredentialStore({'xiongan:tester':{revision:1}}),state={sends:0,reorg:false,badResult:false,failPersistence:false};
 const mode=await createTaskTestAssetAuthorization({inventory,authorizedWallets:[{account:actor,chainId:'560048'}],store,now:()=>epoch});
 const executorIdentity={schema:'8415-task-executor/1',agentId:'synthetic',agentVersion:'1',adapterId:'synthetic',adapterVersion:'1',implementationDigest:h('9')};
 const identity={verifierId:'synthetic:mint',verifierVersion:'1',verifierImplementationDigest:h('8')},policy={minimumConfirmations:'2'};
 const bound=(i:ExecutionInput)=>({taskDigest:i.task.digest,childDigest:i.child.digest,chainId:i.task.policy.chainId,actor:i.task.policy.actor,
   nonce:i.child.child.nonce,executorDigest:i.executor.digest,grantPolicyVersion:i.grantPolicyVersion});
 const execution={verify:async(i:ExecutionInput)=>bound(i),send:async(i:ExecutionInput)=>{state.sends++;return {...bound(i),transactionHash:h('a')};},recover:async()=>assert.fail('No implicit recovery')};
 const receipt={identity,observationPolicy:freezeTaskObservationPolicy(policy),
   async assessChild(i:ExecutionInput){return {taskDigest:i.task.digest,childDigest:i.child.digest,executorDigest:i.executor.digest,
     observationPolicyDigest:freezeTaskObservationPolicy(policy).digest,...identity,capability:'exact-operation-observable'};},
   async observe(i:ObservationInput){return bindTaskObservation({schema:'8415-task-observation/1',taskDigest:i.task.digest,childDigest:i.child.digest,
     chainId:'560048',actor,nonce:i.child.child.nonce,attemptExecutorDigest:i.attempt.executorDigest,attemptGrantPolicyVersion:i.attempt.grantPolicyVersion,
     originalTransactionHash:i.attempt.transactionHash,observationPolicy:policy,observationPolicyDigest:freezeTaskObservationPolicy(policy).digest,
     state:state.reorg?'reorged':'confirmed-at-depth',blockNumber:'16',blockHash:h('b'),confirmations:state.reorg?'0':'2',
     replacementHash:null,observedAt:String(epoch/1000),effect:state.reorg?'not-established':'exact-operation-observed',
     protocolFinality:'not-evaluated',economicFinality:'not-evaluated',...identity},{...i,verifier:identity});},
   async observeMintResult(){return {schema:'8415-wallet-test-nft721-result/1',taskId:op.taskId,sourceTaskId:op.sourceTaskId,taskIdBytes32:op.taskIdBytes32,
     artifactDigest:op.artifactDigest,chainId:'560048',collection,runtimeCodeHash:op.collection.runtimeCodeHash,issuer:actor,sourceHash:op.sourceHash,
     assetKind:op.assetKind,metadataHash:op.metadataHash,metadataURI:op.metadataURI,transactionHash:h('a'),blockHash:h('b'),blockNumber:'0x10',
     tokenId:state.badResult?'011':'11',standard:'ERC-721',quantity:'1',testOnly:true,finality:'canonical-at-observed-block-not-finality'};}};
 const mintKey=testMintInventoryKey('560048',collection,op.sourceHash),transaction=store.transactionMany.bind(store);
 store.transactionMany=async(keys:string[],update:(values:Record<string,unknown>)=>unknown)=>{if(state.failPersistence&&keys.includes(mintKey))throw Error('SYNTHETIC_PERSISTENCE_FAILURE');return transaction(keys,update);};
 const session={username:'tester',account:actor,chainId:'560048',id:'synthetic:session',revision:1,expiresAt:epoch+900000};
 const service=createTaskAuthorizationService({origin:inventory.origin,tenant:'xiongan',store,now:()=>epoch,testAuthorization:mode,execution,receipt,
   executorIdentity,observationPolicy:policy,assertSession:(s:unknown)=>assert.strictEqual(s,session),credentialFor:()=>store.read('xiongan:tester'),
   consumeTotp:()=>assert.fail('No factor in approved synthetic server scope')});
 const call=(path:string,body:unknown)=>service.handler('tasks/'+path,body,session);
 const taskPolicy={schema:'8415-agent-task/1',taskId:op.taskId,tenant:'xiongan',origin:inventory.origin,chainId:'560048',actor,
   expiresAt:String(epoch/1000+600),fees:{perOperationWei:'1000000',totalWei:'1000000'},intent:{kind:'exact-operation',operation:op}};
 const body=(v:Progress)=>({taskDigest:v.task.digest,operationId:'mint:op',childDigest:v.budget.reservations[0]!.childDigest,expectedBudgetRevision:v.budget.revision});
 async function submitted(){
   const p=await call('prepare',{policy:taskPolicy});assert.equal(p.approvalFactor,'server-test-scope');
   const g=await call('authorize',{challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:p.observationPolicy.digest,code:''});
   const wire=encodeTestNFT721Mint(testNFT721OperationRequest(op));
   const child=freezeChildOperation({schema:'8415-agent-child/1',operationId:'mint:op',taskDigest:g.task.digest,operation:op,nonce:'7',
     expiresAt:String(epoch/1000+300),wire:{to:wire.to,calldataHash:hashControlBytes(wire.data),valueWei:'0'},fees:{gasLimit:'100000',maxFeePerGasWei:'10'},market:null});
   const reserved=await call('reserve',{taskDigest:g.task.digest,child:child.child,expectedBudgetRevision:g.budget.revision});
   return call('execute',body(reserved));
 }
 return {mode,inventory,taskPolicy,store,state,mintKey,service,call,body,submitted};
}
test('server registration distinguishes authorization and producer task and closes approval/observe inventory path',async()=>{
 const f=await fixture(),s=await f.submitted(),v=await f.call('observe',f.body(s));
 assert.equal(v.observations[0].mintResult.tokenId,'11');assert.equal(v.observations[0].mintResult.sourceTaskId,'producer:original');
 const record=await f.store.read(f.mintKey);assert.equal(record.available,true);assert.equal(record.result.quantity,'1');
 assert.equal(record.sourceTaskDigest,v.task.digest);assert.equal(f.state.sends,1);
 await assert.rejects(f.call('execute',f.body(v)));assert.equal(f.state.sends,1);
});
test('canonical reorg withdraws inventory but keeps submitted nonce history, never replaying the intent',async()=>{
 const f=await fixture(),s=await f.submitted();await f.call('observe',f.body(s));f.state.reorg=true;
 const v=await f.call('observe',f.body(s));assert.equal((await f.store.read(f.mintKey)).available,false);
 assert.equal(v.budget.reservations[0].status,'submitted');assert.equal(v.observations[0].mintResult,null);
 await assert.rejects(f.call('execute',f.body(v)));assert.equal(f.state.sends,1);
});
test('malformed observed token cannot refresh prior evidence as available',async()=>{
 const f=await fixture(),s=await f.submitted();await f.call('observe',f.body(s));f.state.badResult=true;
 await assert.rejects(f.call('observe',f.body(s)),/TASK_OBSERVATION_UNAVAILABLE/);
 assert.equal((await f.store.read(f.mintKey)).available,false);
 const v=await f.call('status',{taskDigest:s.task.digest});assert.equal(v.observations[0].available,false);assert.equal(f.state.sends,1);
});
test('inventory persistence failure publishes no cache eligibility or partial observation',async()=>{
 const f=await fixture(),s=await f.submitted();f.state.failPersistence=true;
 await assert.rejects(f.call('observe',f.body(s)),/SYNTHETIC_PERSISTENCE_FAILURE/);
 assert.equal(await f.store.read(f.mintKey),null);const v=await f.call('status',{taskDigest:s.task.digest});
 assert.equal(v.observations.length,0);assert.equal(v.budget.reservations[0].status,'submitted');assert.equal(f.state.sends,1);
});

