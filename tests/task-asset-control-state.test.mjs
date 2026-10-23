import test from 'node:test';
import assert from 'node:assert/strict';
import {assetControlPolicyKey,normalizeAssetControlTarget,normalizeAssetControlPatch,
  assetControlChangeDigest,readAssetControlPolicy,readCredentialAssetControlPolicy,
  assetControlValue,appendVerifiedAssetControlChange} from '../server/task-asset-control-state.mjs';
const scope={origin:'https://wallet.example.test',tenant:'tenant',username:'owner',
  account:'0x'+'1'.repeat(40),chainId:'560048',agentId:'agent:test'};
const all={kind:'asset',path:['all']},leaf={kind:'asset',path:['all','native','hoodi','eth']};
const allow={kind:'allow-agent'};
const empty=()=>readAssetControlPolicy(null,scope);
let serial=0;
function request(state,target,value,fieldRevision='0') {
  const n=++serial;return {schema:'8415-asset-control-change/1',scope:{...scope},
    expectedRevision:state.revision,patch:{target,value,expectedFieldRevision:fieldRevision},
    credentialRevision:0,changeId:String(n).padStart(43,'A'),nonce:String(n).padStart(43,'B'),
    issuedAt:1000+n,expiresAt:200000+n};
}
const save=(state,target,value,fieldRevision='0')=>appendVerifiedAssetControlChange(state,scope,
  request(state,target,value,fieldRevision),['password','verified-email'],10000+serial);
