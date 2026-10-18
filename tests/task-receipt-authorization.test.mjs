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
  return call('authorize',{challengeId:c.challengeId,taskDigest:c.task.digest,executorDigest:c.executor.digest,observationPolicyDigest:null,code:c.approvalFactor==='totp'?'123456':''});
 }
 function operation(g,phase){
  const p=g.task.policy.intent.phases.find(p=>p.phase===phase);
  return {claimed:{taskId:g.task.policy.taskId,taskDigest:g.task.digest,executorDigest:g.executor.digest,grantReference:g.authorization.reference,grantPolicyVersion:g.authorization.grantPolicyVersion,operationId:'receipt-'+phase,phase,planDigest:p.planDigest,journalBindingHash:p.journalBindingHash},
   wire:{account:a('1'),chainId:'560048',to:a('5'),data:data[phase],value:'0',nonce:p.nonce,gasLimit:p.gasLimit,maxFeePerGasWei:p.maxFeePerGasWei,maxPriorityFeePerGasWei:p.maxPriorityFeePerGasWei}};
 }
 const send=async(g,phase,callback=async()=>h('a'))=>{const x=operation(g,phase);return service.receiptAuthorization.withAuthorization(x.claimed,x.wire,async(snapshot,revalidate)=>{sends++;revalidate();assert.equal(snapshot.scope.phase,phase);return callback(snapshot,revalidate);});};
 return {state,store,session,policy,service,call,grant,operation,send,count:()=>({approvals,sends})};
}
test('initial ON freezes three separately budgeted phases without a human-factor evaluation',async()=>{
 const f=fixture(),g=await f.grant();assert.equal(g.task.digest,freezeReceiptTask(f.policy).digest);
 assert.equal(g.humanVerification.mode,'ON');assert.equal(g.humanVerification.revision,'0');
 for(const phase of ['funded','registered','paid'])assert.equal((await f.send(g,phase)).phase,phase);
 assert.deepEqual(f.count(),{approvals:0,sends:3});await assert.rejects(f.send(g,'funded'),/TASK_RECEIPT_ALREADY_ATTEMPTED/);assert.equal(f.count().sends,3);await f.store.close();
});
test('old grant/old operation normalization is not reinterpreted as receipt authority',async()=>{
 const f=fixture();const old={...f.policy,intent:{kind:'exact-operation',operation:{kind:'create-account',chainId:'560048',actor:a('1'),controller:{contract:a('5'),runtimeCodeHash:h('8')}}}};
 const p=await f.call('prepare',{policy:old}),g=await f.call('authorize',{challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:null,code:p.approvalFactor==='totp'?'123456':''});
 const x={taskId:g.task.policy.taskId,taskDigest:g.task.digest,executorDigest:g.executor.digest,grantReference:g.authorization.reference,grantPolicyVersion:'1',operationId:'receipt-old',phase:'funded',planDigest:h('1'),journalBindingHash:h('4')};
 await assert.rejects(f.service.receiptAuthorization.withAuthorization(x,{},async()=>h('a')));assert.equal(f.count().sends,0);await f.store.close();
});
test('scope mutation changes human approval digest; unknown fields, duplicate phase and nonce refuse',()=>{
 const f=fixture(),initial=freezeReceiptTask(f.policy).digest;
 for(const [key,value] of [['price','101'],['buyer',a('6')],['paymentToken',a('6')],['tokenId','8']]){
  const p=structuredClone(f.policy);p.intent.sale[key]=value;
  if(key==='buyer')assert.throws(()=>freezeReceiptTask(p));else assert.notEqual(freezeReceiptTask(p).digest,initial);
 }
 for(const key of ['escrow','runtimeCodeHash','segmentId']){const p=structuredClone(f.policy);p.intent[key]=key==='escrow'?a('6'):h('b');assert.notEqual(freezeReceiptTask(p).digest,initial);}
 const p=structuredClone(f.policy);p.intent.phases[1].nonce='0';assert.throws(()=>freezeReceiptTask(p));
 assert.throws(()=>freezeReceiptTask({...f.policy,approved:true}));
});
for(const field of ['account','chainId','to','nonce','data','maxFeePerGasWei']){
 test('receipt dispatch refuses changed '+field+' before callback',async()=>{
 const f=fixture(),g=await f.grant(),x=f.operation(g,'funded');let entered=0;
 x.wire[field]=field==='data'?x.wire.data.slice(0,-2)+'ff':field==='account'||field==='to'?a('6'):field==='chainId'?'11155111':'99';
 await assert.rejects(f.service.receiptAuthorization.withAuthorization(x.claimed,x.wire,async()=>{entered++;return h('a');}));
 assert.equal(entered,0);await f.store.close();
 });
}
test('phase, plan and journal binding tamper refuses',async()=>{
 const f=fixture(),g=await f.grant();
 for(const field of ['phase','planDigest','journalBindingHash']){
  const x=f.operation(g,'funded');x.claimed[field]=field==='phase'?'paid':h('b');
  await assert.rejects(f.service.receiptAuthorization.withAuthorization(x.claimed,x.wire,async()=>h('a')));
 }await f.store.close();
});
test('revoked grant cannot dispatch or acquire new phase claim',async()=>{
 const f=fixture(),g=await f.grant();await f.call('revoke',{taskDigest:g.task.digest,expectedGrantPolicyVersion:'1'});
 await assert.rejects(f.send(g,'funded'));assert.equal(f.count().sends,0);await f.store.close();
});
test('lost result is permanently unknown; duplicate phase cannot send again',async()=>{
 const f=fixture(),g=await f.grant();await assert.rejects(f.send(g,'funded',async()=>{throw Error('synthetic lost reply');}),/TASK_RECEIPT_OUTCOME_UNKNOWN_RECONCILE_ONLY/);
 await assert.rejects(f.send(g,'funded'),/TASK_RECEIPT_ALREADY_ATTEMPTED/);assert.equal(f.count().sends,1);await f.store.close();
});
test('expiry while holding gate revalidates before a send',async()=>{
 const f=fixture(),g=await f.grant(),x=f.operation(g,'funded');let sent=0;
 await assert.rejects(f.service.receiptAuthorization.withAuthorization(x.claimed,x.wire,async(_,revalidate)=>{
 f.state.now+=700000;revalidate();sent++;return h('a');}),/TASK_RECEIPT_OUTCOME_UNKNOWN_RECONCILE_ONLY/);
 assert.equal(sent,0);await f.store.close();
});
test('unconfigured receipt gate fails closed before human challenge creation',async()=>{
 const f=fixture({handler:null});await assert.rejects(f.call('prepare',{policy:f.policy}),/TASK_RECEIPT_GATE_NOT_CONFIGURED/);assert.equal(f.count().approvals,0);await f.store.close();
});

