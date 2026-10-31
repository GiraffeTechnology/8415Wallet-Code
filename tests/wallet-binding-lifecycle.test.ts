import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, commit, initial, OLD } from './helpers/method-change-fixture.ts';
import { walletBindingsFor } from '../server/wallet-bindings.mjs';
import { openEncryptedStore } from '../server/store.mjs';
import { openEncryptedStore as gen3Open } from './fixtures/wallet-generation3/server/store.mjs';
async function passwordLogin(f:any) { const c=f.client(); await c.call('bootstrap'); const r=await c.call('password',{username:'tester',password:OLD,account:f.signer.address,chainId:'1'});assert.equal(r.status,200,JSON.stringify(r));return c; }
async function walletLogin(f:any) {const c=f.client();await c.call('bootstrap');const selected={account:f.signer.address,chainId:'1'};const ch=(await c.call('challenge',{method:'wallet',...selected})).data;return c.call('proof',{...selected,id:ch.id,signature:await f.signer.signMessage(ch.message)});}
async function unbind(f:any) {const c=f.client();await c.login();const proof=await f.authorize(c,{action:'wallet.unbind'});assert.equal((await commit(c,proof)).status,200);return {c,proof};}
test('wallet unbind is a persistent auth tombstone; asset account remains accessible by password',async t=>{
 const f=await fixture();t.after(f.close);const {c}=await unbind(f);assert.notEqual((await c.call('account')).status,200);assert.equal((await walletLogin(f)).status,401);
 f.restart();assert.equal((await walletLogin(f)).status,401);const p=await passwordLogin(f),a=(await p.call('account')).data;
 assert.equal(a.account,f.signer.address);assert.equal(a.walletBinding.bound,false);assert.equal(a.methods.wallet.bound,false);assert.equal(a.walletBindingManagement,'same-account-v1');
 assert.deepEqual((await f.store.read('xiongan:tester')).walletBindings,{version:1,identities:[]});
});
test('same-account rebind requires combined independent proof then exact new wallet signature and revokes old session',async t=>{
 const f=await fixture();t.after(f.close);await unbind(f);const c=await passwordLogin(f),proof=await f.authorize(c,{action:'wallet.initial'});
 assert.match(proof.walletMessage,/Purpose: wallet.initial/);assert.match(proof.walletMessage,/same-account wallet binding possession only/);
 assert.equal((await commit(c,proof,{signature:await f.signer.signMessage(proof.walletMessage)})).status,200);
 assert.notEqual((await c.call('account')).status,200);assert.equal((await walletLogin(f)).status,200);f.restart();assert.equal((await walletLogin(f)).status,200);
 assert.notEqual((await commit(c,proof,{signature:await f.signer.signMessage(proof.walletMessage)})).status,200);
});
for(const variant of ['missing','different-address','login-message','stale-revision','cancel','expired'])test(`same-account rebind refuses ${variant}`,async t=>{
 const f=await fixture();t.after(f.close);await unbind(f);const c=await passwordLogin(f),proof=await f.authorize(c,{action:'wallet.initial'});
 const signature=variant==='different-address'?await Wallet.createRandom().signMessage(proof.walletMessage):await f.signer.signMessage(variant==='login-message'?'login':proof.walletMessage);
 if(variant==='stale-revision')await f.store.transaction('xiongan:tester',(v:any)=>({...v,revision:v.revision+1}));
 if(variant==='cancel')await c.call('account/change/cancel',{changeProof:proof.changeProof});
 if(variant==='expired')f.state.now+=121000;
 assert.notEqual((await commit(c,proof,variant==='missing'?{}:{signature})).status,200);assert.deepEqual((await f.store.read('xiongan:tester')).walletBindings.identities,[]);
});
test('wallet replacement and injected target identity never enter supported change flow',async t=>{
 const f=await fixture();t.after(f.close);const c=f.client();await c.login();for(const body of [{action:'wallet.replace'},{action:'wallet.unbind',newAccount:Wallet.createRandom().address},{action:'wallet.unbind',walletBindings:{version:1,identities:[]}}])assert.equal((await c.call('account/change/start',body)).status,400);assert.equal(f.messages.length,0);
});
test('last independent wallet method cannot be removed; no password is invented',async t=>{
 const f=await fixture({passwordless:true});t.after(f.close);const c=f.client();await c.login();const p=await f.authorize(c,{action:'wallet.unbind'});assert.equal((await commit(c,p)).data.error,'AUTH_INDEPENDENT_METHOD_REQUIRED');assert.equal((await f.store.read('xiongan:tester')).walletBindings,undefined);
});
test('unbound wallet cannot re-enable itself or authorize security policy',async t=>{
 const f=await fixture();t.after(f.close);await unbind(f);const c=await passwordLogin(f);
 assert.equal((await c.call('account/change/start',{action:'wallet.initial',identityMethod:'wallet'})).data.error,'AUTH_INDEPENDENT_METHOD_REQUIRED');
 assert.equal((await c.call('account/change/start',{action:'methods',enabledMethods:['wallet']})).data.error,'AUTH_METHOD_UNAVAILABLE');
});
test('wallet overlay rejects malformed, foreign, duplicate and cross-chain bindings without fallback',()=>{
 const account=Wallet.createRandom().address,user={wallets:[{account,chainId:'1'}]};assert.deepEqual(walletBindingsFor(user,{walletBindings:{version:1,identities:[]}}),[]);
 for(const overlay of [null,undefined,{}, {version:2,identities:[]},{version:1,identities:[{account,chainId:'2'}]},{version:1,identities:[{account,chainId:'1'},{account,chainId:'1'}]},{version:1,identities:[],extra:true}])assert.throws(()=>walletBindingsFor(user,{walletBindings:overlay}));
});
test('encrypted generation 4 tombstone survives restart and gen3 reader refuses downgrade',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'wallet-binding-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'state.enc'),key=Buffer.alloc(32,29);
 let s=await openEncryptedStore(path,key);await s.transaction('xiongan:tester',()=>({...initial()['xiongan:tester'],walletBindings:{version:1,identities:[]}}));await s.close();assert.equal(JSON.parse(await readFile(path,'utf8')).version,4);await assert.rejects(gen3Open(path,key),/AUTH_STORE_VERSION_REFUSED/);
 s=await openEncryptedStore(path,key);assert.deepEqual((await s.read('xiongan:tester')).walletBindings.identities,[]);await s.transaction('xiongan:tester',(v:any)=>({...v,revision:7}));await s.close();assert.equal(JSON.parse(await readFile(path,'utf8')).version,4);
});
