/** Original encrypted state and synthetic installation files only. No live
 * credential, systemd command, proxy or service is used by these fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm,lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openEncryptedStore } from '../server/store.mjs';
import { createOriginContinuation,originContinuationKey } from '../server/origin-continuation.mjs';
import { continueManagedOrigin } from '../deploy/auth-runtime/origin-continuation.mjs';
import { continueManagedOrigin as continueStandaloneOrigin } from '../deploy/auth-runtime-v2/origin-continuation.mjs';
import { paths } from '../deploy/auth-runtime/install.mjs';
const old='https://wallet.example:9446',origin='https://wallet.example',account='0x'+'1'.repeat(40);
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'wallet-managed-continuation-')),target=paths(root,'fixture');
 for(const dir of [target.root,target.config,target.state,target.socketDirectory])await mkdir(dir,{recursive:true,mode:0o700});
 const config={origin:old,tenant:'fixture',socketPath:join(target.socketDirectory,'auth.sock'),statePath:join(target.state,'credentials.enc'),
  accounts:[{username:'alice',wallets:[{account,chainId:'560048'}]}]};
 const receipt={schema:'8415wallet-auth-install/1',tenant:'fixture',origin:old,socketPath:config.socketPath,sourceTree:'1'.repeat(40),status:'proxy-enabled',
  previousReleases:[{sourceTree:'2'.repeat(40)}]};
 const configPath=join(target.config,'auth.json'),receiptPath=join(target.root,'installation.json');
 await writeFile(configPath,JSON.stringify(config),{mode:0o600});await writeFile(receiptPath,JSON.stringify(receipt),{mode:0o600});
 const key=Buffer.alloc(32,21);let store=await openEncryptedStore(config.statePath,key);
 const records={'fixture:alice':{revision:7,taskVerificationPolicies:{old:{mode:'OFF',revision:'8',changes:[{scopeDigest:'original'}]}}},
  'task-grant:original':{principal:JSON.stringify([old,'fixture','alice',account,'560048']),status:'outcome-unknown',nonce:'7'},
  'task-nonce:original':{permanent:true,transactionHash:'unchanged'},'task-queue:original':{entries:['task-grant:original']}};
 await store.transactionMany(Object.keys(records),()=>records);
 const proof=await store.inspectOriginContinuationState();assert.equal(Object.hasOwn(proof,'records'),false);
 const continuation=createOriginContinuation({schema:'8415wallet-origin-continuation/1',tenant:'fixture',authorizationOrigin:old,transportOrigin:origin,
  revision:'1',priorStateSha256:proof.stateSha256,contractDigest:'b'.repeat(64),principals:[{username:'alice',account,chainId:'560048'}]});
 t.after(async()=>{await store.close();key.fill(0);await rm(root,{recursive:true,force:true});});
 return {target,config,receipt,configPath,receiptPath,records,continuation,get store(){return store;},
  async reopen(){await store.close();store=await openEncryptedStore(config.statePath,key);},
  options(extra={}){return {target,store,continuation,uid:process.getuid(),run:async()=> 'MainPID=0\nActiveState=inactive\nSubState=dead\n',...extra};}};
}
async function verify(f) {
 assert.deepEqual(JSON.parse(await readFile(f.configPath,'utf8')),{...f.config,origin});
 const next=JSON.parse(await readFile(f.receiptPath,'utf8'));assert.equal(next.origin,origin);assert.deepEqual(next.previousReleases,f.receipt.previousReleases);
 assert.equal(next.originContinuation.digest,f.continuation.digest);
 for(const path of [join(f.target.config,'migration-config.lock'),join(f.target.root,'operation.lock')])await assert.rejects(lstat(path),{code:'ENOENT'});
 await f.reopen();for(const [key,value] of Object.entries(f.records))assert.deepEqual(await f.store.read(key),value);
 assert.deepEqual(await f.store.read(originContinuationKey(f.continuation)),f.continuation);
}
test('managed continuation updates only the origin file pair and exact continuation record',async t=>{
 const f=await fixture(t),result=await continueManagedOrigin(f.options());assert.equal(result.status,'origin-continuation-complete');
 assert.equal(result.serviceStarted,false);assert.equal(result.proxyChanged,false);await verify(f);
});
for(const interrupted of ['fenced','state-committed','config-written','receipt-written','archived','fence-cleared'])
test(`forward recovery after ${interrupted} retains original owner settings and UNKNOWN`,async t=>{
 const f=await fixture(t);await assert.rejects(continueManagedOrigin(f.options({checkpoint:async stage=>{if(stage===interrupted)throw Error('SYNTHETIC_INTERRUPTION');}})),/SYNTHETIC_INTERRUPTION/);
 await f.reopen();assert.equal((await continueManagedOrigin(f.options())).status,'origin-continuation-complete');await verify(f);
});
test('running service refuses before configuration or state changes',async t=>{
 const f=await fixture(t),before=await readFile(f.config.statePath);
 await assert.rejects(continueManagedOrigin(f.options({run:async()=> 'MainPID=123\nActiveState=active\nSubState=running\n'})),/AUTH_ORIGIN_SERVICE_MUST_BE_STOPPED/);
 assert.deepEqual(await readFile(f.config.statePath),before);assert.deepEqual(JSON.parse(await readFile(f.configPath,'utf8')),f.config);
});

test('standalone continuation shares the state protocol without the linked installer',async t=>{const f=await fixture(t);assert.equal((await continueStandaloneOrigin(f.options())).status,'origin-continuation-complete');await verify(f);});