import { createReceiptProviderHandler } from '../server/receipt-provider-handler.mjs';
function providerFixture(f, scenario='valid'){
  let sends=0,accounts=0;
  const provider={request:async({method,params})=>{
    if(method==='eth_accounts'){accounts++;return scenario==='switch'&&accounts>1?[a('6')]:scenario==='disconnect'?[]:[a('1')];}
    if(method==='eth_chainId')return scenario==='chain'?'0x1':'0x88bb0';
    if(method==='eth_getCode')return scenario==='code'?'0x6001':'0x6000';
    if(method==='eth_getTransactionCount')return scenario==='nonce'?'0x99':'0x0';
    if(method==='eth_call'){if(scenario==='simulation')throw Error('synthetic revert');return '0x';}
    if(method==='eth_sendTransaction'){sends++;assert.equal(params[0].nonce,'0x0');assert.equal(params[0].value,'0x0');assert.equal(params[0].chainId,'0x88bb0');return h('b');}
    throw Error('UNEXPECTED_PROVIDER_METHOD');
  }};
  return {provider,count:()=>sends};
}
test('fixed provider handler carries the exact approved transaction through existing lease',async()=>{
 const f=fixture();f.policy.intent.runtimeCodeHash=keccak256('0x6000');const g=await f.grant(),x=f.operation(g,'funded'),p=providerFixture(f);
 const handler=createReceiptProviderHandler({authorization:f.service.receiptAuthorization,provider:p.provider,task:g.task,claimed:x.claimed,now:()=>f.state.now});
 assert.deepEqual(await handler.identity(),{account:a('1'),chainId:560048});
 const req={account:a('1'),chainId:560048,to:a('5'),data:x.wire.data,value:0n};
 assert.equal(await handler.sendTransaction(req),h('b'));assert.equal(p.count(),1);
 await assert.rejects(handler.sendTransaction(req),/TASK_RECEIPT_ALREADY_ATTEMPTED/);assert.equal(p.count(),1);await f.store.close();
});
for(const scenario of ['switch','disconnect','chain','code','nonce','simulation']){
 test('fixed provider handler '+scenario+' refusal occurs before send',async()=>{
 const f=fixture();f.policy.intent.runtimeCodeHash=keccak256('0x6000');const g=await f.grant(),x=f.operation(g,'funded'),p=providerFixture(f,scenario);
 const handler=createReceiptProviderHandler({authorization:f.service.receiptAuthorization,provider:p.provider,task:g.task,claimed:x.claimed,now:()=>f.state.now});
 await assert.rejects(handler.sendTransaction({account:a('1'),chainId:560048,to:a('5'),data:x.wire.data,value:0n}));
 assert.equal(p.count(),0);await f.store.close();
 });
}
test('receipt scope refuses nonce reuse, excess phase fees and recovery-policy change',()=>{
 const f=fixture();
 for(const mutate of [
  p=>{p.intent.phases[1].nonce=p.intent.phases[0].nonce;},
  p=>{p.fees.totalWei='100000';},
  p=>{p.intent.phases[0].maxFeePerGasWei='100';},
  p=>{p.intent.recovery.unknownOutcome='retry';},
  p=>{p.intent.phases[1].phase=p.intent.phases[0].phase;}
 ]){const p=structuredClone(f.policy);mutate(p);assert.throws(()=>freezeReceiptTask(p));}
});
test('receipt preparation does not invoke getter side effects or accept wildcard scope',async()=>{
 const f=fixture();let invoked=0;
 const policy={...f.policy};Object.defineProperty(policy,'intent',{enumerable:true,get(){invoked++;return f.policy.intent;}});
 await assert.rejects(f.call('prepare',{policy}));assert.equal(invoked,0);
 const p=structuredClone(f.policy);p.intent.escrow='*';assert.throws(()=>freezeReceiptTask(p));await f.store.close();
});

