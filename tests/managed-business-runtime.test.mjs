import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {request} from 'node:http';
import {openEncryptedStore} from '../server/store.mjs';
import {createManagedBusinessRuntime} from '../server/managed-business-runtime.mjs';
const origin='https://wallet.example.invalid',sourceIdentity={commit:'1'.repeat(40),tree:'2'.repeat(40)};
async function fixture(t,{initialize=false}={}) {
 const directory=await mkdtemp(join(tmpdir(),'wallet-business-runtime-'));
 const config={origin,tenant:'fixture',socketPath:join(directory,'auth.sock'),statePath:join(directory,'state.enc'),accounts:[]};
 const key=randomBytes(32),store=await openEncryptedStore(config.statePath,key);
 if(initialize)await store.transaction('fixture:tester',()=>({revision:1}));
 t.after(async()=>{await store.close();key.fill(0);await rm(directory,{recursive:true,force:true});});
 return {config,store,transportOrigin:origin,sourceIdentity};
}
test('business composition refuses genuinely uninitialized state without first persistence',async t=>{
 const input=await fixture(t);
 await assert.rejects(createManagedBusinessRuntime(input),/AUTH_BUSINESS_EXISTING_STATE_REQUIRED/);
 await assert.rejects(stat(input.config.statePath),{code:'ENOENT'});
 assert.equal(input.store.originTransitionBinding().stateEstablished,false);
});
test('business composition cannot translate an existing authentication origin',async t=>{
 const input=await fixture(t,{initialize:true});
 await assert.rejects(createManagedBusinessRuntime({...input,config:{...input.config,origin:origin+':9446'}}),/AUTH_BUSINESS_ORIGIN_MIGRATION_REQUIRED/);
});
test('a different state reference cannot substitute for the configured original store',async t=>{
 const input=await fixture(t,{initialize:true});
 await assert.rejects(createManagedBusinessRuntime({...input,config:{...input.config,statePath:input.config.statePath+'.other'}}),/AUTH_BUSINESS_EXISTING_STATE_REQUIRED/);
});
test('a nonpersisting store view cannot enable business APIs',async t=>{
 const input=await fixture(t,{initialize:true});
 await assert.rejects(createManagedBusinessRuntime({...input,store:{originTransitionBinding:()=>input.store.originTransitionBinding()}}),/AUTH_BUSINESS_WRITABLE_STORE_REQUIRED/);
});
test('standard API composition exposes authentication rather than the auth-only routing refusal',async t=>{
 const input=await fixture(t,{initialize:true}),runtime=await createManagedBusinessRuntime(input);
 t.after(()=>runtime.stop());await runtime.start();
 async function call(path,body,headers={}) {
  return new Promise((resolve,reject)=>{
   const req=request({socketPath:input.config.socketPath,path:'/auth/'+path,method:body===undefined?'GET':'POST',headers:{Host:'wallet.example.invalid',Origin:origin,'X-Wallet-Tenant':'fixture',...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{
    const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:JSON.parse(Buffer.concat(chunks))}));res.on('error',reject);
   });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
 }
 const bootstrap=await call('bootstrap');assert.equal(bootstrap.status,200);
 assert.equal(bootstrap.headers['x-wallet-source-commit'],sourceIdentity.commit);
 assert.equal(bootstrap.headers['x-wallet-runtime-mode'],'business-runtime');
 const cookies=bootstrap.headers['set-cookie'].map(v=>v.split(';')[0]).join('; ');
 const prepare=await call('tasks/prepare',{}, {'X-Wallet-CSRF':bootstrap.data.csrf,Cookie:cookies});
 assert.equal(prepare.status,401);assert.equal(prepare.data.error,'AUTH_REFUSED');
 assert.equal(runtime.exactState,'disabled');
 assert.equal(runtime.server.listening,true);
 await runtime.stop();
 const record=await input.store.read('fixture:tester');assert.deepEqual(record,{revision:1});
});
