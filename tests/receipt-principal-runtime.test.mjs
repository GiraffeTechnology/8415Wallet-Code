/** TEST_ONLY adapter/journal units, not normal-login or financial acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MemoryCredentialStore,openEncryptedStore} from '../server/store.mjs';
import {createReceiptPrincipalRuntime} from '../server/receipt-principal-runtime.mjs';
import {normalizeReceiptPrincipalPurpose,receiptPrincipalPurposeDigest} from '../src/agent/receiptPrincipal.ts';
const a=n=>'0x'+n.repeat(40),h=n=>'0x'+n.repeat(64);
function input(){return normalizeReceiptPrincipalPurpose({schema:'8415-receipt-principal-purpose/1',reservationId:'test-reservation',tenant:'test-wallet',origin:'https://wallet.example',account:a('1'),chainId:'31337',currency:{kind:'erc20',contract:a('2'),decimals:6},amountBaseUnits:'500000000',payee:a('3'),task:{taskId:'test-parent',taskDigest:h('1'),executorDigest:h('2'),grantReference:'TEST_ONLY_SYNTHETIC_AUTHORITY',grantPolicyVersion:'1',operationId:'test-operation'},receipt:{collection:a('4'),tokenId:'7',segmentId:h('3'),planDigest:h('4'),journalBindingHash:h('5')},lineage:{id:'test-lineage',index:'2',previousReservationId:'test-previous'},mintTerms:{policyVersion:'test-policy.v1',assetId:'test-asset',tokenId:'7',source:{chainId:'31337',contract:a('6'),registerId:'registry:7',sourceAuthority:'TEST_ONLY_SOURCE'},mintRecordCommitment:h('7'),mintPolicyHash:h('6'),registrationDeadline:'2000000000'}});}
const request=(eventId,expectedRevision='0',evidenceReference=null)=>({eventId,expectedRevision,evidenceReference});
function fixture(store=new MemoryCredentialStore()){
 const p=input(),digest=receiptPrincipalPurposeDigest(p),clock={now:1800000000000,revoked:false,readSource:'ready',evidenceRefused:false,evidenceChanged:false,throwAfterCommit:false,skipCommitGuard:false};
 const financial={balance:1000000000n,payee:0n,holds:new Map()},calls={freeze:0,settle:0,release:0,reconcile:0,reads:0};
 const authStore={TEST_ONLY:true};
 const snapshot=()=>({purpose:p,principal:{origin:p.origin,tenant:p.tenant,username:'test-owner',account:p.account,chainId:p.chainId},expiresAtMs:2000000600000});
 const checkPurpose=purpose=>assert.equal(receiptPrincipalPurposeDigest(purpose),digest);
 const authorization={assertIndependentStore(candidate){assert.notEqual(candidate,authStore);},
  async withPurposeAuthorization(purpose,action,fn){checkPurpose(purpose);const check=()=>{if(clock.revoked)throw Error('TEST_AUTHORITY_REVOKED');return snapshot();};return fn(check(),check);},
  async withPurposeObservation(purpose,fn){checkPurpose(purpose);return fn(snapshot(),snapshot);}};
 const currency={chainId:p.chainId,...p.currency};
 const fundsReader={async readForPrincipal(context){calls.reads++;return {schema:'8415-authoritative-funds/1',scope:{...context.principal},readId:context.readId,observedAt:clock.now,validUntil:clock.now+60000,inventoryState:clock.readSource==='partial'?'partial':'complete',currencies:[{currency,state:clock.readSource==='unavailable'?'unavailable':'ready',balanceBasis:'total-includes-escrow',balanceBaseUnits:financial.balance.toString(),blockHash:h('a'),escrowState:'complete',escrows:[...financial.holds.values()].map(v=>({kind:'financial-principal',reservationId:p.reservationId,nftId:'test-nft:7',currency,amountBaseUnits:p.amountBaseUnits,state:v.status,blockHash:h('a')}))}]};}};
 const result=(action,reference)=>({schema:'8415-receipt-principal-effect/1',action,effectId:p.reservationId+':'+action,purposeDigest:digest,outcome:'confirmed',reference,amountBaseUnits:p.amountBaseUnits,recipient:action==='settle'?p.payee:p.account});
 const fundsEffects={
  async freezeExisting(fixed,guard){calls.freeze++;assert.equal(fixed.purposeDigest,digest);assert.equal(fixed.holdReference,null);if(!clock.skipCommitGuard)guard();checkPurpose(fixed.purpose);checkAvailable();financial.holds.set(p.reservationId,{status:'held',reference:'test-original-hold'});if(clock.pause){clock.entered();await clock.pause;}if(clock.throwAfterCommit)throw Error('TEST_LOST_ADAPTER_RESPONSE');return result('freeze','test-original-hold');},
  async settleHeld(fixed,guard){calls.settle++;guard();assert.equal(fixed.holdReference,'test-original-hold');const held=financial.holds.get(p.reservationId);assert.equal(held.status,'held');financial.balance-=BigInt(p.amountBaseUnits);financial.payee+=BigInt(p.amountBaseUnits);held.status='released';if(clock.throwAfterCommit)throw Error('TEST_LOST_ADAPTER_RESPONSE');return result('settle','test-settlement');},
  async releaseHeld(fixed,guard){calls.release++;guard();assert.equal(fixed.holdReference,'test-original-hold');assert.equal(financial.holds.get(p.reservationId).status,'held');financial.holds.get(p.reservationId).status='refunded';return result('release','test-release');},
  async reconcile(fixed){calls.reconcile++;assert.equal(fixed.effectId,p.reservationId+':freeze');assert.equal(financial.holds.get(p.reservationId)?.status,'held');return result('freeze','test-original-hold');}
 };
 function checkAvailable(){const held=[...financial.holds.values()].filter(x=>x.status==='held').length*Number(p.amountBaseUnits);assert.ok(financial.balance-BigInt(held)>=BigInt(p.amountBaseUnits));}
 const registration=()=>({sourceReference:'TEST_ONLY_APPLICATION_REGISTRATION',purposeDigest:digest,mintPolicyHash:p.mintTerms.mintPolicyHash,chainId:p.chainId,collection:p.receipt.collection,tokenId:p.receipt.tokenId,registeredHolder:p.account,registeredAt:clock.evidenceChanged?'2000000001':'2000000000'});
 const rollback=()=>({sourceReference:'TEST_ONLY_APPLICATION_ROLLBACK',purposeDigest:digest,mintPolicyHash:p.mintTerms.mintPolicyHash,chainId:p.chainId,collection:p.receipt.collection,tokenId:p.receipt.tokenId,validHolder:a('8'),observedAt:'2000000001',firstUnresolvedIndex:'1',registrationCompleted:false});
 const evidence={withMintTerms(purpose,fn){checkPurpose(purpose);return fn(p.mintTerms,()=>p.mintTerms);},
  withRegistrationAuthorization(purpose,reference,fn){checkPurpose(purpose);assert.equal(reference,'test-registration');if(clock.evidenceRefused)throw Error('TEST_EVIDENCE_NOT_FINAL');return fn(registration(),registration);},
  withRollbackAuthorization(purpose,reference,fn){checkPurpose(purpose);assert.equal(reference,'test-rollback');return fn(rollback(),rollback);}};
 const options=()=>({store,authorization,fundsReader,fundsEffects,evidence,origin:p.origin,tenant:p.tenant,now:()=>clock.now});
 const runtime=createReceiptPrincipalRuntime(options());return {p,clock,financial,calls,store,authorization,fundsReader,fundsEffects,evidence,runtime,options};
}
async function close(f){await f.runtime.stop();await f.store.close();}
test('existing principal is held then settled once to the fixed payee, without a second buyer debit',async()=>{
 const f=fixture();try{const held=await f.runtime.freeze(f.p,request('freeze-original'));assert.equal(held.status,'held');assert.equal(f.financial.balance,1000000000n);
  const settled=await f.runtime.settle(f.p,request('settle-original',held.revision,'test-registration'));assert.equal(settled.status,'settled');assert.equal(settled.holdReference,held.holdReference);assert.equal(f.financial.balance,500000000n);assert.equal(f.financial.payee,500000000n);
  assert.deepEqual(await f.runtime.freeze(f.p,request('freeze-original')),settled);assert.equal(f.calls.freeze,1);assert.equal(f.calls.settle,1);
 }finally{await close(f);}
});
test('the authorized unresolved suffix releases the same hold to its original owner',async()=>{
 const f=fixture();try{const held=await f.runtime.freeze(f.p,request('freeze'));f.clock.now=2000000001000;
  const released=await f.runtime.rollback(f.p,request('rollback',held.revision,'test-rollback'));assert.equal(released.status,'released');assert.equal(f.financial.balance,1000000000n);assert.equal(f.financial.payee,0n);assert.equal(f.financial.holds.get(f.p.reservationId).status,'refunded');assert.equal(f.calls.freeze,1);assert.equal(f.calls.release,1);
 }finally{await close(f);}
});
test('a read/content DTO cannot be installed as evidence authority and no default effects exist',async()=>{
 const f=fixture();try{await f.runtime.stop();assert.throws(()=>createReceiptPrincipalRuntime({...f.options(),evidence:{withMintTerms:f.evidence.withMintTerms,registrationForPurpose:async()=>({temporalFinality:'NOT_EVALUATED'}),rollbackForPurpose:async()=>({rollbackAuthorization:'NOT_PROVIDED'})}}),/CAPABILITY_REQUIRED/);
  assert.throws(()=>createReceiptPrincipalRuntime({...f.options(),fundsEffects:{}}),/CAPABILITY_REQUIRED/);assert.equal(f.calls.freeze,0);
 }finally{await f.store.close();}
});
test('revocation or missing current financial inventory refuses before a new funds effect',async()=>{
 const f=fixture();try{f.clock.revoked=true;await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/REVOKED/);assert.equal(f.calls.freeze,0);f.clock.revoked=false;f.clock.readSource='unavailable';await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/FUNDS_SOURCE_UNAVAILABLE/);assert.equal(f.calls.freeze,0);assert.equal(await f.runtime.read(f.p),null);
 }finally{await close(f);}
});
test('unrelated inventory coverage does not impose a whole-wallet READY prerequisite',async()=>{
 const f=fixture();try{f.clock.readSource='partial';const held=await f.runtime.freeze(f.p,request('freeze'));assert.equal(held.status,'held');assert.equal(f.calls.freeze,1);
 }finally{await close(f);}
});
test('failure of application finality leaves the existing held row and financial attempts unchanged',async()=>{
 const f=fixture();try{const held=await f.runtime.freeze(f.p,request('freeze'));f.clock.evidenceRefused=true;
  await assert.rejects(f.runtime.settle(f.p,request('settle',held.revision,'test-registration')),/EVIDENCE_NOT_FINAL/);assert.deepEqual(await f.runtime.read(f.p),held);assert.equal(f.calls.settle,0);
 }finally{await close(f);}
});
test('entered effect uncertainty retains the hold and cannot call the funds effect twice',async()=>{
 const f=fixture();try{f.clock.throwAfterCommit=true;await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/OUTCOME_UNKNOWN_READ_FIRST/);const unknown=await f.runtime.read(f.p);assert.equal(unknown.status,'unknown');assert.equal(f.financial.holds.get(f.p.reservationId).status,'held');
  assert.equal((await f.runtime.freeze(f.p,request('freeze'))).status,'unknown');assert.equal(f.calls.freeze,1);f.clock.revoked=true;
  const reconciled=await f.runtime.reconcile(f.p);assert.equal(reconciled.status,'held');assert.equal(f.calls.reconcile,1);assert.equal(f.calls.freeze,1);
 }finally{await close(f);}
});
test('independent encrypted journal restart reconciles a lost response without another financial mutation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'wallet-principal-test-')),path=join(root,'TEST_ONLY.enc'),secret=Buffer.alloc(32,0x37);let store=await openEncryptedStore(path,secret),f=fixture(store),resumed;
 try{f.clock.throwAfterCommit=true;await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/OUTCOME_UNKNOWN_READ_FIRST/);await f.runtime.stop();await store.close();store=await openEncryptedStore(path,secret);
  resumed=createReceiptPrincipalRuntime({...f.options(),store});assert.equal((await resumed.read(f.p)).status,'unknown');assert.equal((await resumed.reconcile(f.p)).status,'held');assert.equal(f.calls.freeze,1);assert.equal(f.calls.reconcile,1);
 }finally{await resumed?.stop();await f.runtime.stop();await store.close();assert.ok(root.startsWith(join(tmpdir(),'wallet-principal-test-')));await rm(root,{recursive:true,force:true});}
});
test('shutdown fences new admission but drains the actual result even after grant expiry',async()=>{
 const f=fixture();let unblock,entered;f.clock.pause=new Promise(r=>unblock=r);const started=new Promise(r=>entered=r);f.clock.entered=entered;
 try{const pending=f.runtime.freeze(f.p,request('freeze'));await started;const stopped=f.runtime.stop();assert.throws(()=>f.runtime.freeze(f.p,request('another')),/RUNTIME_STOPPED/);f.clock.now=2000000600001;unblock();assert.equal((await pending).status,'held');await stopped;const next=createReceiptPrincipalRuntime(f.options());try{assert.equal((await next.read(f.p)).status,'held');}finally{await next.stop();}
 }finally{unblock?.();await close(f);}
});
test('concurrent same-purpose calls and changed request reuse cannot create duplicate effects',async()=>{
 const f=fixture();let unblock,entered;f.clock.pause=new Promise(r=>unblock=r);const started=new Promise(r=>entered=r);f.clock.entered=entered;
 try{const first=f.runtime.freeze(f.p,request('freeze'));await started;await assert.rejects(f.runtime.freeze(f.p,request('other')),/EFFECT_IN_FLIGHT/);unblock();await first;await assert.rejects(f.runtime.freeze(f.p,request('other','2')));assert.equal(f.calls.freeze,1);
 }finally{unblock?.();await close(f);}
});
test('input detachment and captured original methods prevent mutable request/config substitution',async()=>{
 const f=fixture();try{const raw=structuredClone(f.p),req=request('freeze'),pending=f.runtime.freeze(raw,req);raw.amountBaseUnits='1';req.eventId='changed';f.fundsEffects.freezeExisting=()=>{throw Error('REPLACED_METHOD_USED');};const held=await pending;assert.equal(held.purpose.amountBaseUnits,'500000000');assert.equal(f.calls.freeze,1);
 }finally{await close(f);}
});
test('the original funds adapter must invoke the commit guard; omission cannot confirm an effect',async()=>{
 const f=fixture();try{f.clock.skipCommitGuard=true;await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/OUTCOME_UNKNOWN_READ_FIRST/);assert.equal((await f.runtime.read(f.p)).status,'unknown');assert.equal(f.calls.freeze,1);
 }finally{await close(f);}
});

async function reinstall(f,overrides){await f.runtime.stop();f.runtime=createReceiptPrincipalRuntime({...f.options(),...overrides});}
test('an evidence provider cannot return success without entering its held callback',async()=>{
 const f=fixture();try{await reinstall(f,{evidence:{...f.evidence,withMintTerms:async()=>({status:'held'})}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/EVIDENCE_CALLBACK_NOT_JOINED/);assert.equal(f.calls.freeze,0);assert.equal(await f.runtime.read(f.p),null);
 }finally{await close(f);}
});
test('duplicate evidence callbacks invalidate the admitted scope before another effect can enter',async()=>{
 const f=fixture();try{await reinstall(f,{evidence:{...f.evidence,withMintTerms:async(p,fn)=>{const first=fn(p.mintTerms,()=>p.mintTerms);first.catch(()=>{});await fn(p.mintTerms,()=>p.mintTerms);return first;}}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/EVIDENCE_CALLBACK_REFUSED/);assert.equal(f.calls.freeze,0);assert.equal(await f.runtime.read(f.p),null);
 }finally{await close(f);}
});
test('an escaped evidence callback cannot begin work after the original scope closes',async()=>{
 const f=fixture();let escaped;try{await reinstall(f,{evidence:{...f.evidence,withMintTerms:async(p,fn)=>{escaped=fn;return null;}}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/EVIDENCE_CALLBACK_NOT_JOINED/);assert.throws(()=>escaped(f.p.mintTerms,()=>f.p.mintTerms),/EVIDENCE_CALLBACK_REFUSED/);assert.equal(f.calls.freeze,0);
 }finally{await close(f);}
});
test('source scope invalidated during asynchronous funds inventory never creates a new intent or effect',async()=>{
 const f=fixture();let valid=true;try{const original=f.fundsReader.readForPrincipal.bind(f.fundsReader);
  await reinstall(f,{fundsReader:{async readForPrincipal(c){const result=await original(c);valid=false;return result;}},evidence:{...f.evidence,withMintTerms:(p,fn)=>fn(p.mintTerms,()=>{if(!valid)throw Error('TEST_SOURCE_SCOPE_INVALIDATED');return p.mintTerms;})}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/SOURCE_SCOPE_INVALIDATED/);assert.equal(f.calls.freeze,0);assert.equal(await f.runtime.read(f.p),null);
 }finally{await close(f);}
});
test('source invalidation across the journal callback await refuses its intent commit',async()=>{
 const f=fixture();let valid=true;try{const transaction=f.store.transactionMany.bind(f.store);f.store.transactionMany=(keys,update)=>transaction(keys,values=>{const pending=update(values);valid=false;return pending;});
  await reinstall(f,{evidence:{...f.evidence,withMintTerms:(p,fn)=>fn(p.mintTerms,()=>{if(!valid)throw Error('TEST_SOURCE_SCOPE_INVALIDATED');return p.mintTerms;})}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/SOURCE_SCOPE_INVALIDATED/);assert.equal(f.calls.freeze,0);assert.equal(await f.runtime.read(f.p),null);
 }finally{await close(f);}
});
test('a provider returning before its callback settles fences and drains the admitted work',async()=>{
 const f=fixture();try{await reinstall(f,{evidence:{...f.evidence,withMintTerms(p,fn){fn(p.mintTerms,()=>p.mintTerms).catch(()=>{});return null;}}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/EVIDENCE_CALLBACK_NOT_JOINED/);assert.equal(f.calls.freeze,0);assert.equal(await f.runtime.read(f.p),null);
 }finally{await close(f);}
});
test('scope loss inside the entered funds adapter blocks its commit and remains UNKNOWN without replay',async()=>{
 const f=fixture();let valid=true,actualWrites=0;try{await reinstall(f,{fundsEffects:{...f.fundsEffects,async freezeExisting(fixed,guard){f.calls.freeze++;await Promise.resolve();valid=false;guard();actualWrites++;throw Error('MUST_NOT_WRITE');}},evidence:{...f.evidence,withMintTerms:(p,fn)=>fn(p.mintTerms,()=>{if(!valid)throw Error('TEST_SOURCE_SCOPE_INVALIDATED');return p.mintTerms;})}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/OUTCOME_UNKNOWN_READ_FIRST/);assert.equal(actualWrites,0);assert.equal((await f.runtime.read(f.p)).status,'unknown');valid=true;
  assert.equal((await f.runtime.freeze(f.p,request('freeze'))).status,'unknown');assert.equal(f.calls.freeze,1);
 }finally{await close(f);}
});
test('provider result substitution cannot replace the actual durable outcome',async()=>{
 const f=fixture();try{await reinstall(f,{evidence:{...f.evidence,async withMintTerms(p,fn){await fn(p.mintTerms,()=>p.mintTerms);return {status:'released'};}}});
  await assert.rejects(f.runtime.freeze(f.p,request('freeze')),/EVIDENCE_RESULT_SUBSTITUTED/);assert.equal((await f.runtime.read(f.p)).status,'held');assert.equal(f.calls.freeze,1);
 }finally{await close(f);}
});
