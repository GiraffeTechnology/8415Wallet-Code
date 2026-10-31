/** New synthetic original-service/UI contract checks; no configured runtime or chain claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTaskAuthorizationService} from '../server/task-authorization.mjs';
import {createTaskTestAssetAuthorization} from '../server/task-test-asset-authorization.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {digest,base32,hotp,matchTotp} from '../server/crypto.mjs';
import {taskVerificationPolicyKey} from '../server/task-verification-state.mjs';
const data=text=>`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
let original=readFileSync(new URL('../web/task-authorization.mjs',import.meta.url),'utf8');
for(const name of ['task-listing-results','task-observer-context','observation-source-contract'])original=original.replace(`./${name}.mjs`,new URL(`../web/${name}.mjs`,import.meta.url).href);
for(const name of ['taskContract','receiptTask','receiptObservation'])original=original.replace(`../dist/browser/agent/${name}.js`,new URL(`../src/agent/${name}.ts`,import.meta.url).href);
original=original.replace('../dist/browser/vendor/ethers.js',import.meta.resolve('ethers'));
const originalUrl=data(original),{TaskAuthorizationClient}=await import(originalUrl);
const source=readFileSync(new URL('../web/task-operation-verification.mjs',import.meta.url),'utf8').replace('./task-authorization.mjs',originalUrl).replace('../dist/browser/agent/taskContract.js',new URL('../src/agent/taskContract.ts',import.meta.url).href).replace('../dist/browser/vendor/ethers.js',import.meta.resolve('ethers'));
const {OperationVerificationFlow}=await import(data(source));
const account='0x'+'1'.repeat(40),recipient='0x'+'2'.repeat(40),time=1900000000000;
const baseContext={origin:'https://wallet.example.invalid',tenant:'synthetic',account,chainId:'11155111'};
const identity={schema:'8415-task-executor/1',agentId:'synthetic:agent',agentVersion:'1',adapterId:'synthetic:none',adapterVersion:'1',implementationDigest:'0x'+'9'.repeat(64)};
const secret=base32(Buffer.alloc(20,0x31));
async function fixture(mode='ON',scoped=false){
 const context={...baseContext,chainId:scoped?'560048':baseContext.chainId};
 const state={now:time,calls:[],sessions:new Set(['synthetic:session']),send:0,mutate:null,wait:null};
 const scope={...context,username:'tester',agentId:identity.agentId};
 const storedScope={origin:scope.origin,tenant:scope.tenant,username:scope.username,account:scope.account,chainId:scope.chainId,agentId:scope.agentId};
 const saved={schema:'8415-task-human-verification/2',scope:storedScope,mode:mode??'ON',revision:'1',enforcedFromRevision:'1',changes:[{revision:'1',previousRevision:'0',mode:mode??'ON',changeId:'A'.repeat(43),changeDigest:'a'.repeat(64),scopeDigest:digest(JSON.stringify(storedScope)),credentialRevision:1,verifiedFactors:['password','verified-email'],changedAt:time}]};
 const store=new MemoryCredentialStore({'synthetic:tester':{revision:1,secret,lastStep:-1,...(mode===null?{}:{taskVerificationPolicies:{[taskVerificationPolicyKey(storedScope)]:saved}})}});
 const session={id:'synthetic:session',username:'tester',account,chainId:context.chainId,revision:1,issuedAt:time,expiresAt:time+900000};
 const assertSession=(s,c)=>{if(!state.sessions.has(s.id)||(c!==undefined&&c.revision!==s.revision))throw Object.assign(Error('AUTH_REFUSED'),{code:'AUTH_REFUSED'});};
 const testAuthorization=scoped?await createTaskTestAssetAuthorization({inventory:{schema:'8415-agent-test-assets/1',chainId:context.chainId,origin:context.origin,tenant:context.tenant,expiresAt:'1900010000',wallets:[account,recipient],assets:[]},authorizedWallets:[account,recipient].map(account=>({account,chainId:context.chainId})),now:()=>state.now}):null;
 const service=createTaskAuthorizationService({testAuthorization,origin:context.origin,tenant:context.tenant,store,now:()=>state.now,operationVerificationEnabled:true,
 executorIdentity:identity,observationPolicy:{minimumConfirmations:'2'},execution:{verify(){state.send++;throw Error('NO_EXTERNAL_EFFECT');},send(){state.send++;throw Error('NO_EXTERNAL_EFFECT');},recover(){throw Error('NO_EXTERNAL_EFFECT');}},
 assertSession,async credentialFor(s){const c=await store.read('synthetic:tester');assertSession(s,c);return c;},consumeTotp(s,c,code){assertSession(s,c);const step=matchTotp(c.secret,code,state.now,c.lastStep);if(step===null)throw Object.assign(Error('AUTH_REFUSED'),{code:'AUTH_REFUSED'});return {...c,lastStep:step};}});
 const call=(path,body)=>service.handler('tasks/'+path,structuredClone(body),session);
 const policy={schema:'8415-agent-task/1',taskId:'synthetic:one',...context,actor:account,expiresAt:'1900007200',fees:{perOperationWei:'100000',totalWei:'200000'},intent:{kind:'exact-operation',operation:{kind:'native-transfer',chainId:context.chainId,actor:account,recipient,valueWei:'10'}}};delete policy.account;
 const p=await call('prepare',{policy});
 const g=await call('authorize',{challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:p.observationPolicy.digest,code:p.approvalFactor==='totp'?hotp(secret,Math.floor(state.now/30000)):''});
 const child={schema:'8415-agent-child/1',operationId:'synthetic:op',taskDigest:g.task.digest,operation:g.task.policy.intent.operation,nonce:'7',expiresAt:'1900000600',wire:{to:recipient,calldataHash:'0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',valueWei:'10'},fees:{gasLimit:'21000',maxFeePerGasWei:'2'},market:null};
 const raw=await call('reserve',{taskDigest:g.task.digest,child,expectedBudgetRevision:g.budget.revision});state.now+=30000;
 const request=async(path,body)=>{state.calls.push({path,keys:Object.keys(body)});if(state.wait)await state.wait;const value=await service.handler(path,structuredClone(body),session);return state.mutate?state.mutate(path,value):value;};
 const decoder=new TaskAuthorizationClient({request,context}),view=decoder.view(raw);
 const flow=new OperationVerificationFlow({request,context,now:()=>state.now});
 return {state,store,session,flow,view,row:view.budget.reservations[0],call,code:()=>hotp(secret,Math.floor(state.now/30000))};
}
test('original ON service: exact review and explicit confirmation read back without execute/resume',async()=>{
 const f=await fixture();await f.flow.prepare(f.view,f.row);assert.equal(f.flow.snapshot().phase,'review');
 const c=f.flow.snapshot().challenge;assert.equal(c.child.child.operation.valueWei,'10');assert.equal(c.request.binding.operationId,f.row.operationId);
 await Promise.all([f.flow.confirm(f.code()),f.flow.confirm(f.code())]);assert.equal(f.flow.snapshot().phase,'verified');
 assert.equal(f.flow.snapshot().result.statusReadBack,true);assert.equal(f.state.calls.filter(x=>x.path==='tasks/confirm-operation-verification').length,1);
 assert.equal(f.state.calls.some(x=>/execute|resume|policy/.test(x.path)),false);assert.equal(f.state.send,0);
});
for(const mode of ['OFF',null])test(`original ${mode??'pre-operational ON'} does not request a code`,async()=>{
 const f=await fixture(mode);await f.flow.prepare(f.view,f.row);assert.equal(f.flow.snapshot().phase,'not-required');await f.flow.confirm('123456');
 assert.equal(f.state.calls.some(x=>x.path==='tasks/confirm-operation-verification'),false);assert.equal(f.state.send,0);
});
test('cancel/back while prepare is pending cannot resurrect a challenge',async()=>{
 const f=await fixture();let release;f.state.wait=new Promise(r=>release=r);const pending=f.flow.prepare(f.view,f.row);f.flow.cancel();release();await pending;assert.equal(f.flow.snapshot().phase,'idle');assert.equal(f.flow.snapshot().challenge,null);
});
test('expired challenge does not submit the supplied factor',async()=>{
 const f=await fixture();await f.flow.prepare(f.view,f.row);f.state.now+=120000;await f.flow.confirm(f.code());assert.equal(f.flow.snapshot().phase,'error');assert.equal(f.state.calls.some(x=>x.path==='tasks/confirm-operation-verification'),false);
});
test('logout invalidates confirmation and clears challenge',async()=>{
 const f=await fixture();await f.flow.prepare(f.view,f.row);f.state.sessions.clear();await f.flow.confirm(f.code());assert.equal(f.flow.snapshot().phase,'error');assert.equal(f.flow.snapshot().challenge,null);assert.equal(f.state.calls.some(x=>x.path==='tasks/confirm-operation-verification'),false);
});
for(const mutation of ['task','child','request','binding'])test(`changed ${mutation} response is rejected before human review`,async()=>{
 const f=await fixture();f.state.mutate=(path,value)=>{if(path==='tasks/prepare-operation-verification'){value=structuredClone(value);if(mutation==='task')value.task.digest='0x'+'f'.repeat(64);if(mutation==='child')value.child.child.operation.valueWei='11';if(mutation==='request')value.requestDigest='f'.repeat(64);if(mutation==='binding')value.request.binding.nonceClaimDigest='f'.repeat(64);}return value;};
 await f.flow.prepare(f.view,f.row);assert.equal(f.flow.snapshot().phase,'error');assert.equal(f.flow.snapshot().challenge,null);assert.equal(f.state.send,0);
});
test('revocation between review and confirm refuses factor submission',async()=>{
 const f=await fixture();await f.flow.prepare(f.view,f.row);await f.call('revoke',{taskDigest:f.view.task.digest,expectedGrantPolicyVersion:f.view.authorization.grantPolicyVersion});await f.flow.confirm(f.code());assert.equal(f.flow.snapshot().phase,'error');assert.equal(f.state.calls.some(x=>x.path==='tasks/confirm-operation-verification'),false);
});

test('original scoped-test reason takes precedence over revision-zero without becoming a production fallback',async()=>{const f=await fixture(null,true);await f.flow.prepare(f.view,f.row);assert.equal(f.flow.snapshot().phase,'not-required');assert.equal(f.flow.snapshot().result.reason,'server-test-scope');await f.flow.confirm('123456');assert.equal(f.state.calls.some(x=>x.path==='tasks/confirm-operation-verification'),false);assert.equal(f.state.send,0);});
