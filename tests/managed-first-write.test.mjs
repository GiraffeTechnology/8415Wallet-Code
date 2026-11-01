/** Synthetic encrypted fixtures on approved Linux. No production identity,
 * credential, RPC, transaction signature or broadcast is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rename,rm,stat,unlink,mkdir,copyFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {Wallet} from 'ethers';
import {openEncryptedStore} from '../server/store.mjs';
import {createManagedFirstWrite} from '../server/managed-first-write.mjs';
import {createManagedBusinessRuntime} from '../server/managed-business-runtime.mjs';
import {freezeTaskPolicy} from '../src/agent/taskContract.ts';
const origin='https://wallet.example.invalid',tenant='fixture',epoch=1800000000000;
const sourceIdentity={commit:'1'.repeat(40),tree:'2'.repeat(40)};
async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'wallet-first-write-')),key=randomBytes(32),wallet=Wallet.createRandom();
 const stateDirectory=join(root,'state');await mkdir(stateDirectory,{mode:0o700});const initialDirectory=await stat(stateDirectory,{bigint:true});
 const config={origin:origin+':9446',tenant,socketPath:join(root,'auth.sock'),statePath:join(stateDirectory,'state.enc'),accounts:[{username:'tester',wallets:[{account:wallet.address,chainId:'560048'}]}]};
 // The owner role is synthetic; inode/mode/timestamps come from the real Linux
 // fixture directory so replacement tests do not merely edit a claimed number.
 const directory={inode:String(initialDirectory.ino),mtimeNs:String(initialDirectory.mtimeNs),uid:0,gid:0,mode:'0o700'};
 const currentDirectory={...directory};
 const witness={schema:'8415wallet-original-uninitialized-store-witness/1',tenant,statePath:config.statePath,unitName:'8415wallet-auth-'+tenant+'.service',sourceCommit:sourceIdentity.commit,sourceTree:sourceIdentity.tree,transportOrigin:origin,
  gracefulDrainCompleted:true,storeFileAbsentBefore:true,storeFileAbsentAfterDrain:true,originalOpenLockVerified:true,priorMainPid:'900',priorSourceCommit:'3'.repeat(40),priorSourceTree:'4'.repeat(40),priorStoreSourceSha256:'5'.repeat(64),
  beforeDirectory:{...directory,ctimeNs:'150',mtimeNs:'150'},beforeLock:{inode:'101',ctimeNs:'150',mtimeNs:'150',uid:0,gid:0,mode:'0o600',size:0,links:1},afterDrainDirectory:directory};
 const receipt={schema:'8415wallet-prepared-source-install/1',status:'SOURCE_AND_PINNED_RUNTIME_DEPENDENCIES_INSTALLED_NOT_ACTIVATED',sourceCommit:sourceIdentity.commit,sourceTree:sourceIdentity.tree,sourceDirty:false,runtime:root,originalStoreWitness:witness};
 const journal=join(root,'source-receipt.first-write.json');let failPrepared=false,failCommitted=false,opened=[],syncFailure=null;const durabilityEvents=[];
 async function readJournal(){try{return JSON.parse(await readFile(journal,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
 async function writeJournal(value){
  if(value.phase==='committed'&&failCommitted){failCommitted=false;throw Error('SYNTHETIC_COMMIT_ACK_LOST');}
  const temporary=journal+'.pending';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,journal);durabilityEvents.push('journal:'+value.phase);
  if(value.phase==='prepared'&&failPrepared){failPrepared=false;throw Error('SYNTHETIC_PREPARE_ACK_LOST');}
 }
 async function lifecycle(overrides={}) {
  const actual=await stat(stateDirectory,{bigint:true});Object.assign(currentDirectory,{inode:String(actual.ino),mtimeNs:String(actual.mtimeNs),mode:'0o'+(Number(actual.mode)&0o7777).toString(8)});
  const stateExists=await stat(config.statePath).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  return createManagedFirstWrite({receipt,config,configurationSha256:'6'.repeat(64),transportOrigin:origin,directory:currentDirectory,stateExists,readJournal,writeJournal,
   readDirectoryIdentity:async()=>{const value=await stat(stateDirectory,{bigint:true});return {inode:String(value.ino),mtimeNs:String(value.mtimeNs),uid:0,gid:0,mode:'0o'+(Number(value.mode)&0o7777).toString(8)};},
   directorySyncObserver:async({phase,when})=>{durabilityEvents.push('directory:'+phase+':'+when);if(syncFailure===phase+':'+when){syncFailure=null;throw Error('SYNTHETIC_DIRECTORY_SYNC_BOUNDARY_FAILURE');}},...overrides});
 }
 async function open(){const first=await lifecycle(),store=await openEncryptedStore(config.statePath,key,{firstWriteLifecycle:first.hooks});opened.push(store);return {first,store};}
 t.after(async()=>{for(const store of opened)await store.close();key.fill(0);await rm(root,{recursive:true,force:true});});
 return {root,stateDirectory,key,wallet,config,directory:currentDirectory,receipt,journal,readJournal,lifecycle,open,durabilityEvents,failDirectorySync:(phase,when='before')=>{syncFailure=phase+':'+when;},failPrepared:()=>{failPrepared=true;},failCommitted:()=>{failCommitted=true;}};
}
test('admission records only provenance and creates no empty credential state',async t=>{
 const f=await fixture(t),{first,store}=await f.open();assert.equal(first.status(),'admitted');assert.equal(store.originTransitionBinding().stateEstablished,false);
 await assert.rejects(stat(f.config.statePath),{code:'ENOENT'});assert.equal((await f.readJournal()).phase,'admitted');assert.equal((await f.readJournal()).candidate,null);
});
test('directory durability precedes prepared and committed journal phases',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.transaction('original:record',()=>({revision:1}));
 const order=f.durabilityEvents;
 assert.ok(order.indexOf('directory:candidate-before-prepare:after')>=0);
 assert.ok(order.indexOf('directory:candidate-before-prepare:after')<order.indexOf('journal:prepared'));
 assert.ok(order.indexOf('journal:prepared')<order.indexOf('directory:state-after-replace:after'));
 assert.ok(order.indexOf('directory:state-after-replace:after')<order.indexOf('journal:committed'));
});
test('candidate-directory sync failure cannot prepare or commit and preserves its candidate',async t=>{
 const f=await fixture(t),{store}=await f.open();f.failDirectorySync('candidate-before-prepare');
 await assert.rejects(store.transaction('original:record',()=>({revision:1})),/SYNTHETIC_DIRECTORY_SYNC_BOUNDARY_FAILURE/);
 assert.equal((await f.readJournal()).phase,'admitted');await assert.rejects(stat(f.config.statePath),{code:'ENOENT'});await store.close();
 await assert.rejects(f.open(),/AUTH_FIRST_WRITE_UNJOURNALED_CANDIDATE/);assert.equal(f.durabilityEvents.includes('journal:prepared'),false);
});
for(const when of ['before','after'])test('existing destination recovery sync '+when+' failure leaves prepared and never replays the mutation',async t=>{
 const f=await fixture(t),{store}=await f.open();let mutations=0;f.failDirectorySync('state-after-replace');
 await assert.rejects(store.transaction('original:record',()=>{mutations++;return {status:'outcome-unknown',reservedWei:'31'};}),/SYNTHETIC_DIRECTORY_SYNC_BOUNDARY_FAILURE/);
 await stat(f.config.statePath);assert.equal((await f.readJournal()).phase,'prepared');await store.close();f.failDirectorySync('recovery-before-commit',when);
 await assert.rejects(f.open(),/SYNTHETIC_DIRECTORY_SYNC_BOUNDARY_FAILURE/);assert.equal((await f.readJournal()).phase,'prepared');assert.equal(mutations,1);
 const recovered=await f.open();assert.equal(recovered.first.status(),'committed');assert.equal((await recovered.store.read('original:record')).status,'outcome-unknown');assert.equal(mutations,1);
 assert.ok(f.durabilityEvents.lastIndexOf('directory:recovery-before-commit:after')<f.durabilityEvents.lastIndexOf('journal:committed'));
});
test('a clean pre-transaction restart keeps admission without rebinding the old directory timestamp',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.close();f.directory.mtimeNs='300';
 const reopened=await f.open();assert.equal(reopened.first.status(),'admitted');assert.equal(reopened.store.originTransitionBinding().stateEstablished,false);await assert.rejects(stat(f.config.statePath),{code:'ENOENT'});
});
for(const phase of ['admitted','prepared','committed'])test('a replaced original directory is refused in '+phase+' state',async t=>{
 const f=await fixture(t),{store}=await f.open();
 if(phase==='prepared'){f.failPrepared();await assert.rejects(store.transaction('original:record',()=>({revision:1})));}
 if(phase==='committed')await store.transaction('original:record',()=>({revision:1}));
 await store.close();const original=f.stateDirectory+'.original';await rename(f.stateDirectory,original);await mkdir(f.stateDirectory,{mode:0o700});
 const record=await f.readJournal();
 if(phase==='prepared')await copyFile(join(original,record.candidate.temporaryName),join(f.stateDirectory,record.candidate.temporaryName));
 if(phase==='committed')await copyFile(join(original,'state.enc'),f.config.statePath);
 assert.notEqual(String((await stat(f.stateDirectory,{bigint:true})).ino),f.receipt.originalStoreWitness.afterDrainDirectory.inode);
 await assert.rejects(f.open(),/AUTH_FIRST_WRITE_DIRECTORY_IDENTITY_CHANGED/);
});
test('changed original directory permissions are refused after admission',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.close();await chmod(f.stateDirectory,0o750);
 await assert.rejects(f.open(),/AUTH_FIRST_WRITE_DIRECTORY_IDENTITY_CHANGED/);
});
test('original directory identity is measured again after taking the writer lock',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.close();const first=await f.lifecycle();
 await rename(f.stateDirectory,f.stateDirectory+'.original');await mkdir(f.stateDirectory,{mode:0o700});
 await assert.rejects(openEncryptedStore(f.config.statePath,f.key,{firstWriteLifecycle:first.hooks}),/AUTH_FIRST_WRITE_DIRECTORY_IDENTITY_CHANGED/);
});
test('an unjournaled encrypted temporary candidate is preserved rather than ignored',async t=>{
 const f=await fixture(t),first=await f.lifecycle(),path=f.config.statePath+'.'+'a'.repeat(24)+'.tmp';await writeFile(path,'UNRESOLVED_FIXTURE_CANDIDATE',{mode:0o600});
 await assert.rejects(openEncryptedStore(f.config.statePath,f.key,{firstWriteLifecycle:first.hooks}),/AUTH_FIRST_WRITE_UNJOURNALED_CANDIDATE/);assert.equal(await readFile(path,'utf8'),'UNRESOLVED_FIXTURE_CANDIDATE');
 await assert.rejects(stat(f.config.statePath),{code:'ENOENT'});assert.equal(await f.readJournal(),null);
});
test('prepared encrypted candidate survives metadata acknowledgement loss and resumes without replay',async t=>{
 const f=await fixture(t),{store}=await f.open();f.failPrepared();let mutations=0;
 await assert.rejects(store.transaction('task:synthetic',()=>{mutations++;return {status:'outcome-unknown',nonce:'7',reservedWei:'31'};}),/SYNTHETIC_PREPARE_ACK_LOST/);
 const prepared=await f.readJournal();assert.equal(prepared.phase,'prepared');await assert.rejects(stat(f.config.statePath),{code:'ENOENT'});
 await stat(join(f.stateDirectory,prepared.candidate.temporaryName));await store.close();
 const recovered=await f.open();assert.equal(recovered.first.status(),'committed');assert.equal(mutations,1);
 assert.deepEqual(await recovered.store.read('task:synthetic'),{status:'outcome-unknown',nonce:'7',reservedWei:'31'});
 assert.ok(f.durabilityEvents.lastIndexOf('directory:recovery-before-commit:after')>=0);
 assert.ok(f.durabilityEvents.lastIndexOf('directory:recovery-before-commit:after')<f.durabilityEvents.lastIndexOf('journal:committed'));
});
test('renamed state survives commit-journal failure and is admitted after authenticated decoding',async t=>{
 const f=await fixture(t),{store}=await f.open();f.failCommitted();
 await assert.rejects(store.transaction('original:record',()=>({scope:'unchanged',expiresAt:'1800007200',revoked:false})),/SYNTHETIC_COMMIT_ACK_LOST/);
 await stat(f.config.statePath);assert.equal((await f.readJournal()).phase,'prepared');await store.close();
 const recovered=await f.open();assert.equal(recovered.first.status(),'committed');assert.equal((await recovered.store.read('original:record')).scope,'unchanged');
});
test('a changed prepared ciphertext is refused and preserved',async t=>{
 const f=await fixture(t),{store}=await f.open();f.failPrepared();await assert.rejects(store.transaction('original:record',()=>({revision:1})));await store.close();
 const value=await f.readJournal(),path=join(f.stateDirectory,value.candidate.temporaryName);await writeFile(path,'tampered',{mode:0o600});
 await assert.rejects(f.open(),/AUTH_FIRST_WRITE_CANDIDATE_CHANGED/);assert.equal(await readFile(path,'utf8'),'tampered');assert.equal((await f.readJournal()).phase,'prepared');
});
test('prepared provenance is not committed until the original key decrypts the candidate',async t=>{
 const f=await fixture(t),{store}=await f.open();f.failPrepared();await assert.rejects(store.transaction('original:record',()=>({revision:1})));await store.close();
 const first=await f.lifecycle(),wrongKey=randomBytes(32);
 await assert.rejects(openEncryptedStore(f.config.statePath,wrongKey,{firstWriteLifecycle:first.hooks}));wrongKey.fill(0);
 assert.equal((await f.readJournal()).phase,'prepared');
 const reopened=await f.open();assert.equal(reopened.first.status(),'committed');assert.deepEqual(await reopened.store.read('original:record'),{revision:1});
});
test('an existing state cannot be admitted by a witness without its establishment journal',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.transaction('original:record',()=>({revision:1}));await store.close();await unlink(f.journal);
 await assert.rejects(f.open(),/AUTH_FIRST_WRITE_UNPROVEN_EXISTING_STATE/);
});
test('committed establishment does not permit a missing store to become an empty replacement',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.transaction('original:record',()=>({revision:1}));await store.close();await unlink(f.config.statePath);
 await assert.rejects(f.open(),/AUTH_FIRST_WRITE_ESTABLISHED_STATE_MISSING/);
});
test('journal scope pins config, origin, source and the retained original witness',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.transaction('original:record',()=>({revision:1}));await store.close();
 for(const overrides of [{configurationSha256:'7'.repeat(64)},{transportOrigin:'https://other.example.invalid'},{receipt:{...f.receipt,sourceCommit:'8'.repeat(40)}}])await assert.rejects(f.lifecycle(overrides));
 const first=await f.lifecycle();await assert.rejects(createManagedBusinessRuntime({config:f.config,store,transportOrigin:origin,sourceIdentity,originalFirstWrite:{...first.admission}}),/ADMISSION_REFUSED/);
});
test('later ordinary encrypted writes retain establishment and UNKNOWN records on restart',async t=>{
 const f=await fixture(t),{store}=await f.open();await store.transaction('original:record',()=>({revision:1,marker:'PRIVATE_FIXTURE_VALUE'}));
 await store.transaction('original:record',old=>({...old,revision:2,outcome:'outcome-unknown',nonce:'9'}));await store.close();
 const reopened=await f.open();assert.equal((await reopened.store.read('original:record')).revision,2);assert.equal((await reopened.store.read('original:record')).outcome,'outcome-unknown');
 const journal=await readFile(f.journal,'utf8');assert.equal(journal.includes('PRIVATE_FIXTURE_VALUE'),false);assert.equal(journal.includes(f.key.toString('hex')),false);
});
test('real fixture login remains nonpersisting; authenticated pending preparation is the first genuine write',async t=>{
 const f=await fixture(t),{first,store}=await f.open();let externalEffects=0;
 const unused=async()=>{externalEffects++;throw Error('NO_EXTERNAL_EFFECTS_DURING_PREPARATION');};
 const exactServerConfiguration={provider:{request:unused},externalSigner:{signExactTransaction:unused},signerIdentity:{signerId:'synthetic:signer',signerVersion:'1',implementationDigest:'0x'+'5'.repeat(64)},maxPriorityFeePerGasWei:'1',agentId:'synthetic:agent',agentVersion:'1',observationPolicy:{minimumConfirmations:'2'}};
 let runtime=await createManagedBusinessRuntime({config:f.config,store,transportOrigin:origin,sourceIdentity,originalFirstWrite:first.admission,now:()=>epoch,exactServerConfiguration});
 t.after(()=>runtime.stop());let csrf='';const cookies=new Map();
 async function call(path,body){
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method:body===undefined?'GET':'POST',url:'/auth/'+path,socket:{remoteAddress:'127.0.0.1'},headers:{host:'wallet.example.invalid',origin,'x-wallet-tenant':tenant,'content-type':'application/json','x-wallet-csrf':csrf,cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}});
  let status,data;await runtime.handler(req,{set statusCode(v){status=v;},setHeader(k,v){if(k.toLowerCase()==='set-cookie')for(const item of Array.isArray(v)?v:[v]){const pair=item.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}},end(v){data=JSON.parse(v);}});if(status===200&&data.csrf)csrf=data.csrf;return {status,data};
 }
 await call('bootstrap');assert.equal((await call('tasks/prepare',{})).status,401);
 const invalid=await call('challenge',{method:'wallet',account:f.wallet.address,chainId:'560048'});
 assert.equal((await call('proof',{id:invalid.data.id,account:f.wallet.address,chainId:'560048',signature:'0x'+'0'.repeat(130)})).status,401);
 await assert.rejects(stat(f.config.statePath),{code:'ENOENT'});assert.equal((await f.readJournal()).phase,'admitted');
 const challenge=await call('challenge',{method:'wallet',account:f.wallet.address,chainId:'560048'});
 assert.equal((await call('proof',{id:challenge.data.id,account:f.wallet.address,chainId:'560048',signature:await f.wallet.signMessage(challenge.data.message)})).status,200);
 await assert.rejects(stat(f.config.statePath),{code:'ENOENT'});
 const task=freezeTaskPolicy({schema:'8415-agent-task/1',taskId:'synthetic:first-write',tenant,origin,chainId:'560048',actor:f.wallet.address.toLowerCase(),expiresAt:String(epoch/1000+7200),fees:{perOperationWei:'1000000',totalWei:'1000000'},intent:{kind:'exact-operation',operation:{kind:'native-transfer',chainId:'560048',actor:f.wallet.address.toLowerCase(),recipient:'0x'+'2'.repeat(40),valueWei:'10'}}});
 const prepared=await call('tasks/prepare',{policy:task.policy});assert.equal(prepared.status,200,JSON.stringify(prepared.data));assert.equal(first.status(),'committed');assert.equal(externalEffects,0);
 assert.equal((await call('tasks/status',{taskDigest:task.digest})).data.effectiveStatus,'pending');assert.equal(f.config.origin,origin+':9446');
 await runtime.stop();await store.close();const reopened=await f.open();assert.equal(reopened.first.status(),'committed');assert.equal(reopened.store.originTransitionBinding().stateEstablished,true);
 runtime=await createManagedBusinessRuntime({config:f.config,store:reopened.store,transportOrigin:origin,sourceIdentity,originalFirstWrite:reopened.first.admission,now:()=>epoch,exactServerConfiguration});
 await call('bootstrap');const again=await call('challenge',{method:'wallet',account:f.wallet.address,chainId:'560048'});
 assert.equal((await call('proof',{id:again.data.id,account:f.wallet.address,chainId:'560048',signature:await f.wallet.signMessage(again.data.message)})).status,200);
 const afterRestart=await call('tasks/status',{taskDigest:task.digest});assert.equal(afterRestart.status,200);assert.equal(afterRestart.data.effectiveStatus,'pending');assert.equal(externalEffects,0);await runtime.stop();
});
