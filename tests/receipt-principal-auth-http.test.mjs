/** Normal HTTP-handler principal authorization software tests; no live funds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,policy,template,a,h,origin,epoch} from './helpers/principal-auth-http-fixture.mjs';
import {receiptPrincipalPurposeDigest} from '../src/agent/receiptPrincipal.ts';
import {taskVerificationPolicyKey} from '../server/task-verification-state.mjs';
import {digest} from '../server/crypto.mjs';
import {createTaskReceiptRuntime} from '../server/task-receipt-runtime.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {createHash} from 'node:crypto';
import {createServer,request as httpRequest} from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';

test('an independent native HTTP consume request validates the held closure without inheriting its entry context',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
 const p=c.receiptPrincipalPurpose,port=f.port(),journal=new MemoryCredentialStore(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const runtime=createTaskReceiptRuntime({store:f.store,journalStore:journal,peerId:'spiffe://test/wallet',consumerPeerId:'spiffe://test/native',digest:hash,nativeDigest:hash,now:()=>f.clock.now});
 runtime.connectAuthorization(f.receiptPort());runtime.connectPrincipalAuthorization(port);
 // This loopback HTTP server deliberately models a SEPARATE authenticated
 // consumer request. Fixed TEST_ONLY peer identity is not real mTLS evidence.
 // Its async resources are created before either original held context exists.
 const marker=new AsyncLocalStorage();let independent=0;
 const server=createServer(async(req,res)=>{
  try{
   assert.equal(marker.getStore(),undefined);independent++;
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=JSON.parse(Buffer.concat(chunks).toString());
   const claim=runtime.consumeCapability(body,req.url==='/wrong-peer'?'spiffe://test/wrong':'spiffe://test/native');
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({claim}));
  }catch(error){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{runtime.stop();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await journal.close();});
 const send=(body,path='/consume')=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method:'POST',agent:false,headers:{'content-type':'application/json'}},res=>{
   const chunks=[];res.on('data',x=>chunks.push(x));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
  });req.on('error',reject);req.end(JSON.stringify(body));
 });
 const operation={id:'native_'+hash(p.task)},scope={peerId:'spiffe://test/wallet',principal:{kind:'task',...p.task},action:'get',nativeOperationId:operation.id,planDigest:'',requestDigest:hash({action:'get',operation}),operation};
 const consume=capability=>({capability,peerId:scope.peerId,action:'get',nativeOperationId:operation.id,planDigest:'',requestDigest:scope.requestDigest});
 let escaped,originalGuard;
 await marker.run('ORIGINAL_HELD_REQUEST',()=>port.withPurposeAuthorization(p,'freeze',async(_snapshot,guard)=>{
  originalGuard=guard;
  await assert.rejects(runtime.withPrincipalJournalCapability(p,()=>guard(),scope,()=>assert.fail('value-equivalent guard admitted')));
  await assert.rejects(runtime.withPrincipalJournalCapability(p,guard,{...scope,action:'update'},()=>assert.fail('write admitted')),/READ_ONLY/);
  await runtime.withPrincipalJournalCapability(p,guard,scope,async token=>{
   escaped=consume(token);assert.equal((await send(escaped,'/wrong-peer')).status,403);
   const actual=await send(escaped);assert.equal(actual.status,200,JSON.stringify(actual.body));const claim=actual.body.claim;
   assert.deepEqual(claim.principal,scope.principal);assert.equal(claim.wallet,p.account);assert.equal(claim.chainId,Number(p.chainId));
   assert.equal(claim.receiptPhase,'funded');assert.equal(claim.receiptNonce,'0');assert.equal(claim.receiptPlanDigest,p.receipt.planDigest);assert.equal(claim.receiptJournalBindingHash,p.receipt.journalBindingHash);
   assert.equal((await send(escaped)).status,403);
  });
  await runtime.withPrincipalJournalCapability(p,guard,scope,async token=>{
   assert.equal((await send({...consume(token),planDigest:'f'.repeat(64)})).status,403);
   assert.equal((await send(consume(token))).status,403);
  });
  await runtime.withPrincipalJournalCapability(p,guard,scope,async token=>{
   const saved=f.clock.now;f.clock.now+=10000;
   try{assert.equal((await send(consume(token))).status,403);}finally{f.clock.now=saved;}
   assert.equal((await send(consume(token))).status,403);
  });
 }));
 assert.equal((await send(escaped)).status,403);assert.ok(independent>=8);
 await assert.rejects(runtime.withPrincipalJournalCapability(p,originalGuard,scope,()=>assert.fail('escaped request admitted')));
 const state=await f.receiptPort().readState({...p.task,phase:'funded',planDigest:p.receipt.planDigest,journalBindingHash:p.receipt.journalBindingHash});assert.equal(state.status,'not-attempted');assert.equal(state.transactionHash,null);
});

test('principal native get uses the original receipt registry once without reserving a send',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
 const p=c.receiptPrincipalPurpose,port=f.port(),journal=new MemoryCredentialStore(),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const runtime=createTaskReceiptRuntime({store:f.store,journalStore:journal,peerId:'spiffe://test/wallet',consumerPeerId:'spiffe://test/native',digest:hash,nativeDigest:hash,now:()=>f.clock.now});
 runtime.connectAuthorization(f.receiptPort());runtime.connectPrincipalAuthorization(port);t.after(async()=>{runtime.stop();await journal.close();});
 const operation={id:'native_'+hash(p.task)},scope={peerId:'spiffe://test/wallet',principal:{kind:'task',...p.task},action:'get',nativeOperationId:operation.id,planDigest:'',requestDigest:hash({action:'get',operation}),operation};
 const request=token=>({capability:token,peerId:scope.peerId,action:'get',nativeOperationId:operation.id,planDigest:'',requestDigest:scope.requestDigest});
 let token,originalGuard;
 await port.withPurposeAuthorization(p,'freeze',async(_scope,guard)=>{
  originalGuard=guard;
  await assert.rejects(runtime.withPrincipalJournalCapability(p,guard,{...scope,action:'create'},()=>assert.fail('write admitted')),/READ_ONLY/);
  const result=await runtime.withPrincipalJournalCapability(p,guard,scope,async value=>{
   token=value;await Promise.resolve();const claim=runtime.consumeCapability(request(value),'spiffe://test/native');
   assert.deepEqual(claim.principal,scope.principal);assert.equal(claim.receiptPhase,'funded');assert.equal(claim.receiptNonce,'0');
   assert.equal(claim.receiptPlanDigest,p.receipt.planDigest);assert.equal(claim.receiptJournalBindingHash,p.receipt.journalBindingHash);
   assert.equal(claim.wallet,p.account);assert.equal(claim.chainId,Number(p.chainId));
   assert.throws(()=>runtime.consumeCapability(request(value),'spiffe://test/native'),/CAPABILITY_REFUSED/);return 'TEST_ONLY_NATIVE_GET';
  });assert.equal(result,'TEST_ONLY_NATIVE_GET');
 });
 assert.throws(()=>runtime.consumeCapability(request(token),'spiffe://test/native'),/CAPABILITY_REFUSED/);
 await assert.rejects(runtime.withPrincipalJournalCapability(p,originalGuard,scope,()=>assert.fail('escaped get')));
 const state=await f.receiptPort().readState({...p.task,phase:'funded',planDigest:p.receipt.planDigest,journalBindingHash:p.receipt.journalBindingHash});assert.equal(state.status,'not-attempted');assert.equal(state.transactionHash,null);
});

for(const gap of [0n,1n,2n])test('normal principal approval requires a usable rollback second before expiry: gap '+gap,async t=>{
 const f=await fixture(t),p=template(),original=policy();p.mintTerms.registrationDeadline=(BigInt(original.expiresAt)-gap).toString();
 const r=await f.call('tasks/prepare',{policy:original,receiptPrincipal:p});
 if(gap<2n)assert.notEqual(r.status,200);
 else{assert.equal(r.status,200);assert.equal((await f.call('tasks/authorize',f.approval(r.data))).status,200);}
});
test('native journal snapshot reuses the original held principal gate without another store read or grant',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
 const p=c.receiptPrincipalPurpose,port=f.port();let escaped,originalGuard;
 await port.withPurposeAuthorization(p,'freeze',async(scope,guard)=>{
  originalGuard=guard;const methods=['read','readMany','withReadGate','transactionMany'],saved=methods.map(k=>f.store[k]);
  for(const k of methods)f.store[k]=()=>assert.fail('nested grant/store access');
  try{
   const actual=await port.withPurposeJournalSnapshot(p,guard,async(snapshot,revalidate)=>{
    escaped=revalidate;assert.deepEqual(snapshot.task,c.task);assert.deepEqual(snapshot.executor,c.executor);
    assert.equal(snapshot.grantReference,p.task.grantReference);assert.equal(snapshot.operationId,p.task.operationId);
    assert.equal(snapshot.scope.phase,'funded');assert.equal(snapshot.scope.nonce,'0');assert.equal(snapshot.scope.planDigest,p.receipt.planDigest);
    assert.equal(snapshot.scope.journalBindingHash,p.receipt.journalBindingHash);assert.equal(snapshot.scope.segmentId,p.receipt.segmentId);
    assert.equal(snapshot.scope.actor,p.account);assert.equal(snapshot.scope.chainId,p.chainId);assert.equal(snapshot.expiresAtMs,scope.expiresAtMs);
    await Promise.resolve();assert.equal(revalidate(),snapshot);assert.ok(Object.isFrozen(snapshot.task.policy));return snapshot;
   });
   assert.equal(actual.task.digest,p.task.taskDigest);assert.throws(escaped,/GATE_CLOSED/);
  }finally{methods.forEach((k,i)=>{f.store[k]=saved[i];});}
 });
 await assert.rejects(port.withPurposeJournalSnapshot(p,originalGuard,()=>assert.fail('escaped scope')));
 assert.throws(originalGuard,/GATE_CLOSED/);
});

test('journal snapshot refuses a cloned guard, changed purpose and an expired held principal',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
 const p=c.receiptPrincipalPurpose,port=f.port();await port.withPurposeAuthorization(p,'freeze',async(_scope,guard)=>{
  await assert.rejects(port.withPurposeJournalSnapshot(p,()=>guard(),()=>assert.fail('forged guard')));
  await assert.rejects(port.withPurposeJournalSnapshot({...p,amountBaseUnits:'1'},guard,()=>assert.fail('changed purpose')));
  await port.withPurposeJournalSnapshot(p,guard,async(_snapshot,revalidate)=>{
   const saved=f.clock.now;f.clock.now+=4000000;assert.throws(revalidate);f.clock.now=saved;assert.throws(revalidate,/GATE_CLOSED/);
  });
 });
});
test('new rollback admission does not erase observation of a TEST_ONLY previously approved legacy purpose',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
 // Model the persisted shape accepted before the new admission rule, not a
 // current approval or permission to alter a production grant.
 const legacy=structuredClone(c.receiptPrincipalPurpose);legacy.mintTerms.registrationDeadline=c.task.policy.expiresAt;
 const queue=await f.store.read('task-queue:'+digest(JSON.stringify([origin,'xiongan'])));assert.equal(queue.entries.length,1);
 await f.store.transaction(queue.entries[0],grant=>({...grant,receiptPrincipalPurpose:legacy}));
 const observed=await f.port().withPurposeObservation(legacy,async scope=>scope.purpose);assert.deepEqual(observed,legacy);
 f.clock.now=Number(BigInt(c.task.policy.expiresAt)*1000n)+1;
 assert.deepEqual(await f.port().withPurposeObservation(legacy,async scope=>scope.purpose),legacy);
 await assert.rejects(f.port().withPurposeAuthorization(legacy,'release',()=>assert.fail('expired grant extended')));
});
test('normal password/CSRF/task approval persists the exact new purpose and reopens its original owner gate',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal(c.approvalFactor,'preoperational-default-on');assert.equal(c.receiptPrincipalPurposeDigest,receiptPrincipalPurposeDigest(c.receiptPrincipalPurpose));
 assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
 const seen=await f.port().withPurposeAuthorization(c.receiptPrincipalPurpose,'freeze',async(s,revalidate)=>{assert.deepEqual(revalidate(),s);return s;});assert.equal(seen.principal.username,'tester');assert.equal(seen.principal.account,a('1'));assert.equal(seen.purpose.task.grantReference,c.receiptPrincipalPurpose.task.grantReference);
 f.restart();assert.equal((await f.port().withPurposeObservation(c.receiptPrincipalPurpose,async s=>s)).purpose.amountBaseUnits,'100');
});
test('omitted or changed purpose digest cannot authorize the pending full proposal',async t=>{
 const f=await fixture(t),c=await f.prepare(),body=f.approval(c);delete body.receiptPrincipalPurposeDigest;assert.notEqual((await f.call('tasks/authorize',body)).status,200);body.receiptPrincipalPurposeDigest=h('f');assert.notEqual((await f.call('tasks/authorize',body)).status,200);assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
});
test('a legacy approved receipt grant cannot acquire principal authority from a supplied purpose',async t=>{
 const f=await fixture(t),c=await f.prepare(null);const g=await f.call('tasks/authorize',f.approval(c));assert.equal(g.status,200);assert.equal(g.data.receiptPrincipalPurpose,undefined);
 const p={...template(),task:{taskId:c.task.policy.taskId,taskDigest:c.task.digest,executorDigest:c.executor.digest,grantReference:g.data.authorization.reference,grantPolicyVersion:'1',operationId:'test-principal-operation'}};
 await assert.rejects(f.port().withPurposeAuthorization(p,'freeze',async()=>assert.fail('old grant upgraded')));
});
test('revocation fences new principal effects while retaining exact historical purpose observation',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);assert.equal((await f.call('tasks/revoke',{taskDigest:c.task.digest,expectedGrantPolicyVersion:'1'})).status,200);
 await assert.rejects(f.port().withPurposeAuthorization(c.receiptPrincipalPurpose,'settle',async()=>assert.fail('revoked effect')));assert.equal((await f.port().withPurposeObservation(c.receiptPrincipalPurpose,async s=>s)).purpose.task.grantPolicyVersion,'1');
});
test('owner session and CSRF remain required for new principal approval',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.notEqual((await f.call('tasks/authorize',f.approval(c),{'x-wallet-csrf':'wrong'})).status,200);assert.notEqual((await f.call('tasks/authorize',f.approval(c),{cookie:''})).status,200);assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
});
for(const [field,value] of [['amountBaseUnits','101'],['payee',a('7')],['account',a('7')],['chainId','1']])test('purpose refuses mismatched original sale '+field,async t=>{
 const f=await fixture(t),p=template();p[field]=value;const r=await f.call('tasks/prepare',{policy:policy(),receiptPrincipal:p});assert.notEqual(r.status,200);
});
test('pending purpose cannot be replaced under an unchanged task digest',async t=>{
 const f=await fixture(t);await f.prepare();const changed=template();changed.mintTerms.mintPolicyHash=h('e');assert.notEqual((await f.call('tasks/prepare',{policy:policy(),receiptPrincipal:changed})).status,200);
});
test('a saved effective ON lock cannot be bypassed by the new principal port',async t=>{
 const f=await fixture(t),c=await f.prepare();assert.equal((await f.call('tasks/authorize',f.approval(c))).status,200);
 const scope={origin,tenant:'xiongan',username:'tester',account:a('1'),chainId:'560048',agentId:'test-principal'},scopeDigest=digest(JSON.stringify(scope));
 await f.store.transaction('xiongan:tester',credential=>({...credential,revision:0,taskVerificationPolicies:{[taskVerificationPolicyKey(scope)]:{schema:'8415-task-human-verification/2',scope,mode:'ON',revision:'1',enforcedFromRevision:'1',changes:[{revision:'1',previousRevision:'0',mode:'ON',changeId:'A'.repeat(43),changeDigest:'b'.repeat(64),scopeDigest,credentialRevision:0,verifiedFactors:['password','verified-email'],changedAt:epoch}]}}}));
 await assert.rejects(f.port().withPurposeAuthorization(c.receiptPrincipalPurpose,'freeze',async()=>assert.fail('effective ON lock bypassed')),/TASK_RECEIPT_PRINCIPAL_OPERATION_VERIFICATION_NOT_CONNECTED/);
 assert.equal((await f.port().withPurposeObservation(c.receiptPrincipalPurpose,async s=>s)).purpose.amountBaseUnits,'100');
});
