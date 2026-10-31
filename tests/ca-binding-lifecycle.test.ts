import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, commit, initial } from './helpers/method-change-fixture.ts';
import { caBindingsFor } from '../server/ca-bindings.mjs';
import { openEncryptedStore } from '../server/store.mjs';
import { openEncryptedStore as originalOpen } from './fixtures/ca-generation2/server/store.mjs';
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const claims: any[] = [];
const verifyCa = async (proof: any) => { claims.push(proof); if (proof.signature !== proof.message || ![A,B,C].includes(proof.certificateChain)) throw new Error('synthetic proof refused'); return { fingerprint: proof.certificateChain }; };
const newProof = (proof: any, fp = A) => ({ signature: proof.caMessage, certificateChain: fp, algorithm: 'synthetic-only' });
async function caLogin(f: any, fp: string) { const c=f.client(); await c.call('bootstrap'); const selected={account:f.signer.address,chainId:'1'}; const ch=await c.call('challenge',{method:'ca',...selected}); return c.call('proof',{id:ch.data.id,...selected,signature:ch.data.message,certificateChain:fp,algorithm:'synthetic-only'}); }
test('CA overlay is strict and explicit empty never revives configured binding', () => {
 assert.deepEqual(caBindingsFor({caFingerprints:[A]},{caBindings:{version:1,fingerprints:[]}}),[]);
 for(const overlay of [null,{}, {version:2,fingerprints:[]},{version:1,fingerprints:[A,A]},{version:1,fingerprints:[A.toUpperCase()]},{version:1,fingerprints:[],extra:true}]) assert.throws(()=>caBindingsFor({caFingerprints:[A]},{caBindings:overlay}));
});
test('initial CA requires independent combined proof and exact trusted new possession; login uses persisted overlay', async t=>{
 const f=await fixture({verifyCa});t.after(f.close); const c=f.client();await c.login();
 const proof=await f.authorize(c,{action:'ca.initial',newFingerprint:A});assert.match(proof.caMessage,/Purpose: ca.initial/);assert.match(proof.caMessage,/New certificate: a{64}/);
 assert.equal((await commit(c,proof,newProof(proof))).status,200);assert.equal((await f.store.read('xiongan:tester')).revision,2);
 assert.equal((await caLogin(f,A)).status,200); assert.equal((await caLogin(f,B)).status,401);
 f.restart();assert.equal((await caLogin(f,A)).status,200);
 assert.notEqual((await commit(c,proof,newProof(proof))).status,200);
});
test('replacement changes only selected fingerprint and invalidates old login, unbind persists tombstone across restart',async t=>{
 const f=await fixture({verifyCa,caFingerprints:[A,C]});t.after(f.close);let c=f.client();await c.login();
 let proof=await f.authorize(c,{action:'ca.replace',oldFingerprint:A,newFingerprint:B});assert.equal((await commit(c,proof,newProof(proof,B))).status,200);
 assert.equal((await caLogin(f,A)).status,401);assert.equal((await caLogin(f,B)).status,200);assert.equal((await caLogin(f,C)).status,200);
 c=f.client();await c.login();proof=await f.authorize(c,{action:'ca.unbind',oldFingerprint:B});assert.equal((await commit(c,proof)).status,200);
 assert.deepEqual((await f.store.read('xiongan:tester')).caBindings.fingerprints,[C]);
 c=f.client();await c.login();proof=await f.authorize(c,{action:'ca.unbind',oldFingerprint:C});assert.equal((await commit(c,proof)).status,200);
 f.restart();assert.equal((await caLogin(f,A)).status,401);assert.equal((await caLogin(f,C)).status,401);assert.deepEqual((await f.store.read('xiongan:tester')).caBindings.fingerprints,[]);
});
for(const variant of ['missing','wrong-certificate','wrong-message','stale-revision']) test(`CA new proof rejects ${variant} without mutation`,async t=>{
 const f=await fixture({verifyCa});t.after(f.close);const c=f.client();await c.login();const proof=await f.authorize(c,{action:'ca.initial',newFingerprint:A});
 const body: any=variant==='missing'?{}:newProof(proof,variant==='wrong-certificate'?B:A);if(variant==='wrong-message')body.signature='login';
 if(variant==='stale-revision')await f.store.transaction('xiongan:tester',(v:any)=>({...v,revision:2}));
 assert.notEqual((await commit(c,proof,body)).status,200);assert.equal((await f.store.read('xiongan:tester')).caBindings,undefined);
});
test('CA unavailable, forged flags, and wrong exact target fail before mutation',async t=>{
 const f=await fixture();t.after(f.close);const c=f.client();await c.login();assert.equal((await c.call('account/change/start',{action:'ca.initial',newFingerprint:A})).status,409);
 const g=await fixture({verifyCa,caFingerprints:[A]});t.after(g.close);const d=g.client();await d.login();
 for(const body of [{action:'ca.replace',oldFingerprint:B,newFingerprint:C},{action:'ca.unbind',oldFingerprint:A,newFingerprint:B},{action:'ca.replace',oldFingerprint:A,newFingerprint:B,verified:true}])assert.equal((await d.call('account/change/start',body)).status,400);
});
test('encrypted CA tombstone persists generation 3 and exact original reader refuses it',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ca-generation-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.enc'),key=Buffer.alloc(32,37);
 let store=await openEncryptedStore(path,key);await store.transaction('xiongan:tester',()=>({...initial()['xiongan:tester'],caBindings:{version:1,fingerprints:[]}}));await store.close();
 assert.equal(JSON.parse(await readFile(path,'utf8')).version,3);await assert.rejects(originalOpen(path,key),/AUTH_STORE_VERSION_REFUSED/);
 store=await openEncryptedStore(path,key);assert.deepEqual((await store.read('xiongan:tester')).caBindings,{version:1,fingerprints:[]});await store.transaction('xiongan:tester',(v:any)=>({...v,revision:2}));await store.close();assert.equal(JSON.parse(await readFile(path,'utf8')).version,3);
});
test('late new-CA verification after logout cannot commit or revive a session',async t=>{
 let release:()=>void=()=>{}, entered:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve});
 const f=await fixture({verifyCa:async (p:any)=>{entered();await waiting;return verifyCa(p);}});t.after(f.close);const c=f.client();await c.login();const proof=await f.authorize(c,{action:'ca.initial',newFingerprint:A});
 const pending=commit(c,proof,newProof(proof));await ready;await c.call('logout',{});release();assert.notEqual((await pending).status,200);assert.equal((await f.store.read('xiongan:tester')).caBindings,undefined);
});
test('same CA change proof cannot race two verifier calls or commit twice',async t=>{
 let release:()=>void=()=>{}, entered:()=>void=()=>{},calls=0;const waiting=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve});
 const f=await fixture({verifyCa:async (p:any)=>{calls++;entered();await waiting;return verifyCa(p);}});t.after(f.close);const c=f.client();await c.login();const proof=await f.authorize(c,{action:'ca.initial',newFingerprint:A});
 const pending=commit(c,proof,newProof(proof));await ready;assert.notEqual((await commit(c,proof,newProof(proof))).status,200);release();assert.equal((await pending).status,200);assert.equal(calls,1);assert.equal((await f.store.read('xiongan:tester')).revision,2);
});
test('CA status exposes only authenticated effective fingerprints and capability',async t=>{
 const f=await fixture({verifyCa,caFingerprints:[A],credential:{caBindings:{version:1,fingerprints:[B]}}});t.after(f.close);const c=f.client();
 assert.notEqual((await c.call('account')).status,200);await c.login();const account=(await c.call('account')).data;assert.deepEqual(account.caBindings,{fingerprints:[B]});assert.equal(account.caBindingManagement,'combined-v1');assert.equal((await c.call('capabilities')).data.caBindingManagement,'combined-v1');
 assert.throws(()=>caBindingsFor({caFingerprints:[A]},{caBindings:undefined}));
});
test('CA unbind cannot remove last enabled independent method, and does not consume revision',async t=>{
 const f=await fixture({verifyCa,caFingerprints:[A],credential:{enabledMethods:['ca']}});t.after(f.close);const c=f.client();await c.call('bootstrap');
 const selected={account:f.signer.address,chainId:'1'},challenge=(await c.call('challenge',{method:'ca',...selected})).data;
 assert.equal((await c.call('proof',{id:challenge.id,...selected,signature:challenge.message,certificateChain:A,algorithm:'synthetic-only'})).status,200);
 const proof=await f.authorize(c,{action:'ca.unbind',oldFingerprint:A});assert.equal((await commit(c,proof)).data.error,'AUTH_INDEPENDENT_METHOD_REQUIRED');
 const saved=await f.store.read('xiongan:tester');assert.equal(saved.revision,1);assert.equal(saved.caBindings,undefined);
});
for(const mode of ['credential-revision','cancel']) test(`new CA proof waiting across ${mode} cannot commit`,async t=>{
 let release:()=>void=()=>{}, entered:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve});
 const f=await fixture({verifyCa:async(p:any)=>{entered();await waiting;return verifyCa(p);}});t.after(f.close);const c=f.client();await c.login();const proof=await f.authorize(c,{action:'ca.initial',newFingerprint:A});
 const pending=commit(c,proof,newProof(proof));await ready;
 if(mode==='credential-revision')await f.store.transaction('xiongan:tester',(v:any)=>({...v,revision:v.revision+1}));else assert.equal((await c.call('account/change/cancel',{changeProof:proof.changeProof})).data.cancelled,true);
 release();assert.notEqual((await pending).status,200);assert.equal((await f.store.read('xiongan:tester')).caBindings,undefined);
});
test('CA replaced while login verifier is pending cannot authenticate the removed certificate',async t=>{
 let release:()=>void=()=>{}, entered:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{release=resolve}),ready=new Promise<void>(resolve=>{entered=resolve});
 const f=await fixture({caFingerprints:[A],verifyCa:async(p:any)=>{entered();await waiting;return verifyCa(p);}});t.after(f.close);
 const pending=caLogin(f,A);await ready;await f.store.transaction('xiongan:tester',(v:any)=>({...v,revision:v.revision+1,caBindings:{version:1,fingerprints:[B]}}));release();assert.equal((await pending).status,401);
});
