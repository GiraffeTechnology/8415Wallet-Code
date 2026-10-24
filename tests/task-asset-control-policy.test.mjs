import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { hashPassword } from '../server/crypto.mjs';
import { createAssetControlPolicyService } from '../server/task-asset-control-policy.mjs';
import { assetControlValue } from '../server/task-asset-control-state.mjs';
// Synthetic key is a closed test fixture only; no deployed account or signer.
const fixtureWallet=new Wallet('0x'+'1'.repeat(64));
const target={kind:'asset',path:['all','native','hoodi','eth']};
async function fixture(passwordHash=null) {
  let clock=1700000000000,record={revision:0,registration:{version:1,email:'owner@example.test',verifiedAt:1},unrelated:{keep:true}};
  let writes=0;const mails=[];let gate=Promise.resolve();
  const session={id:'session-one',username:'owner',account:fixtureWallet.address,chainId:'560048',revision:0,kind:'wallet',active:true};
  const clone=x=>structuredClone(x);
  const store={
    async readMany(keys){return Object.fromEntries(keys.map(k=>[k,clone(record)]));},
    async withReadGate(keys,callback){return callback(await this.readMany(keys));},
    transactionMany(keys,callback) {
      const run=gate.then(async()=>{const next=await callback(await store.readMany(keys));record=clone(next[keys[0]]);writes++;});
      gate=run.catch(()=>{});return run;
    }
  };
  const assertSession=s=>{if(!s.active)throw Error('SESSION_REVOKED');};
  const users=new Map([['owner',{wallets:[{account:fixtureWallet.address,chainId:'560048'}]}]]);
  const service=()=>createAssetControlPolicyService({origin:'https://wallet.example.test',tenant:'tenant',agentId:'agent:test',
    store,users,assertSession,credentialFor:async s=>{assertSession(s);return clone(record);},
    passwordFor:()=>passwordHash,methodStates:()=>({wallet:{enabled:true},password:{enabled:passwordHash!==null}}),
    directory:{checkCredential:()=>{}},sendOtp:async mail=>{mails.push(mail);},now:()=>clock});
  const api=service();
  async function prepare(value=false,revision='0',fieldRevision='0',s=session) {
    return api.prepare(s,{expectedRevision:revision,identityMethod:'wallet',patch:{target,value,expectedFieldRevision:fieldRevision}});
  }
  async function identity(change,s=session) {
    const signature=await fixtureWallet.signMessage(change.message);
    return api.verify(s,{changeId:change.request.changeId,changeDigest:change.changeDigest,signature});
  }
  async function confirm(change,s=session,code=mails.at(-1)?.code) {
    return api.confirm(s,{changeId:change.request.changeId,changeDigest:change.changeDigest,code});
  }
  return {api,session,store,mails,prepare,identity,confirm,restart:service,
    record:()=>clone(record),writes:()=>writes,setRecord:value=>{record=clone(value);},
    advance:ms=>{clock+=ms;}};
}
test('status uses ON defaults and no write before or after constructing/restarting service',async()=>{
  const f=await fixture(),before=f.record();const first=await f.api.status(f.session),second=await f.restart().status(f.session);
  assert.equal(first.defaultValue,true);assert.equal(first.revision,'0');assert.deepEqual(first.entries,[]);
  assert.equal(second.revision,'0');assert.equal(f.writes(),0);assert.deepEqual(f.record(),before);
});
test('a normal owner session alone cannot save either ON or OFF',async()=>{
  for(const value of [true,false]) {
    const f=await fixture(),p=await f.prepare(value);
    await assert.rejects(f.confirm(p),/POLICY_REFUSED|FACTOR_REFUSED/);
    await assert.rejects(f.api.enable(f.session,{expectedRevision:'0'}),/OWNER_CHANGE_REQUIRED/);
    assert.equal(f.writes(),0);
  }
});
test('exact wallet proof plus established email saves only corresponding field and survives restart',async()=>{
  const f=await fixture(),p=await f.prepare(false);await f.identity(p);
  assert.equal(f.mails[0].purpose,'asset-control-policy-off');assert.equal(f.writes(),0);
  const saved=await f.confirm(p);assert.equal(saved.revision,'1');assert.equal(f.writes(),1);
  const restart=await f.restart().status(f.session);
  const state={schema:restart.schema,scope:restart.scope,revision:restart.revision,entries:restart.entries,changes:restart.changes};
  assert.equal(assetControlValue(state,target).value,false);
  assert.equal(assetControlValue(state,{kind:'allow-agent'}).value,true);
  assert.deepEqual(f.record().unrelated,{keep:true});assert.equal(f.record().revision,0);
});
test('saved ON also requires a new exact identity proof and email, without resetting another field',async()=>{
  const f=await fixture(),off=await f.prepare(false);await f.identity(off);await f.confirm(off);
  const on=await f.prepare(true,'1','1');assert.notEqual(on.changeDigest,off.changeDigest);
  await f.identity(on);assert.equal(f.mails.at(-1).purpose,'asset-control-policy-on');
  const saved=await f.confirm(on);assert.equal(saved.revision,'2');assert.equal(saved.entries[0].value,true);
  assert.equal(saved.entries[0].revision,'2');assert.equal(f.writes(),2);
});
test('target or value substitution signature, fake email and replay refuse without changing saved state',async()=>{
  const f=await fixture(),p=await f.prepare(false);
  const signature=await fixtureWallet.signMessage(p.message.replace('Exact value: false','Exact value: true'));
  await assert.rejects(f.api.verify(f.session,{changeId:p.request.changeId,changeDigest:p.changeDigest,signature}),/FACTOR_REFUSED/);
  assert.equal(f.writes(),0);
  const q=await f.prepare(false);await f.identity(q);
  const actual=f.mails.at(-1).code,fake=actual==='00000000'?'99999999':'00000000';
  await assert.rejects(f.confirm(q,f.session,fake),/FACTOR_REFUSED/);assert.equal(f.writes(),0);
  await f.confirm(q);await assert.rejects(f.confirm(q),/CHANGE_EXPIRED/);assert.equal(f.writes(),1);
});
test('cancel logout expiry account chain and Agent scope cannot reuse an in-flight change',async()=>{
  for(const action of ['cancel','logout','expiry','account','chain']) {
    const f=await fixture(),p=await f.prepare(false);await f.identity(p);
    if(action==='cancel')f.api.cancel(f.session);
    if(action==='logout')f.session.active=false;
    if(action==='expiry')f.advance(300000);
    if(action==='account')f.session.account='0x'+'2'.repeat(40);
    if(action==='chain')f.session.chainId='1';
    await assert.rejects(f.confirm(p));assert.equal(f.writes(),0);
  }
});
test('factor binding and credential revision changes abort before persistence',async()=>{
  for(const change of ['email','revision']) {
    const f=await fixture(),p=await f.prepare(false);await f.identity(p);const record=f.record();
    if(change==='email')record.registration.email='other@example.test';else record.revision=1;
    f.setRecord(record);await assert.rejects(f.confirm(p));assert.equal(f.writes(),0);
  }
});
test('two completed factor ceremonies from same prior revision serialize to one save',async()=>{
  const f=await fixture(),s2={...f.session,id:'session-two'};
  const p=await f.prepare(false),q=await f.prepare(true,'0','0',s2);
  await f.identity(p);const code1=f.mails.at(-1).code;await f.identity(q,s2);const code2=f.mails.at(-1).code;
  const result=await Promise.allSettled([f.confirm(p,f.session,code1),f.confirm(q,s2,code2)]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(result.filter(x=>x.status==='rejected').length,1);
  assert.equal(f.writes(),1);
});
test('robot principals and body-supplied scope or unknown change fields cannot save',async()=>{
  const f=await fixture();for(const kind of ['agent','robot','recovery']) {
    await assert.rejects(f.api.status({...f.session,kind}),/OWNER_REQUIRED/);
    await assert.rejects(f.prepare(false,'0','0',{...f.session,kind}),/OWNER_REQUIRED/);
  }
  await assert.rejects(f.api.prepare(f.session,{expectedRevision:'0',identityMethod:'wallet',patch:{target,value:false,expectedFieldRevision:'0'},agentId:'other'}));
  assert.equal(f.writes(),0);
});
test('established password proof is independent from email and saves no factor secrets',async()=>{
  const password='test-owner-only-passphrase',f=await fixture(await hashPassword(password));
  const p=await f.api.prepare(f.session,{expectedRevision:'0',identityMethod:'password',patch:{target,value:false,expectedFieldRevision:'0'}});
  assert.equal(p.message,undefined);
  await f.api.verify(f.session,{changeId:p.request.changeId,changeDigest:p.changeDigest,password});
  assert.equal(f.writes(),0);assert.equal(f.mails.length,1);
  const saved=await f.confirm(p);assert.equal(saved.entries[0].value,false);
  const serialized=JSON.stringify(f.record());assert.ok(!serialized.includes(password));
  assert.ok(!serialized.includes('codeHash'));assert.ok(!serialized.includes(f.mails[0].code));
});
test('missing previously verified email refuses change, not a reason to write defaults',async()=>{
  const f=await fixture(),record=f.record();delete record.registration;f.setRecord(record);
  await assert.rejects(f.prepare(false),/TWO_ESTABLISHED_FACTORS_REQUIRED/);
  assert.equal(f.writes(),0);assert.equal((await f.api.status(f.session)).defaultValue,true);
});
test('corrupt explicit saved state fails rather than returning default ON',async()=>{
  const f=await fixture(),record=f.record();record.assetControlPolicies={[f.api.keyFor(f.session)]:null};f.setRecord(record);
  await assert.rejects(f.api.status(f.session),/STATE_REFUSED/);
  await assert.rejects(f.prepare(false),/STATE_REFUSED/);assert.equal(f.writes(),0);
});