test('authoritative absence projects ON at all four asset levels and every operation without writes',()=>{
  const state=empty(),before=JSON.stringify(state);
  for(const target of [allow,all,{kind:'asset',path:['all','native']},
    {kind:'asset',path:['all','native','hoodi']},leaf,
    ...['wallet:native-transfer','wallet:erc20-transfer','erc8183:fund'].map(operation=>({kind:'operation',path:leaf.path,operation}))]) {
    assert.deepEqual({...assetControlValue(state,target),target:undefined},
      {target:undefined,value:true,source:'default',revision:'0',policyRevision:'0',executable:false});
  }
  assert.equal(JSON.stringify(state),before);assert.equal(state.entries.length,0);
});
test('an owner-saved false survives readback/restart and changes only its exact field',()=>{
  const state=save(empty(),leaf,false),restarted=readAssetControlPolicy(JSON.parse(JSON.stringify(state)),scope);
  assert.equal(assetControlValue(restarted,leaf).value,false);
  assert.equal(assetControlValue(restarted,leaf).source,'owner-saved');
  for(const target of [allow,all,{kind:'operation',path:leaf.path,operation:'wallet:native-transfer'}])
    assert.equal(assetControlValue(restarted,target).value,true);
});
test('ON saves are audited like OFF, with independent global and field revisions',()=>{
  let state=save(empty(),leaf,false);state=save(state,all,false);state=save(state,leaf,true,'1');
  assert.equal(state.revision,'3');assert.equal(assetControlValue(state,leaf).revision,'2');
  assert.equal(assetControlValue(state,all).revision,'1');assert.equal(state.changes.length,3);
  assert.ok(state.changes.every(x=>x.verifiedFactors.length===2));
});
test('stale global and stale corresponding-field revisions refuse atomic append',()=>{
  const prior=empty(),stale=request(prior,leaf,false),state=save(prior,all,false);
  assert.throws(()=>appendVerifiedAssetControlChange(state,scope,stale,['wallet','verified-email'],15000),/REVISION_CONFLICT/);
  assert.throws(()=>save(save(prior,leaf,false),leaf,true,'0'),/FIELD_REVISION_CONFLICT/);
  assert.equal(assetControlValue(state,leaf).value,true);
});
test('scope is exact across origin tenant username account chain and Agent',()=>{
  const state=save(empty(),leaf,false);
  for(const [key,value]of Object.entries({origin:'https://other.example.test',tenant:'other',username:'other',
    account:'0x'+'2'.repeat(40),chainId:'1',agentId:'agent:other'}))
    assert.throws(()=>readAssetControlPolicy(state,{...scope,[key]:value}));
});
test('all settings including ON require two independent established factor labels',()=>{
  for(const value of [true,false]) for(const factors of [[],['password'],['wallet','wallet'],['password','totp']])
    assert.throws(()=>appendVerifiedAssetControlChange(empty(),scope,request(empty(),allow,value),factors,15000),/TWO_FACTORS/);
});
test('request digest binds exact target value revision credential revision and lifetime',()=>{
  const r=request(empty(),leaf,false),original=assetControlChangeDigest(r);
  for(const mutation of [{patch:{...r.patch,value:true}},{patch:{...r.patch,target:all}},
    {expectedRevision:'1'},{credentialRevision:1},{nonce:'C'.repeat(43)},{expiresAt:r.expiresAt+1}])
    assert.notEqual(assetControlChangeDigest({...r,...mutation}),original);
});
test('tampered final entries audit events factor labels or digest are not defaulted',()=>{
  const state=save(empty(),leaf,false);
  for(const edit of [x=>x.entries[0].value=true,x=>x.changes[0].request.patch.value=true,
    x=>x.changes[0].verifiedFactors=['wallet','wallet'],x=>x.changes[0].changeDigest='0'.repeat(64),
    x=>x.revision='2',x=>x.changes=[]]) {
    const copy=JSON.parse(JSON.stringify(state));edit(copy);assert.throws(()=>readAssetControlPolicy(copy,scope));
  }
});
test('explicit null corrupt policy maps and accessor members never become default ON',()=>{
  const key=assetControlPolicyKey(scope);
  for(const credential of [undefined,{assetControlPolicies:null},{assetControlPolicies:{[key]:null}},
    {assetControlPolicies:{[key]:undefined}},{assetControlPolicies:{[key]:empty()}},{assetControlPolicies:[]}])
    assert.throws(()=>readCredentialAssetControlPolicy(credential,scope));
  let reads=0;const credential={};Object.defineProperty(credential,'assetControlPolicies',
    {enumerable:true,get(){reads++;return {};}});
  assert.throws(()=>readCredentialAssetControlPolicy(credential,scope));assert.equal(reads,0);
});
test('same authoritative credential member preserves unrelated state and scope choices',()=>{
  const state=save(empty(),leaf,false),key=assetControlPolicyKey(scope);
  const credential={revision:7,unrelated:{preserve:true},assetControlPolicies:{[key]:state}};
  const before=JSON.stringify(credential);
  assert.equal(assetControlValue(readCredentialAssetControlPolicy(credential,scope),leaf).value,false);
  assert.equal(readCredentialAssetControlPolicy(credential,{...scope,agentId:'agent:new'}).revision,'0');
  assert.equal(JSON.stringify(credential),before);
});
test('closed target and patch schema rejects coercion symbols getters and sparse paths without evaluating',()=>{
  for(const target of [{kind:'asset',path:[]},{kind:'asset',path:['all','all']},
    {kind:'operation',path:['all'],operation:'arbitrary'},{kind:'allow-agent',extra:true},
    {kind:'asset',path:['all',,'eth']}]) assert.throws(()=>normalizeAssetControlTarget(target));
  for(const value of [0,1,'ON',null])assert.throws(()=>normalizeAssetControlPatch({target:leaf,value,expectedFieldRevision:'0'}));
  let reads=0;const target={kind:'asset'};Object.defineProperty(target,'path',{enumerable:true,get(){reads++;return ['all'];}});
  assert.throws(()=>normalizeAssetControlTarget(target));assert.equal(reads,0);
  const symbol={kind:'allow-agent',[Symbol('x')]:true};assert.throws(()=>normalizeAssetControlTarget(symbol));
});
test('expired malformed and replayed change envelopes cannot append',()=>{
  const prior=empty(),r=request(prior,leaf,false);
  assert.throws(()=>appendVerifiedAssetControlChange(prior,scope,r,['wallet','verified-email'],r.expiresAt),/EXPIRED/);
  assert.throws(()=>assetControlChangeDigest({...r,expiresAt:r.issuedAt+300001}));
  const state=appendVerifiedAssetControlChange(prior,scope,r,['wallet','verified-email'],15000);
  assert.throws(()=>appendVerifiedAssetControlChange(state,scope,r,['wallet','verified-email'],15000));
});
test('returned values and audit snapshots are immutable across asynchronous callers',async()=>{
  const input=request(empty(),leaf,false),state=appendVerifiedAssetControlChange(empty(),scope,input,['wallet','verified-email'],15000);
  input.patch.value=true;await Promise.resolve();
  assert.equal(assetControlValue(state,leaf).value,false);
  assert.throws(()=>{state.entries[0].value=true;},TypeError);
  assert.throws(()=>{state.scope.agentId='other';},TypeError);
});