import {readFileSync} from 'node:fs';
const browserText=readFileSync(new URL('../web/task-authorization.mjs',import.meta.url),'utf8')
 .replace('./task-listing-results.mjs',new URL('../web/task-listing-results.mjs',import.meta.url).href)
  .replace('./observation-source-contract.mjs',new URL('../web/observation-source-contract.mjs',import.meta.url).href)
  .replace('./task-observer-context.mjs',new URL('../web/task-observer-context.mjs',import.meta.url).href)
 .replace('../dist/browser/agent/taskContract.js',new URL('../src/agent/taskContract.ts',import.meta.url).href)
 .replace('../dist/browser/agent/receiptTask.js',new URL('../src/agent/receiptTask.ts',import.meta.url).href)
 .replace('../dist/browser/agent/receiptObservation.js',new URL('../src/agent/receiptObservation.ts',import.meta.url).href)
 .replace('../dist/browser/vendor/ethers.js',import.meta.resolve('ethers'));
const {TaskAuthorizationClient}=await import('data:text/javascript;base64,'+Buffer.from(browserText).toString('base64'));
test('existing browser task approval presents receipt scope and submission markers without chain-finality claim',async()=>{
 const f=fixture(),client=new TaskAuthorizationClient({request:(path,body)=>f.service.handler(path,body,f.session),
  context:{origin:f.policy.origin,tenant:'xiongan',account:a('1'),chainId:'560048'}});
 const task=freezeReceiptTask(f.policy),challenge=await client.prepare(task);
 assert.equal(challenge.approvalFactor,'preoperational-default-on');
 const view=await client.authorize(challenge,challenge.approvalFactor==='totp'?'123456':'');
 assert.equal(view.task.policy.intent.kind,'artfi-receipt');assert.deepEqual(view.receiptAttempts,[]);
 await f.send(view,'funded');
 const updated=await client.status(task.digest);assert.equal(updated.receiptAttempts[0].phase,'funded');
 assert.equal(updated.receiptAttempts[0].status,'submitted');assert.equal(updated.completion.fresh,false);
 assert.equal(f.count().approvals,0);await f.store.close();
});
test('receipt phases cannot enter the generic automatic-resume path',async()=>{
 const f=fixture(),g=await f.grant(),result=await f.call('resume',{taskDigest:g.task.digest});
 assert.equal(result.continuation.code,'TASK_RECEIPT_FIXED_HANDLER_REQUIRED');assert.equal(f.count().sends,0);await f.store.close();
});
test('queued revoke before the post-claim read gate wins without dispatch',async()=>{
 const f=fixture(),g=await f.grant(),original=f.store.withReadGate.bind(f.store);
 f.store.withReadGate=async(keys,action)=>{await f.call('revoke',{taskDigest:g.task.digest,expectedGrantPolicyVersion:'1'});return original(keys,action);};
 await assert.rejects(f.send(g,'funded'),/TASK_RECEIPT_OUTCOME_UNKNOWN_RECONCILE_ONLY/);assert.equal(f.count().sends,0);await f.store.close();
});
test('revoke ordered after an invoked action cannot erase its submitted journal record',async()=>{
 const f=fixture(),g=await f.grant();let revoke;
 await f.send(g,'funded',async()=>{revoke=f.call('revoke',{taskDigest:g.task.digest,expectedGrantPolicyVersion:'1'});return h('a');});
 await revoke;const status=await f.call('status',{taskDigest:g.task.digest});
 assert.equal(status.effectiveStatus,'revoked');assert.equal(status.receiptAttempts[0].status,'submitted');
 await assert.rejects(f.send(g,'registered'));assert.equal(f.count().sends,1);await f.store.close();
});

