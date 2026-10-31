import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { fixture, commit, OLD } from './helpers/method-change-fixture.ts';
test('multiaccount unbind keeps other signer and original asset selection, rejects unbound selected factor and last method removal',async t=>{
 const other=Wallet.createRandom(), f=await fixture({taskVerificationPolicyEnabled:true,extraWallets:[{account:other.address,chainId:'1'}]});t.after(f.close);const c=f.client();await c.login();
 const proof=await f.authorize(c,{action:'wallet.unbind'});assert.equal((await commit(c,proof)).status,200);
 assert.deepEqual((await f.store.read('xiongan:tester')).walletBindings.identities,[{account:other.address,chainId:'1'}]);
 const b=f.client();await b.call('bootstrap');const selected={account:other.address,chainId:'1'},challenge=(await b.call('challenge',{method:'wallet',...selected})).data;
 assert.equal((await b.call('proof',{...selected,id:challenge.id,signature:await other.signMessage(challenge.message)})).status,200);assert.equal((await b.call('account')).data.methods.wallet.bound,true);
 const a=f.client();await a.call('bootstrap');assert.equal((await a.call('password',{username:'tester',password:OLD,account:f.signer.address,chainId:'1'})).status,200);
 assert.equal((await a.call('account')).data.account,f.signer.address);assert.equal((await a.call('account')).data.methods.wallet.bound,false);
 assert.equal((await a.call('account/change/start',{action:'email.replace',email:'new@example.invalid',identityMethod:'wallet'})).data.error,'AUTH_INDEPENDENT_METHOD_REQUIRED');
 const policy=await a.call('account/task-verification/prepare',{mode:'OFF',expectedRevision:'0',identityMethod:'wallet'});
 assert.equal(policy.data.error,'TASK_VERIFICATION_TWO_ESTABLISHED_FACTORS_REQUIRED');
 const unbindPassword=await f.authorize(a,{action:'password.unbind'});assert.equal((await commit(a,unbindPassword)).data.error,'AUTH_INDEPENDENT_METHOD_REQUIRED');
 assert.equal((await f.store.read('xiongan:tester')).passwordBinding,undefined);
});
test('two rebind commits cannot consume same combined proof twice',async t=>{
 const f=await fixture();t.after(f.close);let c=f.client();await c.login();let p=await f.authorize(c,{action:'wallet.unbind'});assert.equal((await commit(c,p)).status,200);
 c=f.client();await c.call('bootstrap');await c.call('password',{username:'tester',password:OLD,account:f.signer.address,chainId:'1'});p=await f.authorize(c,{action:'wallet.initial'});const signature=await f.signer.signMessage(p.walletMessage);
 const results=await Promise.all([commit(c,p,{signature}),commit(c,p,{signature})]);assert.equal(results.filter(x=>x.status===200).length,1);assert.equal((await f.store.read('xiongan:tester')).revision,3);
});
test('rebind preserves explicit global disabled-wallet choice instead of reactivating another owned signer',async t=>{
 const other=Wallet.createRandom(),f=await fixture({extraWallets:[{account:other.address,chainId:'1'}],credential:{enabledMethods:['password'],walletBindings:{version:1,identities:[{account:other.address,chainId:'1'}]}}});t.after(f.close);
 const c=f.client();await c.call('bootstrap');assert.equal((await c.call('password',{username:'tester',password:OLD,account:f.signer.address,chainId:'1'})).status,200);
 const proof=await f.authorize(c,{action:'wallet.initial'});assert.equal((await commit(c,proof,{signature:await f.signer.signMessage(proof.walletMessage)})).status,200);
 assert.deepEqual((await f.store.read('xiongan:tester')).enabledMethods,['password']);
 const a=f.client();await a.call('bootstrap');assert.equal((await a.call('password',{username:'tester',password:OLD,account:f.signer.address,chainId:'1'})).status,200);
 const status=(await a.call('account')).data;assert.equal(status.methods.wallet.bound,true);assert.equal(status.methods.wallet.enabled,false);
 const b=f.client();await b.call('bootstrap');const selected={account:other.address,chainId:'1'},ch=(await b.call('challenge',{method:'wallet',...selected})).data;
 assert.equal((await b.call('proof',{...selected,id:ch.id,signature:await other.signMessage(ch.message)})).status,401);
});
