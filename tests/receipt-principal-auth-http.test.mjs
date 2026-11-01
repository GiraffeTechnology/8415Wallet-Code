/** Normal HTTP-handler principal authorization software tests; no live funds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,policy,template,a,h,origin,epoch} from './helpers/principal-auth-http-fixture.mjs';
import {receiptPrincipalPurposeDigest} from '../src/agent/receiptPrincipal.ts';
import {taskVerificationPolicyKey} from '../server/task-verification-state.mjs';
import {digest} from '../server/crypto.mjs';

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
