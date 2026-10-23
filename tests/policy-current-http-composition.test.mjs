/** Isolated real HTTP composition of exact backend and browser API modules.
 * All accounts, factors and email delivery are synthetic test fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {webcrypto} from 'node:crypto';
import {Wallet} from 'ethers';
import {createAuthService} from '../server/auth-service.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {hashPassword} from '../server/crypto.mjs';
import {AccountAuthClient} from '../web/account-auth.mjs';
import {createTaskVerificationPolicyWire,taskPolicyChangeQuery,TASK_POLICY_CHANGE_PROTOCOL as protocol} from '../web/task-verification-policy-wire.mjs';
import {createTaskVerificationPolicyClient} from '../web/task-verification-policy-client.mjs';
import {createTaskPolicyPendingStore,taskPolicyPendingReference} from '../web/task-verification-policy-pending.mjs';
const signer=new Wallet('0x'+'1'.repeat(64)),password='synthetic-only-policy-password',passwordHash=await hashPassword(password);
const port=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
async function fixture(t){
 let handler;const mailbox=[],requests=[];const registration={version:1,email:'owner@example.invalid',verifiedAt:1};
 const store=new MemoryCredentialStore({'fixture:owner':{registration},'@registration:fixture':{version:1,records:[{username:'owner',email:registration.email,verifiedAt:registration.verifiedAt}]}});
 const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const origin='http://127.0.0.1:'+server.address().port,tenant='fixture';
 const options={origin,tenant,store,taskVerificationPolicyEnabled:true,accounts:[{username:'owner',passwordHash,wallets:['560048','8453'].map(chainId=>({account:signer.address,chainId}))}],sendOtp:async m=>mailbox.push(m)};
 handler=createAuthService(options);
 async function login(chainId='560048',saved=port()){
  const jar=new Map(),calls=[];let loseConfirm=false;
  const client=new AccountAuthClient({origin,tenant,fetcher:async(url,input)=>{
   // Capability discovery is not under test and no capabilities endpoint is
   // probed. This bounded fixture declares its configured login methods.
   if(url.pathname==='/auth/capabilities')return new Response(JSON.stringify({schema:'8415wallet-auth/1',origin,tenant,methods:['password','wallet']}));
   const body=input.body?JSON.parse(input.body):null;
   calls.push({path:url.pathname,fields:body?Object.keys(body):[],changeId:body?.changeId,expectedRevision:body?.expectedRevision});requests.push(calls.at(-1));
   const response=await fetch(url,{...input,headers:{...input.headers,Origin:origin,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});
   for(const c of response.headers.getSetCookie()){const [k,v]=c.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}
   if(loseConfirm&&url.pathname.endsWith('/confirm')){loseConfirm=false;await response.text();throw Error('Synthetic response lost after service handled confirm');}
   return response;
  }});
  const authenticated=await client.adapter('password',{username:'owner',password}).authenticate({account:signer.address,chainId},null);
  // Match login-core's verified server session -> walletLogin context mapping.
  const session={...authenticated,serverId:authenticated.id};
  const account=await client.account(),wire=createTaskVerificationPolicyWire({crypto:webcrypto}),binding={},signal=new AbortController().signal;
  const bridge=createTaskVerificationPolicyClient({client,walletLogin:{assert:b=>{assert.equal(b,binding);return session;}},document:{},window:{crypto:webcrypto,sessionStorage:saved}});
  const read=()=>bridge.read({binding,signal});
  const discover=async()=>wire.status(await client.taskVerification('status',{protocol}),session,await client.account());
  const prepare=async(mode='OFF',revision='0')=>{
   const reviewed=(await discover()).view,raw=await client.taskVerification('prepare',{protocol,mode,expectedRevision:revision,identityMethod:'password'});
   const prepared=await wire.prepared(raw,{session,account,reviewed,mode,identityMethod:'password',now:Date.now()});
   const reference=taskPolicyPendingReference({scopeKey:reviewed.scopeKey,changeId:prepared.changeId,changeDigest:prepared.changeDigest,mode,previousRevision:revision});
   return {raw,prepared,reference};
  };
  const verify=async change=>{const raw=await client.taskVerification('verify',{changeId:change.reference.changeId,changeDigest:change.reference.changeDigest,password});wire.verified(raw,change.prepared,Date.now());};
  const confirm=change=>client.taskVerification('confirm',{changeId:change.reference.changeId,changeDigest:change.reference.changeDigest,code:mailbox.at(-1).code});
  return {client,session,account,wire,bridge,binding,signal,saved,calls,read,discover,prepare,verify,confirm,loseConfirm:()=>loseConfirm=true};
 }
 return {login,store,requests,restart:()=>{handler=createAuthService(options);}};
}

test('real legacy status and explicit discovery both decode without inventing permission inventory',async t=>{
 const f=await fixture(t),a=await f.login();
 const legacy=await a.wire.status(await a.client.taskVerification('status',{}),a.session,a.account);
 assert.equal(legacy.view.mode,'ON');assert.equal(legacy.view.canChange,false);
 const modern=await a.discover();assert.equal(modern.view.canChange,true);assert.equal(modern.view.permissions,null);
 const view=await a.read();assert.equal(view.mode,'ON');assert.equal(view.changeState,'settled');
});
test('real prepare and both factors commit through the actual strict frontend transport and decoders',async t=>{
 const f=await fixture(t),a=await f.login(),change=await a.prepare();
 createTaskPolicyPendingStore({storage:a.saved}).remember(change.reference);await a.verify(change);
 await a.wire.committed(await a.confirm(change),change.prepared);
 const view=await a.read();assert.equal(view.mode,'OFF');assert.equal(view.revision,'1');assert.equal(view.changeState,'settled');
 assert.equal(createTaskPolicyPendingStore({storage:a.saved}).read(change.reference.scopeKey),null);
});
test('lost confirm response is reconciled by actual durable audit without a second confirm',async t=>{
 const f=await fixture(t),a=await f.login(),change=await a.prepare();
 createTaskPolicyPendingStore({storage:a.saved}).remember(change.reference);await a.verify(change);a.loseConfirm();await assert.rejects(a.confirm(change));
 const before=a.calls.filter(c=>c.path.endsWith('/confirm')).length;const view=await a.read();
 assert.equal(view.mode,'OFF');assert.equal(view.changeState,'settled');assert.equal(a.calls.filter(c=>c.path.endsWith('/confirm')).length,before);
});
test('late old cancel leaves newer draft pending; explicit frontend cancellation targets only the new draft',async t=>{
 const f=await fixture(t),a=await f.login(),old=await a.prepare(),next=await a.prepare('ON');
 createTaskPolicyPendingStore({storage:a.saved}).remember(old.reference);
 const raw=await a.client.taskVerification('cancel',taskPolicyChangeQuery(old.reference));assert.equal(raw.cancelled,false);
 assert.equal(raw.reconciliation.reason,'replaced');
 const view=await a.read();assert.equal(view.changeState,'unknown');
 assert.equal(createTaskPolicyPendingStore({storage:a.saved}).read(view.scopeKey).changeId,next.reference.changeId);
 const cleared=await a.bridge.cancelPending({binding:a.binding,signal:a.signal,expectedScopeKey:view.scopeKey});assert.equal(cleared.changeState,'settled');
 assert.equal(a.calls.filter(c=>c.path.endsWith('/cancel')).at(-1).changeId,next.reference.changeId);
});
test('durable competing-session save consumes revision before stale pending is presented',async t=>{
 const f=await fixture(t),a=await f.login(),b=await f.login(),old=await a.prepare(),winner=await b.prepare('ON');
 createTaskPolicyPendingStore({storage:a.saved}).remember(old.reference);await b.verify(winner);await b.confirm(winner);
 const raw=await a.client.taskVerification('status',taskPolicyChangeQuery(old.reference));assert.equal(raw.pendingChange,null);assert.equal(raw.reconciliation.reason,'revision-superseded');
 const view=await a.read();assert.equal(view.revision,'1');assert.equal(view.changeState,'settled');
});
test('new authenticated session can retain an existing same-scope unresolved reference without unsafe action',async t=>{
 const f=await fixture(t),a=await f.login(),change=await a.prepare();
 createTaskPolicyPendingStore({storage:a.saved}).remember(change.reference);const b=await f.login('560048',a.saved);
 const actual=await b.client.taskVerification('status',taskPolicyChangeQuery(change.reference));
 console.log('CROSS_SESSION_ACTUAL_POLICY_STATUS '+JSON.stringify({pendingChange:actual.pendingChange,reconciliation:actual.reconciliation,revision:actual.revision}));
 assert.equal(actual.pendingChange,null);assert.equal(actual.reconciliation.state,'pending');
 const before=f.requests.filter(c=>/\/(prepare|verify|confirm|cancel)$/.test(c.path)).length;
 const view=await b.read();assert.equal(view.changeState,'unknown');
 assert.equal(f.requests.filter(c=>/\/(prepare|verify|confirm|cancel)$/.test(c.path)).length,before);
});
test('actual service restart retains unresolved reference as UNKNOWN, never retries the save',async t=>{
 const f=await fixture(t),a=await f.login(),change=await a.prepare();
 createTaskPolicyPendingStore({storage:a.saved}).remember(change.reference);f.restart();const b=await f.login('560048',a.saved);
 const before=f.requests.filter(c=>/\/(prepare|verify|confirm|cancel)$/.test(c.path)).length;
 const view=await b.read();assert.equal(view.changeState,'unknown');assert.equal(view.mode,'ON');
 assert.equal(f.requests.filter(c=>/\/(prepare|verify|confirm|cancel)$/.test(c.path)).length,before);
});
test('another session draft cannot be cancelled via a retained older reference',async t=>{
 const f=await fixture(t),a=await f.login(),old=await a.prepare();
 createTaskPolicyPendingStore({storage:a.saved}).remember(old.reference);const b=await f.login('560048',a.saved),current=await b.prepare('ON');
 const view=await b.read();assert.equal(view.changeState,'unknown');
 const before=f.requests.filter(c=>c.path.endsWith('/cancel')).length;
 await b.bridge.cancelPending({binding:b.binding,signal:b.signal,expectedScopeKey:view.scopeKey});
 assert.equal(f.requests.filter(c=>c.path.endsWith('/cancel')).length,before);
 const status=await b.client.taskVerification('status',{protocol});assert.equal(status.pendingChange.changeId,current.reference.changeId);
 assert.equal(createTaskPolicyPendingStore({storage:a.saved}).read(old.reference.scopeKey).changeId,old.reference.changeId);
});
test('same-address Base context does not load or clear the Hoodi pending reference',async t=>{
 const f=await fixture(t),a=await f.login(),change=await a.prepare();createTaskPolicyPendingStore({storage:a.saved}).remember(change.reference);
 const b=await f.login('8453',a.saved),view=await b.read();assert.equal(view.context.chainId,'8453');assert.equal(view.mode,'ON');assert.equal(view.changeState,'settled');
 assert.equal(createTaskPolicyPendingStore({storage:a.saved}).read(change.reference.scopeKey).changeId,change.reference.changeId);
});
