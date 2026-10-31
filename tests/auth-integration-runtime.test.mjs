/** Approved-Linux synthetic UDS fixtures, not TLS or live-account acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { createAuthIntegrationRuntime } from '../server/auth-integration-runtime.mjs';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
const origin='https://wallet.example',tenant='fixture',sourceIdentity={commit:'1'.repeat(40),tree:'2'.repeat(40)};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'wallet-auth-interop-')),wallet=Wallet.createRandom(),chainId='560048';
 const registration={version:1,email:'tester@example.invalid',verifiedAt:1};
 const original={'fixture:tester':{registration,revision:1,taskVerificationPolicies:{old:{mode:'OFF',revision:'8'}}},
  '@registration:fixture':{version:1,records:[{username:'tester',email:registration.email,verifiedAt:1}]},
  'task-grant:original':{status:'outcome-unknown',nonce:'7',principal:'original'},'task-nonce:original':{permanent:true}};
 const store=new MemoryCredentialStore(original),config={origin:origin+':9446',tenant,socketPath:join(dir,'auth.sock'),
  statePath:join(dir,'original.enc'),accounts:[{username:'tester',wallets:[{account:wallet.address,chainId}]}]};
 const runtime=createAuthIntegrationRuntime({config,store,transportOrigin:origin,sourceIdentity});await runtime.start();
 t.after(async()=>{await runtime.stop();await store.close();await rm(dir,{recursive:true,force:true});});
 const jar=new Map();let csrf='';
 async function call(path,body,overrides={}){
  const response=await new Promise((resolve,reject)=>{
   const req=request({socketPath:config.socketPath,path:'/auth/'+path,method:body===undefined?'GET':'POST',
    headers:{Host:'wallet.example',Origin:origin,'X-Wallet-Tenant':tenant,'X-Wallet-CSRF':csrf,
      Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{'Content-Type':'application/json'}),...overrides}},
    res=>{const chunks=[];res.on('data',v=>chunks.push(v));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(Buffer.concat(chunks).toString())}));});
   req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  for(const c of response.headers['set-cookie']??[]){const [k,v]=c.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}
  if(response.status===200&&response.data.csrf)csrf=response.data.csrf;return response;
 }
 async function login(){await call('bootstrap');const p=await call('challenge',{method:'wallet',account:wallet.address,chainId});
  assert.equal(p.status,200);assert.equal(p.data.origin,origin);assert.equal(p.data.message.includes(':9446'),false);
  const result=await call('proof',{id:p.data.id,account:wallet.address,chainId,signature:await wallet.signMessage(p.data.message)});
  assert.equal(result.status,200);assert.equal(result.data.origin,origin);
 }
 return {call,login,store,original,config};
}
test('real authentication bootstrap carries exact source identity and retains Host/tenant checks',async t=>{
 const f=await fixture(t),response=await f.call('bootstrap');assert.equal(response.status,200);assert.ok(response.data.csrf);
 assert.equal(response.headers['x-wallet-source-commit'],sourceIdentity.commit);assert.equal(response.headers['x-wallet-source-tree'],sourceIdentity.tree);
 assert.equal(response.headers['x-wallet-runtime-mode'],'auth-only-read-only');
 assert.equal((await f.call('bootstrap',undefined,{Host:'wallet.example:9446'})).status,403);
 assert.equal((await f.call('bootstrap',undefined,{'X-Wallet-Tenant':'other'})).status,403);
});
test('canonical login/session uses original configured identity while authority/settings/nonce records stay unchanged',async t=>{
 const f=await fixture(t);await f.login();const session=await f.call('session');assert.equal(session.status,200);assert.equal(session.data.username,'tester');
 for(const [path,body] of [['account',undefined],['authorization-context',undefined],['tasks/prepare',{}],['tasks/execute',{}],['assets/funds',{}],['account/task-verification/prepare',{}]]){
  const response=await f.call(path,body);assert.equal(response.status,503);assert.equal(response.data.error,'AUTH_INTEGRATION_READ_ONLY');
 }
 for(const [key,value] of Object.entries(f.original))assert.deepEqual(await f.store.read(key),value);
 assert.equal(f.config.origin,origin+':9446');assert.equal((await f.call('logout',{})).status,200);assert.equal((await f.call('session')).status,401);
});
test('integration worker and native authorization capabilities refuse rather than inventing an empty queue',()=>{
 const handler=createAuthService({origin,tenant,accounts:[],store:new MemoryCredentialStore(),integrationReadOnly:true});
 assert.throws(()=>handler.taskBackground.list(),/AUTH_INTEGRATION_READ_ONLY/);
 assert.throws(()=>handler.taskBackground.resume('anything'),/AUTH_INTEGRATION_READ_ONLY/);
 assert.throws(()=>handler.taskReceiptAuthorization.withPreparation({},'prepare',()=>assert.fail()),/AUTH_INTEGRATION_READ_ONLY/);
 assert.throws(()=>handler.taskListingAuthorization.inspect({}),/AUTH_INTEGRATION_READ_ONLY/);
});
test('operator transport cannot change host or select a noncanonical port',()=>{
 const config={origin:origin+':9446',tenant,socketPath:'/tmp/synthetic.sock',statePath:'/tmp/original.enc',accounts:[]};
 for(const transportOrigin of ['https://other.example','https://wallet.example:9447','http://wallet.example'])
  assert.throws(()=>createAuthIntegrationRuntime({config,store:new MemoryCredentialStore(),transportOrigin,sourceIdentity}));
});