test('read-only receipt recovery remains available after revoke and never dispatches',async()=>{
 const f=fixture(),g=await f.grant(),x=f.operation(g,'funded');
 await f.send(g,'funded');await f.call('revoke',{taskDigest:g.task.digest,expectedGrantPolicyVersion:'1'});
 const state=await f.service.receiptAuthorization.readState(x.claimed);
 assert.equal(state.status,'submitted');assert.equal(state.transactionHash,h('a'));assert.equal(state.executable,false);
 assert.equal(f.count().sends,1);await f.store.close();
});
test('lost-result readback exposes unknown without clearing nonce or phase obligation',async()=>{
 const f=fixture(),g=await f.grant(),x=f.operation(g,'funded');
 await assert.rejects(f.send(g,'funded',async()=>{throw Error('synthetic lost result');}));
 const state=await f.service.receiptAuthorization.readState(x.claimed);
 assert.equal(state.status,'outcome-unknown');assert.equal(state.transactionHash,null);assert.equal(state.executable,false);
 await assert.rejects(f.send(g,'funded'));assert.equal(f.count().sends,1);await f.store.close();
});

test('seller listing grant with valuation cannot borrow receipt financial authority',async()=>{
 const f=fixture();f.session.chainId='1';
 const policy={...f.policy,chainId:'1',intent:{kind:'nft-sale',direction:'sell',standard:'ERC-721',contract:a('3'),tokenId:'7',quantity:'1',minimumProceeds:{currency:'USD',amountMinor:'100',minorUnit:2,comparison:'gte',basis:'net'},marketAdapters:['artfi:seaport']}};
 const valuationPolicy={source:'synthetic:quote',base:{chainId:'1',token:a('0'),decimals:18},quote:{currency:'USD',decimals:2},rateDecimals:8,priceAt:'order-review',validFrom:String(epoch/1000-1),validUntil:String(epoch/1000+600),maxAgeSeconds:'60'};
 const p=await f.call('prepare',{policy,valuationPolicy}),g=await f.call('authorize',{challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:null,valuationPolicyDigest:p.valuationPolicy.digest,priceAt:'order-review',code:p.approvalFactor==='totp'?'123456':''});
 const claimed={taskId:g.task.policy.taskId,taskDigest:g.task.digest,executorDigest:g.executor.digest,grantReference:g.authorization.reference,grantPolicyVersion:'1',operationId:'fake-receipt',phase:'paid',planDigest:h('1'),journalBindingHash:h('4')};
 let entered=0;await assert.rejects(f.service.receiptAuthorization.withAuthorization(claimed,{},async()=>{entered++;return h('a');}));assert.equal(entered,0);await f.store.close();
});
test('global nonce claim excludes a second explicitly approved receipt task',async()=>{
 const f=fixture(),g=await f.grant();await f.send(g,'funded');f.policy.taskId='synthetic-receipt-second';
 const second=await f.grant(),x=f.operation(second,'funded');x.claimed.operationId='receipt-funded-other';
 let entered=0;await assert.rejects(f.service.receiptAuthorization.withAuthorization(x.claimed,x.wire,async()=>{entered++;return h('a');}),/TASK_NONCE_OCCUPIED/);assert.equal(entered,0);await f.store.close();
});
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openEncryptedStore} from '../server/store.mjs';
test('encrypted restart preserves new-grant unknown phase and nonce without another approval',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wallet-receipt-grant-')),path=join(root,'state.json'),key=Buffer.alloc(32,0x37);
 let store=await openEncryptedStore(path,key);
 try{
  await store.transaction('xiongan:tester',()=>({revision:1,synthetic:true}));
  const first=fixture({store}),g=await first.grant(),x=first.operation(g,'funded');
  await assert.rejects(first.send(g,'funded',async()=>{throw Error('synthetic lost reply');}));
  await store.close();store=await openEncryptedStore(path,key);
  const restored=fixture({store}),state=await restored.service.receiptAuthorization.readState(x.claimed);
  assert.equal(state.status,'outcome-unknown');assert.equal(state.executable,false);
  await assert.rejects(restored.send(g,'funded'),/TASK_RECEIPT_ALREADY_ATTEMPTED/);
  assert.equal(restored.count().approvals,0);assert.equal(restored.count().sends,0);
 }finally{await store.close();assert.ok(root.startsWith(join(tmpdir(),'wallet-receipt-grant-')));await rm(root,{recursive:true,force:true});}
});
