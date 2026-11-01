/** Synthetic metadata only, not an inspection of any real process memory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOriginalUninitializedWitness,sourceInstallationReference,validatePackagedSourceReceipt,loadSourceInstallationReceipt,SOURCE_RECEIPT_LAYOUT } from '../server/auth-integration-provenance.mjs';
import { originalAuthenticationStoreView } from '../server/auth-integration-runtime.mjs';
import { openEncryptedStore } from '../server/store.mjs';
import { mkdtemp,lstat,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const expected={tenant:'fixture',statePath:'/var/lib/8415wallet-auth-fixture/credentials.enc',transportOrigin:'https://wallet.example',
 sourceIdentity:{commit:'1'.repeat(40),tree:'2'.repeat(40)},directory:{inode:'123',mtimeNs:'1800000000000000010'}};
const witness=()=>({schema:'8415wallet-original-uninitialized-store-witness/1',tenant:expected.tenant,statePath:expected.statePath,
 unitName:'8415wallet-auth-fixture.service',sourceCommit:expected.sourceIdentity.commit,sourceTree:expected.sourceIdentity.tree,transportOrigin:expected.transportOrigin,
 gracefulDrainCompleted:true,storeFileAbsentBefore:true,storeFileAbsentAfterDrain:true,originalOpenLockVerified:true,
 priorMainPid:'1234',priorStoreSourceSha256:'a'.repeat(64),priorSourceCommit:'3'.repeat(40),priorSourceTree:'4'.repeat(40),
 beforeDirectory:{inode:'123',ctimeNs:'1800000000000000000',mtimeNs:'1800000000000000000',uid:0,gid:0,mode:'0o700'},
 beforeLock:{inode:'124',ctimeNs:'1800000000000000000',mtimeNs:'1800000000000000000',uid:0,gid:0,mode:'0o600',size:0,links:1},
 afterDrainDirectory:{inode:'123',mtimeNs:expected.directory.mtimeNs,uid:0,gid:0,mode:'0o700'}});
test('metadata witness binds only a nonpersisting original authentication view, never business authority',()=>{
 const result=validateOriginalUninitializedWitness(witness(),expected);assert.equal(result.businessAuthorityAvailable,false);assert.equal(result.storeInitializationAllowed,false);
});
test('changed directory, lock, scope, source or incomplete drain refuses instead of assuming an empty original store',()=>{
 for(const mutate of [w=>w.gracefulDrainCompleted=false,w=>w.originalOpenLockVerified=false,w=>w.storeFileAbsentBefore=false,
  w=>w.beforeDirectory.ctimeNs='1800000000000000001',w=>w.afterDrainDirectory.inode='125',w=>w.afterDrainDirectory.mtimeNs='1800000000000000011',
  w=>w.sourceCommit='5'.repeat(40),w=>w.tenant='other',w=>w.priorStoreSourceSha256='0'.repeat(64),w=>w.beforeLock.size=1]){
  const w=witness();mutate(w);assert.throws(()=>validateOriginalUninitializedWitness(w,expected),/AUTH_ORIGIN_EXISTING_STATE_REQUIRED/);
 }
});
test('uninitialized view cannot create a credential file; initialized authentication retains replay writes',async()=>{
 let writes=0;const store={read:async()=>null,readMany:async()=>({}),withReadGate:async()=>{},withReadSnapshot:async()=>{},
  originTransitionBinding:()=>({stateEstablished:false,minimumGeneration:1}),transaction:async()=>{writes++;},transactionMany:async()=>{writes++;}};
 const view=originalAuthenticationStoreView(store,{uninitialized:true});assert.equal(await view.read('original'),null);
 assert.throws(()=>view.transaction('anything',()=>({})),/INITIALIZATION_NOT_AUTHORIZED/);assert.throws(()=>view.transactionMany(['anything'],()=>({})),/INITIALIZATION_NOT_AUTHORIZED/);
 assert.equal(writes,0);assert.equal(originalAuthenticationStoreView(store),store);await originalAuthenticationStoreView(store).transaction('original',()=>({lastStep:1}));assert.equal(writes,1);
});
test('encrypted original uninitialized path remains absent through the nonpersisting view',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wallet-auth-original-view-')),path=join(dir,'original.enc'),key=Buffer.alloc(32,31);
 const store=await openEncryptedStore(path,key);t.after(async()=>{await store.close();key.fill(0);await rm(dir,{recursive:true,force:true});});
 assert.equal(store.originTransitionBinding().stateEstablished,false);const view=originalAuthenticationStoreView(store,{uninitialized:true});
 assert.equal(await view.read('configured-user'),null);assert.throws(()=>view.transaction('new',()=>({})),/INITIALIZATION_NOT_AUTHORIZED/);
 await assert.rejects(lstat(path),{code:'ENOENT'});
});


test('packaged receipt is outside immutable payload, legacy source keeps its original location',()=>{
 const runtime='/opt/8415wallet-auth-fixture/releases/'+'2'.repeat(40),external=sourceInstallationReference(runtime,{packaged:true});
 assert.equal(external.receiptPath,'/opt/8415wallet-auth-fixture/source-installations/'+'2'.repeat(40)+'.json');assert.equal(external.receiptPath.startsWith(runtime+'/'),false);
 assert.equal(sourceInstallationReference(runtime,{packaged:false}).receiptPath,runtime+'/SOURCE-INSTALLATION.json');
 const legacyRuntime='/opt/fixture/approved-source-workspace';assert.equal(sourceInstallationReference(legacyRuntime,{packaged:false}).receiptPath,legacyRuntime+'/SOURCE-INSTALLATION.json');
 for(const path of ['/opt/../other/releases/'+'2'.repeat(40),'/opt/fixture/current','relative/releases/'+'2'.repeat(40)])assert.throws(()=>sourceInstallationReference(path,{packaged:true}));
});
test('packaged external receipt requires exact release source, runtime and explicit layout capability',()=>{
 const runtime='/opt/fixture/releases/'+'2'.repeat(40),receipt={runtime,sourceDirty:false,sourceCommit:'1'.repeat(40),sourceTree:'2'.repeat(40)},release={schema:'8415wallet-auth-runtime/1',runtime:{sourceInstallationReceiptLayout:SOURCE_RECEIPT_LAYOUT},source:{commit:'1'.repeat(40),tree:'2'.repeat(40),dirty:false}};
 assert.equal(validatePackagedSourceReceipt(receipt,release,runtime).sourceTree,receipt.sourceTree);
 for(const mutate of [r=>r.source.commit='3'.repeat(40),r=>r.source.tree='3'.repeat(40),r=>r.source.dirty=true,r=>delete r.runtime.sourceInstallationReceiptLayout]){const r=structuredClone(release);mutate(r);assert.throws(()=>validatePackagedSourceReceipt(receipt,r,runtime));}
 assert.throws(()=>validatePackagedSourceReceipt({...receipt,runtime:'/other'},release,runtime));
});
test('missing or invalid packaged metadata never falls back to an available legacy payload receipt',async()=>{
 const runtime='/opt/fixture/releases/'+'2'.repeat(40),receipt={runtime,sourceDirty:false,sourceCommit:'1'.repeat(40),sourceTree:'2'.repeat(40)},release={schema:'8415wallet-auth-runtime/1',runtime:{sourceInstallationReceiptLayout:SOURCE_RECEIPT_LAYOUT},source:{commit:receipt.sourceCommit,tree:receipt.sourceTree,dirty:false}},attempts=[];
 const legacy=runtime+'/SOURCE-INSTALLATION.json';
 await assert.rejects(loadSourceInstallationReceipt(runtime,{packaged:true,release,readReceipt:async ref=>{attempts.push(ref.receiptPath);if(ref.receiptPath===legacy)return receipt;throw Object.assign(Error('missing external receipt'),{code:'ENOENT'});}}),{code:'ENOENT'});
 assert.equal(attempts.length,1);assert.notEqual(attempts[0],legacy);
 await assert.rejects(loadSourceInstallationReceipt(runtime,{packaged:true,release:null,readReceipt:async()=>receipt}),/PACKAGE_IDENTITY_REFUSED/);
 assert.equal(await loadSourceInstallationReceipt(runtime,{packaged:false,release:null,readReceipt:async ref=>{assert.equal(ref.receiptPath,legacy);return receipt;}}),receipt);
 assert.equal(await loadSourceInstallationReceipt(runtime,{packaged:true,release,readReceipt:async ref=>{assert.equal(ref.metadataDirectory,'/opt/fixture/source-installations');return receipt;}}),receipt);
});
