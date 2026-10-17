import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, AbiCoder, TypedDataEncoder, keccak256 } from 'ethers';
import { createTaskAuthorizationService } from '../server/task-authorization.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { freezeReceiptTask } from '../src/agent/receiptTask.ts';
const a=n=>'0x'+n.repeat(40),h=n=>'0x'+n.repeat(64),epoch=1800000000000;
const saleType='(address seller,address collection,uint256 tokenId,address paymentToken,uint256 price,address buyer,uint256 salt,uint48 startsAt,uint48 endsAt,uint256 epoch)';
const correspondenceType='(bytes32 settlementId,bytes32 assetRecordHash,bytes32 oracleSourceId,bytes32 requestHash,bytes32 executionReferenceHash,bytes32 previousSegment,bytes32 oldCertificateHash,bytes32 warehouseReceiptHash)';
const abi=new Interface(['function fund('+saleType+' sale,'+correspondenceType+' correspondence,bytes signature)','function confirmRegistration(bytes32 id,bytes evidence)','function paySeller(bytes32 id)']);
const saleFields=[['seller','address'],['collection','address'],['tokenId','uint256'],['paymentToken','address'],['price','uint256'],['buyer','address'],['salt','uint256'],['startsAt','uint48'],['endsAt','uint48'],['epoch','uint256']].map(([name,type])=>({name,type}));
function fixture({handler='artfi:whole-receipt:v1',store:configuredStore=null}={}){
 const state={now:epoch},store=configuredStore??new MemoryCredentialStore({'xiongan:tester':{revision:1,synthetic:true}});
 const session={username:'tester',account:a('1'),chainId:'560048',id:'synthetic-session',revision:1,issuedAt:epoch,expiresAt:epoch+900000};
 const sale={seller:a('2'),collection:a('3'),tokenId:'7',paymentToken:a('4'),price:'100',buyer:a('1'),salt:'9',startsAt:'1',endsAt:'2000000000',epoch:'0'};
 const correspondence={settlementId:h('1'),assetRecordHash:h('2'),oracleSourceId:h('3'),requestHash:h('4'),executionReferenceHash:h('5'),previousSegment:h('0'),oldCertificateHash:h('6'),warehouseReceiptHash:h('7')};
 const segment=TypedDataEncoder.hash({name:'ArtFi Whole Artwork Receipt Settlement',version:'1',chainId:560048,verifyingContract:a('5')},{ReceiptAuthorization:[{name:'saleIntentHash',type:'bytes32'},...Object.keys(correspondence).map(name=>({name,type:'bytes32'}))]},{saleIntentHash:TypedDataEncoder.hashStruct('SaleIntent',{SaleIntent:saleFields},sale),...correspondence});
 const data={funded:abi.encodeFunctionData('fund',[sale,correspondence,'0x1234']),registered:abi.encodeFunctionData('confirmRegistration',[segment,AbiCoder.defaultAbiCoder().encode([saleType,correspondenceType,'uint64','bytes'],[sale,correspondence,2,'0x5678'])]),paid:abi.encodeFunctionData('paySeller',[segment])};
 const policy={schema:'8415-agent-task/1',taskId:'synthetic-receipt',tenant:'xiongan',origin:'https://wallet.example.invalid',chainId:'560048',actor:a('1'),expiresAt:String(epoch/1000+600),fees:{perOperationWei:'100000',totalWei:'300000'},intent:{kind:'artfi-receipt',handlerId:'artfi:whole-receipt:v1',escrow:a('5'),runtimeCodeHash:h('8'),segmentId:segment,sale,correspondence,phases:Object.keys(data).map((phase,n)=>({phase,nonce:String(n),calldataHash:keccak256(data[phase]),planDigest:h(String(n+1)),journalBindingHash:h(String(n+4)),gasLimit:'21000',maxFeePerGasWei:'2',maxPriorityFeePerGasWei:'1'})),recovery:{funding:'once',payout:'once',unknownOutcome:'reconcile-only'}}};
 let approvals=0,sends=0;
 const assertSession=(s,c)=>{if(s!==session || state.now>=session.expiresAt || c!==undefined&&c?.revision!==1)throw Error('AUTH_REFUSED');};
 const service=createTaskAuthorizationService({origin:policy.origin,tenant:'xiongan',store,now:()=>state.now,assertSession,
  credentialFor:async s=>{const c=await store.read('xiongan:tester');assertSession(s,c);return c;},
  consumeTotp:(s,c,code)=>{assertSession(s,c);assert.equal(code,'123456');approvals++;return c;},
  assertPrincipal:(p,c)=>{if(p.username!=='tester'||p.account!==a('1')||p.chainId!=='560048'||c?.revision!==1)throw Error('AUTH_PRINCIPAL_REFUSED');},
  receiptHandlerId:handler,executorIdentity:handler?{schema:'8415-task-executor/1',agentId:'synthetic-receipt',agentVersion:'1',adapterId:'artfi:whole-receipt:v1',adapterVersion:'1',implementationDigest:h('9')}:null});
 const call=(path,body)=>service.handler('tasks/'+path,body,session);
 async function grant(){
  const c=await call('prepare',{policy});
  return call('authorize',{challengeId:c.challengeId,taskDigest:c.task.digest,executorDigest:c.executor.digest,observationPolicyDigest:null,code:'123456'});
 }
 function operation(g,phase){
  const p=g.task.policy.intent.phases.find(p=>p.phase===phase);
  return {claimed:{taskId:g.task.policy.taskId,taskDigest:g.task.digest,executorDigest:g.executor.digest,grantReference:g.authorization.reference,grantPolicyVersion:g.authorization.grantPolicyVersion,operationId:'receipt-'+phase,phase,planDigest:p.planDigest,journalBindingHash:p.journalBindingHash},
   wire:{account:a('1'),chainId:'560048',to:a('5'),data:data[phase],value:'0',nonce:p.nonce,gasLimit:p.gasLimit,maxFeePerGasWei:p.maxFeePerGasWei,maxPriorityFeePerGasWei:p.maxPriorityFeePerGasWei}};
 }
 const send=async(g,phase,callback=async()=>h('a'))=>{const x=operation(g,phase);return service.receiptAuthorization.withAuthorization(x.claimed,x.wire,async(snapshot,revalidate)=>{sends++;revalidate();assert.equal(snapshot.scope.phase,phase);return callback(snapshot,revalidate);});};
 return {state,store,session,policy,service,call,grant,operation,send,count:()=>({approvals,sends})};
}

