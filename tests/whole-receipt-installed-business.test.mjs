import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,AbiCoder,TypedDataEncoder,keccak256,Wallet} from 'ethers';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {createSecureContext} from 'node:tls';
import {once} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createAuthRuntime} from '../server/main.mjs';
import {openEncryptedStore} from '../server/store.mjs';
import {disabledTaskListingRuntime} from '../server/task-listing-runtime.mjs';
import {loadInstalledTaskListingModules} from '../server/task-listing-installed.mjs';
import {createWholeReceiptBootstrapBinding} from '../server/whole-receipt-host.mjs';
import {createTaskJournalCapabilityListener} from '../server/task-listing-bootstrap-core.mjs';
import {certificates,service} from './helpers/task-https-fixture.mjs';
import {pathToFileURL} from 'node:url';
const producer=await loadInstalledTaskListingModules();
const epoch=1800000000000,tenant='synthetic',origin='https://wallet.example.invalid';
// Reuse the existing task-asset-control-auth test identity; no operating key/credential is accessed.
const wallet=new Wallet('0x'+'6'.repeat(64)),account=wallet.address.toLowerCase();
const a=n=>n==='1'?account:'0x'+n.repeat(40),h=n=>'0x'+n.repeat(64);
const saleType='(address seller,address collection,uint256 tokenId,address paymentToken,uint256 price,address buyer,uint256 salt,uint48 startsAt,uint48 endsAt,uint256 epoch)';
const correspondenceType='(bytes32 settlementId,bytes32 assetRecordHash,bytes32 oracleSourceId,bytes32 requestHash,bytes32 executionReferenceHash,bytes32 previousSegment,bytes32 oldCertificateHash,bytes32 warehouseReceiptHash)';
const abi=new Interface(['function fund('+saleType+' sale,'+correspondenceType+' correspondence,bytes signature)','function confirmRegistration(bytes32 id,bytes evidence)','function paySeller(bytes32 id)']);
const saleFields=[['seller','address'],['collection','address'],['tokenId','uint256'],['paymentToken','address'],['price','uint256'],['buyer','address'],['salt','uint256'],['startsAt','uint48'],['endsAt','uint48'],['epoch','uint256']].map(([name,type])=>({name,type}));
 const sale={seller:a('2'),collection:a('3'),tokenId:'7',paymentToken:a('4'),price:'100',buyer:a('1'),salt:'9',startsAt:'1',endsAt:'2000000000',epoch:'0'};
 const correspondence={settlementId:h('1'),assetRecordHash:h('2'),oracleSourceId:h('3'),requestHash:h('4'),executionReferenceHash:h('5'),previousSegment:h('0'),oldCertificateHash:h('6'),warehouseReceiptHash:h('7')};
 const segment=TypedDataEncoder.hash({name:'ArtFi Whole Artwork Receipt Settlement',version:'1',chainId:560048,verifyingContract:a('5')},{ReceiptAuthorization:[{name:'saleIntentHash',type:'bytes32'},...Object.keys(correspondence).map(name=>({name,type:'bytes32'}))]},{saleIntentHash:TypedDataEncoder.hashStruct('SaleIntent',{SaleIntent:saleFields},sale),...correspondence});
 const data={funded:abi.encodeFunctionData('fund',[sale,correspondence,'0x1234']),registered:abi.encodeFunctionData('confirmRegistration',[segment,AbiCoder.defaultAbiCoder().encode([saleType,correspondenceType,'uint64','bytes'],[sale,correspondence,2,'0x5678'])]),paid:abi.encodeFunctionData('paySeller',[segment])};
 const policy={schema:'8415-agent-task/1',taskId:'synthetic-receipt-business-396',tenant,origin,chainId:'560048',actor:a('1'),expiresAt:String(epoch/1000+600),fees:{perOperationWei:'100000',totalWei:'300000'},intent:{kind:'artfi-receipt',handlerId:'artfi:whole-receipt:v1',escrow:a('5'),runtimeCodeHash:h('8'),segmentId:segment,sale,correspondence,phases:Object.keys(data).map((phase,n)=>({phase,nonce:String(n),calldataHash:keccak256(data[phase]),planDigest:h(String(n+1)),journalBindingHash:h(String(n+4)),gasLimit:'21000',maxFeePerGasWei:'2',maxPriorityFeePerGasWei:'1'})),recovery:{funding:'once',payout:'once',unknownOutcome:'reconcile-only'}}};

