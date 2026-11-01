/** Actual normal task-approval port composed with TEST_ONLY funds/evidence.
 * This is not production ledger, source finality or financial acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,template,origin} from './helpers/principal-auth-http-fixture.mjs';
import {composeReceiptPrincipalRuntime} from '../server/receipt-principal-composition.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {receiptPrincipalPurposeDigest} from '../src/agent/receiptPrincipal.ts';
import {AsyncLocalStorage} from 'node:async_hooks';
async function composition(t,{approve=true,bindingFactory=null}={}){
 const f=await fixture(t),c=await f.prepare(approve?template():null),authorized=await f.call('tasks/authorize',f.approval(c));assert.equal(authorized.status,200);
 const p=c.receiptPrincipalPurpose??{...template(),task:{taskId:c.task.policy.taskId,taskDigest:c.task.digest,executorDigest:c.executor.digest,grantReference:authorized.data.authorization.reference,grantPolicyVersion:'1',operationId:'test-principal-operation'}};
 let runtime;const journal=new MemoryCredentialStore(),state={calls:0,reads:0,held:false,pause:null,entered:null};t.after(async()=>{await runtime?.stop();await journal.close();});
 const currency={chainId:p.chainId,...p.currency};
 const reader={async readForPrincipal(context){state.reads++;return {schema:'8415-authoritative-funds/1',scope:{...context.principal},readId:context.readId,observedAt:f.clock.now,validUntil:f.clock.now+60000,inventoryState:'complete',currencies:[{currency,state:'ready',balanceBasis:'total-includes-escrow',balanceBaseUnits:'1000',blockHash:'0x'+'a'.repeat(64),escrowState:'complete',escrows:[]}]};}};
 const effects={async freezeExisting(fixed,guard){state.calls++;assert.equal(fixed.purposeDigest,receiptPrincipalPurposeDigest(p));assert.equal(fixed.purpose.task.grantReference,p.task.grantReference);guard();assert.equal(state.held,false);state.held=true;if(state.pause){state.entered();await state.pause;}return {schema:'8415-receipt-principal-effect/1',action:'freeze',effectId:p.reservationId+':freeze',purposeDigest:receiptPrincipalPurposeDigest(p),outcome:'confirmed',reference:'TEST_ONLY_EXISTING_HOLD',amountBaseUnits:p.amountBaseUnits,recipient:p.account};},settleHeld(){assert.fail('unexpected synthetic settlement');},releaseHeld(){assert.fail('unexpected synthetic release');},reconcile(){assert.fail('unexpected synthetic reconcile');}};
 const evidence={withMintTerms(purpose,fn){assert.equal(receiptPrincipalPurposeDigest(purpose),receiptPrincipalPurposeDigest(p));return fn(p.mintTerms,()=>p.mintTerms);},withRegistrationAuthorization(){assert.fail('unexpected evidence read');},withRollbackAuthorization(){assert.fail('unexpected evidence read');}};
 const binding={store:journal,fundsEffects:effects,...(bindingFactory===null?{evidence}:{evidenceComposition:options=>bindingFactory(options,evidence,state)})};runtime=composeReceiptPrincipalRuntime({binding,authorization:f.port(),fundsReader:reader,tenant:'xiongan',now:()=>f.clock.now});
 return {f,p,state,runtime,binding,effects,journal};
}
const request=()=>({eventId:'test-original-freeze',expectedRevision:'0',evidenceReference:null});
test('unconfigured standard composition remains disabled and demands no funds capabilities',()=>{
 assert.equal(composeReceiptPrincipalRuntime({}),null);
});
test('normal HTTP-approved original principal reaches the captured existing-funds adapter once',async t=>{
 const c=await composition(t),r=request(),pending=c.runtime.freeze(c.p,r);r.eventId='mutated';c.effects.freezeExisting=()=>assert.fail('mutated capability used');
 const held=await pending;assert.equal(held.status,'held');assert.equal(held.purpose.task.grantReference,c.p.task.grantReference);assert.equal(c.state.calls,1);assert.equal(c.state.reads,1);
 assert.deepEqual(await c.runtime.freeze(c.p,request()),held);assert.equal(c.state.calls,1);
});
test('an ordinary receipt grant cannot enter effects or inventory through the new composition',async t=>{
 const c=await composition(t,{approve:false});await assert.rejects(c.runtime.freeze(c.p,request()));assert.equal(c.state.calls,0);assert.equal(c.state.reads,0);
});
test('normal grant revocation refuses new effects and preserves original held observation',async t=>{
 const c=await composition(t),held=await c.runtime.freeze(c.p,request());assert.equal((await c.f.call('tasks/revoke',{taskDigest:c.p.task.taskDigest,expectedGrantPolicyVersion:'1'})).status,200);
 await assert.rejects(c.runtime.settle(c.p,{eventId:'test-settle',expectedRevision:held.revision,evidenceReference:'untrusted-registration'}));assert.deepEqual(await c.runtime.read(c.p),held);assert.equal(c.state.calls,1);
});
test('changing the claimed original realm cannot create a funds effect',async t=>{
 const c=await composition(t);await assert.rejects(c.runtime.freeze({...c.p,origin:origin+':9446'},request()));assert.equal(c.state.calls,0);assert.equal(c.state.reads,0);
});
test('accessor request members are refused without invoking them or any inventory/effect port',async t=>{
 const c=await composition(t);let getters=0;const r=request();Object.defineProperty(r,'eventId',{enumerable:true,get(){getters++;return 'unsafe';}});
 assert.throws(()=>c.runtime.freeze(c.p,r),/COMPOSITION_REFUSED/);assert.equal(getters,0);assert.equal(c.state.calls,0);assert.equal(c.state.reads,0);
});
test('stop fences queued admission and drains the originally admitted normal grant effect',async t=>{
 const c=await composition(t);let unblock,entered;c.state.pause=new Promise(r=>unblock=r);const started=new Promise(r=>entered=r);c.state.entered=entered;
 const pending=c.runtime.freeze(c.p,request());await started;const stopped=c.runtime.stop();assert.throws(()=>c.runtime.read(c.p),/COMPOSITION_STOPPED/);unblock();assert.equal((await pending).status,'held');await stopped;assert.equal(c.state.calls,1);
 // Composition never closes a caller-owned journal or the auth store.
 assert.equal(typeof await c.journal.read('absent'),'object');
});
test('paired application composition receives the original Wallet contract and keeps the normal grant context through the effect',async t=>{
 const context=new AsyncLocalStorage();let factories=0,guards=0;
 const c=await composition(t,{bindingFactory({wallet,authorization,now},evidence){factories++;assert.equal(wallet.receiptPrincipalPurposeDigest,receiptPrincipalPurposeDigest);assert.equal(typeof wallet.normalizeReceiptRegistrationFacts,'function');assert.equal(typeof wallet.normalizeReceiptRollbackFacts,'function');assert.equal(typeof now,'function');
  return {authorization:{...authorization,withPurposeAuthorization(p,action,operation){return authorization.withPurposeAuthorization(p,action,(scope,revalidate)=>context.run({p,action},()=>operation(scope,revalidate)));}},evidence:{...evidence,withMintTerms(p,operation){assert.equal(context.getStore()?.action,'freeze');assert.equal(receiptPrincipalPurposeDigest(context.getStore().p),wallet.receiptPrincipalPurposeDigest(p));return evidence.withMintTerms(p,(terms,revalidate)=>operation(terms,()=>{guards++;assert.equal(context.getStore()?.action,'freeze');return revalidate();}));}}};
 }});
 c.binding.evidenceComposition=()=>assert.fail('factory recaptured');const held=await c.runtime.freeze(c.p,request());assert.equal(held.status,'held');assert.ok(guards>0);assert.equal(factories,1);assert.equal(c.state.calls,1);assert.deepEqual(await c.runtime.read(c.p),held);assert.equal(context.getStore(),undefined);
});
test('a paired factory cannot silently omit its authorization port or supply an asynchronous result',async t=>{
 for(const factory of [(_options,evidence)=>({evidence}),async(_options,evidence)=>({evidence})]){
  await assert.rejects(composition(t,{bindingFactory:factory}),/COMPOSITION_REFUSED/);
 }
});
