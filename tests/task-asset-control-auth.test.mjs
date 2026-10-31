import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Wallet} from 'ethers';
import {createAuthService} from '../server/auth-service.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {hashPassword} from '../server/crypto.mjs';
import {freezeTaskPolicy,freezeChildOperation} from '../src/agent/taskContract.ts';
import {freezeTaskExecutorIdentity} from '../server/task-authorization.mjs';
import {freezeTaskObservationPolicy} from '../src/agent/receiptObservation.ts';
import {hashControlBytes} from '../src/controls/authorization.ts';
// Whole HTTP/auth/store path on a synthetic loopback Linux test server only.
// No production service, real account, capabilities probe, RPC, or transaction.
const wallet=new Wallet('0x'+'6'.repeat(64)),password='synthetic-owner-passphrase';
const passwordHash=await hashPassword(password),time=1800000000000;
const executor={schema:'8415-task-executor/1',agentId:'synthetic:agent',agentVersion:'1',
 adapterId:'synthetic:adapter',adapterVersion:'1',implementationDigest:'0x'+'a'.repeat(64)};
const observation=freezeTaskObservationPolicy({minimumConfirmations:'2'});
async function fixture(options={}) {
 const tenant='synthetic',mailbox=[],registration={version:1,email:'owner@example.invalid',verifiedAt:1};
 const store=new MemoryCredentialStore({'synthetic:owner':{revision:0,registration},
 '@registration:synthetic':{version:1,records:[{username:'owner',email:registration.email,verifiedAt:1}]}});
 let handler;const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 const enabled=options.configured!==false;
 handler=createAuthService({origin,tenant,store,now:()=>time,accounts:[{username:'owner',passwordHash,
 wallets:[{account:wallet.address,chainId:'560048'}]}],sendOtp:async m=>mailbox.push(m),
 ...(enabled?{taskExecution:{async verify(){throw Error('UNEXPECTED_EXECUTION');},
 async send(){throw Error('UNEXPECTED_SIGN_OR_SEND');},async recover(){throw Error('UNEXPECTED_RECOVERY');}},
 taskExecutorIdentity:executor,taskObservationPolicy:observation.policy,
 taskTestAuthorization:{allows:task=>task.policy.chainId==='560048'&&task.policy.actor===wallet.address.toLowerCase()}}:{}),
 ...options});
 const jar=new Map();let csrf='';
 async function call(path,body,headers={}) {
  const response=await fetch(origin+'/auth/'+path,{method:body===undefined?'GET':'POST',
   headers:{'X-Wallet-Tenant':tenant,'X-Wallet-CSRF':csrf,Origin:origin,
    Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  for(const cookie of response.headers.getSetCookie()){const [name,value]=cookie.split(';')[0].split('=');if(value)jar.set(name,value);else jar.delete(name);}
  const data=await response.json();if(response.ok&&data.csrf)csrf=data.csrf;
  return {status:response.status,data};
 }
 async function login(){assert.equal((await call('bootstrap')).status,200);
  assert.equal((await call('password',{username:'owner',password,account:wallet.address,chainId:'560048'})).status,200);}
 async function save(target,value,revision='0',fieldRevision='0') {
  const p=await call('account/asset-controls/prepare',{expectedRevision:revision,identityMethod:'wallet',
   patch:{target,value,expectedFieldRevision:fieldRevision}});assert.equal(p.status,200,JSON.stringify(p.data));
  const verified=await call('account/asset-controls/verify',{changeId:p.data.request.changeId,changeDigest:p.data.changeDigest,
   signature:await wallet.signMessage(p.data.message)});assert.equal(verified.status,200,JSON.stringify(verified.data));
  const c=await call('account/asset-controls/confirm',{changeId:p.data.request.changeId,changeDigest:p.data.changeDigest,code:mailbox.at(-1).code});
  assert.equal(c.status,200,JSON.stringify(c.data));return c.data;
 }
 async function reserveNative() {
  const policy={schema:'8415-agent-task/1',taskId:'task:route',tenant,origin,chainId:'560048',actor:wallet.address.toLowerCase(),
   expiresAt:String(time/1000+7200),fees:{perOperationWei:'1000000',totalWei:'1000000'},intent:{kind:'exact-operation',
    operation:{kind:'native-transfer',chainId:'560048',actor:wallet.address.toLowerCase(),recipient:'0x'+'2'.repeat(40),valueWei:'1'}}};
  const task=freezeTaskPolicy(policy),id=freezeTaskExecutorIdentity(executor);
  const p=await call('tasks/prepare',{policy});assert.equal(p.status,200,JSON.stringify(p.data));
  // Existing wire key is retained; null represents no factor for this scoped
  // synthetic exemption, never a human proof or a fresh authorization request.
  const a=await call('tasks/authorize',{challengeId:p.data.challengeId,taskDigest:task.digest,executorDigest:id.digest,observationPolicyDigest:observation.digest,code:null});
  assert.equal(a.status,200,JSON.stringify(a.data));
  const child=freezeChildOperation({schema:'8415-agent-child/1',operationId:'op:route',taskDigest:task.digest,
   operation:task.policy.intent.operation,nonce:'0',expiresAt:String(time/1000+600),
   wire:{to:'0x'+'2'.repeat(40),calldataHash:hashControlBytes('0x'),valueWei:'1'},
   fees:{gasLimit:'21000',maxFeePerGasWei:'1'},market:null});
  return call('tasks/reserve',{taskDigest:task.digest,child:child.child,expectedBudgetRevision:a.data.budget.revision});
 }
 return {origin,store,call,login,save,reserveNative,mailbox,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('real route requires session tenant origin CSRF and preserves initial ON without a save',async t=>{
 const f=await fixture();t.after(f.close);
 assert.equal((await f.call('account/asset-controls/status',{})).status,401);
 await f.login();const before=JSON.stringify(await f.store.read('synthetic:owner'));
 const s=await f.call('account/asset-controls/status',{});assert.equal(s.status,200);assert.equal(s.data.defaultValue,true);
 assert.equal(s.data.revision,'0');assert.deepEqual(s.data.entries,[]);assert.equal(s.data.changeCount,0);assert.equal(s.data.canSave,true);
 assert.equal(JSON.stringify(await f.store.read('synthetic:owner')),before);
 assert.equal((await f.call('account/asset-controls/status',{}, {'X-Wallet-Tenant':'other'})).status,403);
 assert.equal((await f.call('account/asset-controls/status',{}, {Origin:'https://other.invalid'})).status,403);
 assert.equal((await f.call('account/asset-controls/status',{}, {'X-Wallet-CSRF':'wrong'})).status,401);
});
test('catalog is scoped native identity not ownership claim and rejects caller-invented asset paths',async t=>{
 const f=await fixture();t.after(f.close);await f.login();
 const c=await f.call('account/asset-controls/catalog',{});assert.equal(c.status,200);assert.equal(c.data.entries.length,1);
 assert.equal(c.data.entries[0].subject.standard,'native');assert.equal(c.data.inventoryComplete,false);assert.equal(c.data.ownershipVerified,false);
 const p=await f.call('account/asset-controls/prepare',{expectedRevision:'0',identityMethod:'wallet',
 patch:{target:{kind:'asset',path:['all','invented']},value:false,expectedFieldRevision:'0'}});
 assert.equal(p.status,403);assert.equal(p.data.error,'AUTH_ASSET_CATALOG_TARGET_REFUSED');assert.equal(f.mailbox.length,0);
});
test('saved overall OFF through exact two factors blocks the actual native reserve gate with no signing',async t=>{
 const f=await fixture();t.after(f.close);await f.login();
 const saved=await f.save({kind:'allow-agent'},false);assert.equal(saved.revision,'1');assert.equal(saved.entries[0].value,false);
 const status=await f.call('account/asset-controls/status',{});assert.equal(status.data.entries[0].value,false);
 const result=await f.reserveNative();assert.equal(result.status,403,JSON.stringify(result.data));
 assert.equal(result.data.error,'ASSET_CONTROL_AGENT_DISABLED');
});
test('new session/UI connection reads the saved corresponding override without replacing it',async t=>{
 const f=await fixture();t.after(f.close);await f.login();
 const catalog=await f.call('account/asset-controls/catalog',{}),target={kind:'operation',path:catalog.data.entries[0].path,operation:'wallet:native-transfer'};
 await f.save(target,false);await f.call('logout',{});await f.login();
 const state=await f.call('account/asset-controls/status',{});assert.equal(state.data.revision,'1');assert.equal(state.data.entries[0].value,false);
 const result=await f.reserveNative();assert.equal(result.status,403);assert.equal(result.data.error,'ASSET_CONTROL_OPERATION_DISABLED');
});
test('unconfigured executor preserves default ON but cannot save an invented Agent namespace',async t=>{
 const f=await fixture({configured:false});t.after(f.close);await f.login();
 const s=await f.call('account/asset-controls/status',{});assert.equal(s.status,200);assert.equal(s.data.defaultValue,true);assert.equal(s.data.canSave,false);
 const p=await f.call('account/asset-controls/prepare',{expectedRevision:'0',identityMethod:'wallet',
 patch:{target:{kind:'allow-agent'},value:false,expectedFieldRevision:'0'}});
 assert.equal(p.status,503);assert.equal(p.data.error,'AUTH_POLICY_AGENT_SCOPE_UNAVAILABLE');assert.equal(f.mailbox.length,0);
});
