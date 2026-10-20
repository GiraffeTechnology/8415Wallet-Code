/** Synthetic credentials and loopback HTTP only; no production factors or chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { webcrypto } from 'node:crypto';
import { Wallet } from 'ethers';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
import { AccountAuthClient } from '../web/account-auth.mjs';
import { createTaskVerificationPolicyWire, taskPolicyChangeQuery, TASK_POLICY_CHANGE_PROTOCOL as protocol } from '../web/task-verification-policy-wire.mjs';
import { createTaskVerificationPolicyClient } from '../web/task-verification-policy-client.mjs';
import { createTaskPolicyPendingStore, taskPolicyPendingReference } from '../web/task-verification-policy-pending.mjs';
const wallet = new Wallet('0x' + '1'.repeat(64)); // Public fixture key, never a real wallet.
function memoryStorage() { const map=new Map();return { getItem(k){return map.get(k)??null;},setItem(k,v){map.set(k,v);},removeItem(k){map.delete(k);} }; }
async function setup(t) {
  const password='synthetic-policy-password', passwordHash=await hashPassword(password), deliveries=[];
  const registration={version:1,email:'owner@example.invalid',verifiedAt:1};
  const store=new MemoryCredentialStore({'fixture:alice':{registration},'@registration:fixture':{version:1,records:[{username:'alice',email:registration.email,verifiedAt:1}]}});
  let handler;const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  handler=createAuthService({origin,tenant:'fixture',store,taskVerificationPolicyEnabled:true,
    accounts:[{username:'alice',passwordHash,wallets:[{account:wallet.address,chainId:'560048'}]}],sendOtp:async message=>deliveries.push(message)});
  const wire=createTaskVerificationPolicyWire({crypto:webcrypto}),port=memoryStorage();
  async function login() {
    const jar=new Map(),calls=[];
    const fetcher=async(url,options)=>{
      calls.push({path:new URL(url).pathname,body:options.body?JSON.parse(options.body):null});
      const response=await fetch(url,{...options,headers:{...options.headers,Origin:origin,Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')}});
      for(const cookie of response.headers.getSetCookie()){const [name,value]=cookie.split(';')[0].split('=');if(value)jar.set(name,value);}
      return response;
    };
    const client=new AccountAuthClient({origin,tenant:'fixture',fetcher});
    const actual=await client.adapter('password',{username:'alice',password}).authenticate({account:wallet.address,chainId:'560048'},null);
    const session={...actual,serverId:'synthetic-loopback-session'},binding={},signal=new AbortController().signal;
    const walletLogin={assert(b){assert.equal(b,binding);return session;}};
    const bridge=()=>createTaskVerificationPolicyClient({client,walletLogin,document:{},window:{crypto:webcrypto,sessionStorage:port}});
    return {client,session,binding,signal,bridge,calls};
  }
  const first=await login();
  async function prepare(c,mode='OFF',expectedRevision='0') {
    const account=await c.client.account(),reviewed=await c.bridge().read(c);
    const raw=await c.client.taskVerification('prepare',{protocol,mode,expectedRevision,identityMethod:'wallet'});
    const prepared=await wire.prepared(raw,{session:c.session,account,reviewed,mode,identityMethod:'wallet',now:Date.now()});
    const ref=taskPolicyPendingReference({scopeKey:reviewed.scopeKey,changeId:prepared.changeId,changeDigest:prepared.changeDigest,mode,previousRevision:expectedRevision});
    return {raw,prepared,ref};
  }
  async function commit(c,p) {
    const verification=await c.client.taskVerification('verify',{changeId:p.prepared.changeId,changeDigest:p.prepared.changeDigest,signature:await wallet.signMessage(p.prepared.message)});
    wire.verified(verification,p.prepared,Date.now());
    const saved=await c.client.taskVerification('confirm',{changeId:p.prepared.changeId,changeDigest:p.prepared.changeDigest,code:deliveries.at(-1).code});
    await wire.committed(saved,p.prepared);return saved;
  }
  return {first,login,wire,port,prepare,commit};
}
test('actual HTTP owner-policy transport, strict decoders and reload resolve an old commit after a later save',async t=>{
  const f=await setup(t),a=f.first,p=await f.prepare(a);
  createTaskPolicyPendingStore({storage:f.port}).remember(p.ref);
  const saved=await f.commit(a,p);assert.equal(saved.mode,'OFF');assert.equal(Object.hasOwn(saved,'changeProtocol'),false);
  // Simulate losing the confirm response; discard it rather than replay confirm.
  const reloaded=a.bridge();assert.equal((await reloaded.read(a)).changeState,'settled');
  assert.equal(createTaskPolicyPendingStore({storage:f.port}).read(p.ref.scopeKey),null);
  const next=await f.prepare(a,'ON','1');await f.commit(a,next);
  createTaskPolicyPendingStore({storage:f.port}).remember(p.ref);
  const value=await a.bridge().read(a);assert.equal(value.mode,'ON');assert.equal(value.revision,'2');assert.equal(value.changeState,'settled');
  assert.equal(createTaskPolicyPendingStore({storage:f.port}).read(p.ref.scopeKey),null);
  assert.equal(a.calls.filter(c=>c.path.endsWith('/confirm')).length,2);
});
test('actual HTTP replacement readback adopts the current draft and explicit cancel targets only that draft',async t=>{
  const f=await setup(t),a=f.first,old=await f.prepare(a),next=await f.prepare(a,'ON');
  const refs=createTaskPolicyPendingStore({storage:f.port});refs.remember(old.ref);
  const api=a.bridge(),value=await api.read(a);assert.equal(value.mode,'ON');assert.equal(value.revision,'0');assert.equal(value.changeState,'unknown');
  assert.deepEqual(refs.read(next.ref.scopeKey),next.ref);
  assert.equal(a.calls.filter(c=>c.path.endsWith('/cancel')).length,0);
  assert.equal((await api.cancelPending({...a,expectedScopeKey:next.ref.scopeKey})).changeState,'settled');
  const cancel=a.calls.filter(c=>c.path.endsWith('/cancel'));assert.equal(cancel.length,1);assert.deepEqual(cancel[0].body,taskPolicyChangeQuery(next.ref));
  assert.equal(a.calls.some(c=>c.path.endsWith('/confirm')||c.path.endsWith('/verify')),false);
});
test('actual HTTP new-session readback accepts pending with no current-session summary and never cancels it',async t=>{
  const f=await setup(t),a=f.first,p=await f.prepare(a);createTaskPolicyPendingStore({storage:f.port}).remember(p.ref);
  const b=await f.login(),raw=await b.client.taskVerification('status',taskPolicyChangeQuery(p.ref));
  assert.equal(raw.pendingChange,null);assert.equal(raw.reconciliation.state,'pending');
  const api=b.bridge();assert.equal((await api.read(b)).changeState,'unknown');
  await api.cancelPending({...b,expectedScopeKey:p.ref.scopeKey});assert.equal(b.calls.some(c=>c.path.endsWith('/cancel')),false);
  assert.deepEqual(createTaskPolicyPendingStore({storage:f.port}).read(p.ref.scopeKey),p.ref);
});