test('actual producer and auth routes generate durable grant, consume once, stop and restore without seeded session or grant',async t=>{
 const root=pathToFileURL((await mkdtemp(new URL('../.whole-receipt-business-',import.meta.url).pathname))+'/');
 const statePath=new URL('credentials.enc',root).pathname,key=Buffer.alloc(32,0x52);
 const certs=await certificates(t);let responseRelease, requestSeen;
 const seen=new Promise(r=>requestSeen=r);const released=new Promise(r=>responseRelease=r);
 const journal=await service(t,certs,async(req,res)=>{req.resume();requestSeen();await released;res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'SYNTHETIC_JOURNAL_UNAVAILABLE'}));});
 let store=await openEncryptedStore(statePath,key),host,peer,receipt,digest,nativeDigest;
 const identity={schema:'8415-task-executor/1',agentId:'synthetic-receipt',agentVersion:'1',adapterId:'artfi:whole-receipt:v1',adapterVersion:'1',implementationDigest:h('9')};
 const config={origin,tenant,port:31999,statePath,accounts:[{username:'owner',wallets:[{account:wallet.address,chainId:'560048'}]}]};
 let jar=new Map(),csrf='',steps=[];
 async function start(){
  host=await createAuthRuntime({config,store,now:()=>epoch,listingRuntime:{runtime:disabledTaskListingRuntime(),async start(){},async stop(){if(peer?.listening)await new Promise(r=>peer.close(r));}},wholeReceipt:createWholeReceiptBootstrapBinding({
   createInstallation(input){return producer.createWholeReceiptInstallation({...input,createTaskReceiptRuntime(options){digest=options.digest;nativeDigest=options.nativeDigest;receipt=input.createTaskReceiptRuntime(options);return receipt;}});},
   createJournalTransport:producer.createNftTaskJournalHttpsTransport,journalStore:{},consumerPeerId:'spiffe://artfi/journal',taskExecutorIdentity:identity,
   provider:{request(){throw Error('NO_PROVIDER_IO');}},journal:{url:journal.url+'/internal/v1/nft/operations',peerId:'spiffe://artfi/wallet',secureContext:createSecureContext({cert:certs.wallet.certBytes,key:certs.wallet.keyBytes,ca:certs.caBytes})}})});
  peer=createTaskJournalCapabilityListener({peerId:'spiffe://artfi/journal',clientFingerprint256:certs.journal.fingerprint},{cert:certs.wallet.certBytes,key:certs.wallet.keyBytes,ca:certs.caBytes},host.wholeReceipt);peer.listen(0,'127.0.0.1');await once(peer,'listening');
  host.server.listen(0,'127.0.0.1');await once(host.server,'listening');
 }
 async function call(path,body){return new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port:host.server.address().port,path:'/auth/'+path,method:body===undefined?'GET':'POST',agent:false,headers:{host:'wallet.example.invalid',origin,'x-wallet-tenant':tenant,'x-wallet-csrf':csrf,cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{'content-type':'application/json'})}},res=>{for(const cookie of res.headers['set-cookie']??[]){const [k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}const b=[];res.on('data',x=>b.push(x));res.on('end',()=>{const data=JSON.parse(Buffer.concat(b));if(data.csrf)csrf=data.csrf;steps.push({path,status:res.statusCode,error:data.error??null});resolve({status:res.statusCode,data});});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}
 async function login(){assert.equal((await call('bootstrap')).status,200);const c=await call('challenge',{method:'wallet',account:wallet.address,chainId:'560048'});assert.equal(c.status,200,JSON.stringify(c.data));const p=await call('proof',{id:c.data.id,account:wallet.address,chainId:'560048',signature:await wallet.signMessage(c.data.message)});assert.equal(p.status,200,JSON.stringify(p.data));}
 t.after(async()=>{await host?.stop();await store.close();await rm(root,{recursive:true,force:true});});
 await start();await login();
 const p=await call('tasks/prepare',{policy});assert.equal(p.status,200,JSON.stringify(p.data));
 const auth=await call('tasks/authorize',{challengeId:p.data.challengeId,taskDigest:p.data.task.digest,executorDigest:p.data.executor.digest,observationPolicyDigest:null,code:p.data.approvalFactor==='preoperational-default-on'?'':null});assert.equal(auth.status,200,JSON.stringify(auth.data));
 const g=auth.data,phase=g.task.policy.intent.phases[0];
 const claimed={taskId:g.task.policy.taskId,taskDigest:g.task.digest,executorDigest:g.executor.digest,grantReference:g.authorization.reference,grantPolicyVersion:g.authorization.grantPolicyVersion,operationId:'receipt-funded',phase:phase.phase,planDigest:phase.planDigest,journalBindingHash:phase.journalBindingHash};
 const principal={kind:'task',...Object.fromEntries(['taskId','taskDigest','executorDigest','grantReference','grantPolicyVersion','operationId'].map(k=>[k,claimed[k]]))};
 const {kind,...binding}=principal;const id='native_'+nativeDigest(binding),operation={id},scope={peerId:'spiffe://artfi/wallet',principal,action:'get',nativeOperationId:id,planDigest:'',requestDigest:digest({action:'get',operation}),operation};
 async function consume(value){return new Promise((resolve,reject)=>{const req=httpsRequest({hostname:'127.0.0.1',port:peer.address().port,path:'/internal/v1/task-journal-capabilities/consume',method:'POST',agent:false,cert:certs.journal.certBytes,key:certs.journal.keyBytes,ca:certs.caBytes,headers:{'content-type':'application/json'}},res=>{const b=[];res.on('data',x=>b.push(x));res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(b))}));});req.on('error',reject);req.end(JSON.stringify(value));});}
 await receipt.authority.withPreparation(claimed,'observe',async()=>receipt.withCapability(scope,async capability=>{
  const request={capability,peerId:scope.peerId,action:scope.action,nativeOperationId:id,planDigest:'',requestDigest:scope.requestDigest};
  const first=await consume(request);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal((await consume(request)).status,403);steps.push({stage:'one-use-mTLS-consumption',first:200,replay:403});
 }));
 const before=await call('tasks/status',{taskDigest:g.task.digest});assert.equal(before.status,200);assert.deepEqual(before.data.receiptAttempts,[]);
 const operationHandle=host.wholeReceipt.operation({task:g.task,claimed});
 const readOutcome=operationHandle.read('observe').then(()=>({ok:true}),error=>({ok:false,error:error.message}));
 await Promise.race([seen,new Promise((_,reject)=>setTimeout(()=>reject(Error('NO_ACTUAL_JOURNAL_REQUEST')),3000))]);
 let stopped=false;const stopping=host.stop().then(()=>stopped=true);
 await new Promise(r=>setTimeout(r,30));assert.equal(stopped,false,'accepted actual producer read must drain before installation stop');
 responseRelease();const outcome=await readOutcome;assert.equal(outcome.ok,false);assert.equal(outcome.error,'RECEIPT_JOURNAL_OUTCOME_UNKNOWN_READ_FIRST');await stopping;assert.equal(stopped,true);
 steps.push({stage:'actual-producer-read-drain',requestReachedOriginalTransport:true,stopWaited:true,transportResult:outcome.error,stopSettled:true});
 await host.stop();await store.close();store=await openEncryptedStore(statePath,key);await start();
 assert.equal((await call('tasks/status',{taskDigest:g.task.digest})).status,401);jar=new Map();csrf='';await login();
 const after=await call('tasks/status',{taskDigest:g.task.digest});assert.equal(after.status,200,JSON.stringify(after.data));assert.equal(after.data.authorization.reference,g.authorization.reference);assert.deepEqual(after.data.receiptAttempts,[]);
 const raw=await readFile(statePath);t.diagnostic(JSON.stringify({steps,statePath,stateBytes:raw.length,stateSha256:createHash('sha256').update(raw).digest('hex'),serviceGeneratedGrant:true,manuallySeededSessions:0,manuallySeededGrants:0,transactions:0,providerCalls:0,acceptedReadDrain:'PASS',activeSendDrain:'NOT_RUN',unknownSendRecovery:'NOT_RUN',wholeProductAcceptance:'NOT_PASSED'}));
});
