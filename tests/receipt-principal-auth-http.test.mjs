/** Normal HTTP-handler/password/task-approval software evidence. Test identities
 * only; no financial adapter, actual account, listener, signer or transaction. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createAuthService} from '../server/auth-service.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {hashPassword} from '../server/crypto.mjs';
import {receiptPrincipalPurposeDigest} from '../src/agent/receiptPrincipal.ts';
const a=n=>'0x'+n.repeat(40),h=n=>'0x'+n.repeat(64),origin='https://wallet.example.invalid',epoch=1800000000000;
function policy(){return {schema:'8415-agent-task/1',taskId:'test-principal-task',tenant:'xiongan',origin,chainId:'560048',actor:a('1'),expiresAt:'1800003600',fees:{perOperationWei:'100000',totalWei:'100000'},intent:{kind:'artfi-receipt',handlerId:'artfi:whole-receipt:v1',escrow:a('5'),runtimeCodeHash:h('8'),segmentId:h('9'),sale:{seller:a('2'),collection:a('3'),tokenId:'7',paymentToken:a('4'),price:'100',buyer:a('1'),salt:'9',startsAt:'1',endsAt:'1800003600',epoch:'0'},correspondence:{settlementId:h('1'),assetRecordHash:h('2'),oracleSourceId:h('3'),requestHash:h('4'),executionReferenceHash:h('5'),previousSegment:h('0'),oldCertificateHash:h('6'),warehouseReceiptHash:h('7')},phases:[{phase:'funded',nonce:'0',calldataHash:h('a'),planDigest:h('1'),journalBindingHash:h('4'),gasLimit:'21000',maxFeePerGasWei:'2',maxPriorityFeePerGasWei:'1'}],recovery:{funding:'once',payout:'once',unknownOutcome:'reconcile-only'}}};}
function template(){return {schema:'8415-receipt-principal-purpose/1',reservationId:'test-original-principal',tenant:'xiongan',origin,account:a('1'),chainId:'560048',currency:{kind:'erc20',contract:a('4'),decimals:6},amountBaseUnits:'100',payee:a('2'),task:{operationId:'test-principal-operation'},receipt:{collection:a('3'),tokenId:'7',segmentId:h('9'),planDigest:h('1'),journalBindingHash:h('4')},lineage:{id:'test-lineage',index:'0',previousReservationId:null},mintTerms:{policyVersion:'test-original-policy',assetId:'test-asset',tokenId:'7',source:{chainId:'560048',contract:a('6'),registerId:'test-register',sourceAuthority:'TEST_ONLY_MINT_SOURCE'},mintRecordCommitment:h('b'),mintPolicyHash:h('c'),registrationDeadline:'1800001800'}};}
async function fixture(t){
 const store=new MemoryCredentialStore(),clock={now:epoch},cookies=new Map();let csrf='';
 const options={origin,tenant:'xiongan',store,accounts:[{username:'tester',passwordHash:await hashPassword('TEST_ONLY_owner_password'),wallets:[{account:a('1'),chainId:'560048'}]}],now:()=>clock.now,taskReceiptHandlerId:'artfi:whole-receipt:v1',taskExecutorIdentity:{schema:'8415-task-executor/1',agentId:'test-principal',agentVersion:'1',adapterId:'artfi:whole-receipt:v1',adapterVersion:'1',implementationDigest:h('d')}};
 let handler=createAuthService(options);t.after(()=>store.close());
 async function call(path,body,override={}){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:body===undefined?'GET':'POST',url:'/auth/'+path,socket:{remoteAddress:'127.0.0.1'},headers:{host:'wallet.example.invalid',origin,'x-wallet-tenant':'xiongan','content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-wallet-csrf':csrf,...override}});
  let status,data;await handler(req,{set statusCode(v){status=v;},setHeader(name,value){if(name.toLowerCase()==='set-cookie')for(const line of Array.isArray(value)?value:[value]){const pair=line.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}},end(value){data=JSON.parse(value);}});if(data.csrf)csrf=data.csrf;return {status,data};
 }
 assert.equal((await call('bootstrap')).status,200);assert.equal((await call('password',{username:'tester',password:'TEST_ONLY_owner_password',account:a('1'),chainId:'560048'})).status,200);
 const prepare=async(principal=template())=>{const r=await call('tasks/prepare',{policy:policy(),...(principal===null?{}:{receiptPrincipal:principal})});assert.equal(r.status,200,r.data.error);return r.data;};
 const approval=c=>({challengeId:c.challengeId,taskDigest:c.task.digest,executorDigest:c.executor.digest,observationPolicyDigest:null,code:'',...(c.receiptPrincipalPurposeDigest===undefined?{}:{receiptPrincipalPurposeDigest:c.receiptPrincipalPurposeDigest})});
 return {store,clock,call,prepare,approval,port:()=>handler.receiptPrincipalAuthorization,restart(){handler=createAuthService(options);}};
}
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