test('review: two concurrent identical receipt phases dispatch only once',async()=>{
 const f=fixture(),g=await f.grant();
 const results=await Promise.allSettled([f.send(g,'funded'),f.send(g,'funded')]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected'&&/TASK_RECEIPT_ALREADY_ATTEMPTED/.test(x.reason.message)).length,1);
 assert.equal(f.count().sends,1);assert.equal((await f.call('status',{taskDigest:g.task.digest})).receiptAttempts.length,1);
 await f.store.close();
});

test('review: two concurrent separately approved tasks cannot claim the same global nonce',async()=>{
 const f=fixture(),g=await f.grant();f.policy.taskId='synthetic-second';const other=await f.grant();
 const x=f.operation(other,'funded');x.claimed.operationId='other-funded';let called=0;
 const results=await Promise.allSettled([f.send(g,'funded',async()=>{called++;return h('a');}),
  f.service.receiptAuthorization.withAuthorization(x.claimed,x.wire,async()=>{called++;return h('b');})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected'&&/TASK_NONCE_OCCUPIED/.test(x.reason.message)).length,1);
 assert.equal(called,1);await f.store.close();
});

for(const boundary of ['expiry','clock-reversal','credential-revision']){
 test('review: queued pre-reservation '+boundary+' rejects without nonce consumption',async()=>{
  const f=fixture(),g=await f.grant();const original=f.store.transactionMany.bind(f.store);let once=true;
  f.store.transactionMany=async(keys,update)=>{
   if(once){once=false;
    if(boundary==='expiry')f.state.now=Number(g.task.policy.expiresAt)*1000;
    else if(boundary==='clock-reversal')f.state.now=epoch-1;
    else await f.store.transaction('xiongan:tester',()=>({revision:2,synthetic:true}));
   }return original(keys,update);
  };
  await assert.rejects(f.send(g,'funded'));assert.equal(f.count().sends,0);
  f.state.now=epoch;await f.store.transaction('xiongan:tester',()=>({revision:1,synthetic:true}));
  assert.equal((await f.call('status',{taskDigest:g.task.digest})).receiptAttempts.length,0);
  await f.send(g,'funded');assert.equal(f.count().sends,1);await f.store.close();
 });
}

for(const field of ['id','revision','account','chainId','username']){
 test('review: task approval challenge rejects switched session '+field,async()=>{
  const f=fixture(),p=await f.call('prepare',{policy:f.policy});
  const body={challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:null,code:'123456'};
  const old=f.session[field];f.session[field]=field==='revision'?2:field==='account'?a('7'):field==='chainId'?'1':'different-session';
  await assert.rejects(f.call('authorize',body));assert.equal(f.count().approvals,0);
  f.session[field]=old;await f.call('authorize',body);assert.equal(f.count().approvals,1);await f.store.close();
 });
}

test('review: concurrent approval challenge replay consumes one approval only',async()=>{
 const f=fixture(),p=await f.call('prepare',{policy:f.policy});
 const body={challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:null,code:'123456'};
 const results=await Promise.allSettled([f.call('authorize',body),f.call('authorize',body)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.count().approvals,1);
 await f.store.close();
});

test('review: cancellation invalidates an outstanding session approval challenge',async()=>{
 const f=fixture(),p=await f.call('prepare',{policy:f.policy});f.service.cancel(f.session);
 await assert.rejects(f.call('authorize',{challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:null,code:'123456'}));
 assert.equal(f.count().approvals,0);await f.store.close();
});

test('review: concurrent unknown-outcome reads never dispatch or reclaim nonce',async()=>{
 const f=fixture(),g=await f.grant(),x=f.operation(g,'funded');
 await assert.rejects(f.send(g,'funded',async()=>{throw Error('LOST_RESULT');}));
 const before=(await f.call('status',{taskDigest:g.task.digest})).receiptAttempts;
 const reads=await Promise.all(Array.from({length:10},()=>f.service.receiptAuthorization.readState(x.claimed)));
 assert.ok(reads.every(x=>x.status==='outcome-unknown'&&x.transactionHash===null&&x.executable===false));
 const retry=await Promise.allSettled(Array.from({length:3},()=>f.send(g,'funded')));
 assert.ok(retry.every(x=>x.status==='rejected'));assert.equal(f.count().sends,1);
 assert.deepEqual((await f.call('status',{taskDigest:g.task.digest})).receiptAttempts,before);await f.store.close();
});
