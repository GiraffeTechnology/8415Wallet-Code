/** Synthetic owner factors on isolated Linux only; no deployed identity or chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { createHash } from 'node:crypto';
import { MemoryCredentialStore } from '../server/store.mjs';
import { createTaskVerificationPolicyService } from '../server/task-verification-policy.mjs';
import { ownerChangeOriginBinding } from '../server/owner-change-origin.mjs';
import { createAssetControlPolicyService } from '../server/task-asset-control-policy.mjs';
import { readAssetControlPolicy, assetControlValue } from '../server/task-asset-control-state.mjs';
import { originContinuationKey } from '../server/origin-continuation.mjs';
const wallet=new Wallet('0x'+'1'.repeat(64)),transport='https://wallet.example.invalid',origin=transport+':9446',tenant='fixture';
const selected={origin,tenant,username:'alice',account:wallet.address.toLowerCase(),chainId:'560048',agentId:'fixture:agent'};
const continuation={reference:originContinuationKey({tenant,transportOrigin:transport}),digest:'a'.repeat(64),revision:'1'};
function fixture(mapped=true){
 let mapping=structuredClone(continuation);const deliveries=[];
 const session={id:'synthetic-session',username:'alice',account:wallet.address,chainId:'560048',revision:1,kind:'wallet'};
 const context=()=>({schema:'8415wallet-authorization-context/1',tenant,transportOrigin:mapped?transport:origin,
   authorizationOrigin:origin,username:session.username,account:session.account,chainId:session.chainId,continuation:mapped?mapping:null});
 const store=new MemoryCredentialStore({'fixture:alice':{revision:1,registration:{version:1,email:'alice@example.invalid',verifiedAt:1}}});
 const options={origin,tenant,agentId:selected.agentId,store,users:new Map([['alice',{wallets:[{account:wallet.address,chainId:'560048'}]}]]),
  assertSession:s=>assert.equal(s,session),credentialFor:()=>store.read('fixture:alice'),passwordFor:()=>undefined,
  methodStates:()=>({wallet:{enabled:true}}),directory:{checkCredential(){}},sendOtp:async d=>deliveries.push(d),now:()=>1800000000000,
  ownerAuthorizationContext:context};
 const service=createTaskVerificationPolicyService(options),assetService=createAssetControlPolicyService(options);
 const prepare=(mode='OFF',expectedRevision='0',protocol=mapped?'8415-task-policy-change-wire/2':'8415-task-policy-change-wire/1')=>service.prepare(session,{mode,expectedRevision,identityMethod:'wallet',protocol});
 async function save(mode='OFF',rev='0'){
  const p=await prepare(mode,rev);await service.verify(session,{changeId:p.request.changeId,changeDigest:p.changeDigest,signature:await wallet.signMessage(p.message)});
  const result=await service.confirm(session,{changeId:p.request.changeId,changeDigest:p.changeDigest,code:deliveries.at(-1).code});return {p,result};
 }
 return {service,assetService,session,context,store,prepare,save,deliveries,changeMapping:()=>{mapping={...mapping,revision:'2'};}};
}
test('continued save signs current transport and exact mapping while preserving historical scope',async()=>{
 const f=fixture(),p=await f.prepare();assert.equal(p.changeProtocol,'8415-task-policy-change-wire/2');
 assert.equal(p.request.schema,'8415-task-human-verification-change/3');assert.deepEqual(p.request.scope,selected);
 assert.deepEqual(p.request.originBinding,ownerChangeOriginBinding(f.context(),selected));
 assert.equal(p.changeDigest,createHash('sha256').update(JSON.stringify(p.request)).digest('hex'));
 assert.ok(p.message.includes('Transport binding: '+JSON.stringify(p.request.originBinding)));
 const changed=structuredClone(p.request);changed.originBinding.continuation.revision='2';
 assert.notEqual(createHash('sha256').update(JSON.stringify(changed)).digest('hex'),p.changeDigest);
 assert.equal(f.deliveries.length,0);
});
test('mapped save refuses legacy protocol and caller-supplied binding before factors',async()=>{
 const f=fixture();await assert.rejects(f.prepare('OFF','0','8415-task-policy-change-wire/1'),/INPUT_REFUSED/);
 await assert.rejects(f.service.prepare(f.session,{mode:'ON',expectedRevision:'0',identityMethod:'wallet'}),/ORIGIN_PROTOCOL_REQUIRED/);
 await assert.rejects(f.service.prepare(f.session,{mode:'OFF',expectedRevision:'0',identityMethod:'wallet',protocol:'8415-task-policy-change-wire/2',originBinding:{}}),/INPUT_REFUSED/);
 assert.equal(f.deliveries.length,0);assert.equal((await f.service.status(f.session)).revision,'0');
});
test('mapping change invalidates prepared identity proof without email or persistence',async()=>{
 const f=fixture(),p=await f.prepare();f.changeMapping();
 await assert.rejects(f.service.verify(f.session,{changeId:p.request.changeId,changeDigest:p.changeDigest,signature:await wallet.signMessage(p.message)}),/CHANGE_EXPIRED/);
 assert.equal(f.deliveries.length,0);assert.equal((await f.store.read('fixture:alice')).taskVerificationPolicies,undefined);
});
test('ON and OFF both require exact factors and append to same old realm without changing prior audit',async()=>{
 const f=fixture(),first=await f.save('OFF'),snapshot=structuredClone(first.result.changes[0]);
 const second=await f.save('ON','1');assert.equal(second.result.revision,'2');assert.equal(second.result.scope.origin,origin);
 assert.deepEqual(second.result.changes[0],snapshot);assert.deepEqual(second.result.changes[1].verifiedFactors,['wallet','verified-email']);
 assert.equal(second.result.changes[1].changeDigest,second.p.changeDigest);assert.equal(second.result.grantsAuthority,false);
 assert.equal(f.deliveries.length,2);
});
test('unmapped old transport keeps exact previous request shape and protocol',async()=>{
 const f=fixture(false),p=await f.prepare();assert.equal(p.changeProtocol,'8415-task-policy-change-wire/1');
 assert.equal(p.request.schema,'8415-task-human-verification-change/2');assert.equal(Object.hasOwn(p.request,'originBinding'),false);
 assert.equal(p.message.includes('Transport binding:'),false);
});
test('exact mapping binding refuses wrong identity, origin, reference and accessor fields',()=>{
 const f=fixture(),c=f.context();for(const bad of [{...c,username:'bob'},{...c,authorizationOrigin:transport},
  {...c,continuation:{...c.continuation,reference:'@origin-continuation:'+'b'.repeat(64)}},
  {...c,continuation:{...c.continuation,revision:'01'}},{...c,continuation:null},{...c,extra:true}])
   assert.throws(()=>ownerChangeOriginBinding(bad,selected),/BINDING_REFUSED/);
 let reads=0;const bad={...c};Object.defineProperty(bad,'username',{enumerable:true,get(){reads++;return 'alice';}});
 assert.throws(()=>ownerChangeOriginBinding(bad,selected),/BINDING_REFUSED/);assert.equal(reads,0);
});

test('continued asset-control saves retain precise field/audit and bind mapping in persisted request',async()=>{
 const f=fixture(),api=f.assetService,target={kind:'allow-agent'},before=await f.store.read('fixture:alice');
 const prepare=value=>api.prepare(f.session,{protocol:'8415-asset-control-change-wire/2',expectedRevision:value?'1':'0',identityMethod:'wallet',
  patch:{target,value,expectedFieldRevision:value?'1':'0'}});
 await assert.rejects(api.prepare(f.session,{expectedRevision:'0',identityMethod:'wallet',patch:{target,value:false,expectedFieldRevision:'0'}}),/ORIGIN_PROTOCOL_REQUIRED/);
 const save=async value=>{const p=await prepare(value);assert.equal(p.request.schema,'8415-asset-control-change/2');
   assert.equal(p.request.originBinding.continuation.digest,continuation.digest);
   assert.ok(p.message.includes('Transport binding: '+JSON.stringify(p.request.originBinding)));
   await api.verify(f.session,{changeId:p.request.changeId,changeDigest:p.changeDigest,signature:await wallet.signMessage(p.message)});
   return api.confirm(f.session,{changeId:p.request.changeId,changeDigest:p.changeDigest,code:f.deliveries.at(-1).code});};
 const state=v=>Object.fromEntries(['schema','scope','revision','entries','changes'].map(k=>[k,v[k]]));
 const off=state(await save(false)),old=structuredClone(off.changes[0]);assert.equal(assetControlValue(off,target).value,false);
 const on=state(await save(true));assert.equal(assetControlValue(on,target).value,true);assert.deepEqual(on.changes[0],old);
 assert.deepEqual(readAssetControlPolicy(on,selected),on);assert.equal(on.scope.origin,origin);
 assert.equal((await f.store.read('fixture:alice')).revision,before.revision);
 const damaged=structuredClone(on);damaged.changes[1].request.originBinding.continuation.digest='b'.repeat(64);
 assert.throws(()=>readAssetControlPolicy(damaged,selected));
});
test('asset-control mapping revision change refuses identity proof without changing default or emitting OTP',async()=>{
 const f=fixture(),p=await f.assetService.prepare(f.session,{protocol:'8415-asset-control-change-wire/2',expectedRevision:'0',identityMethod:'wallet',
  patch:{target:{kind:'allow-agent'},value:false,expectedFieldRevision:'0'}});f.changeMapping();
 await assert.rejects(f.assetService.verify(f.session,{changeId:p.request.changeId,changeDigest:p.changeDigest,signature:await wallet.signMessage(p.message)}),/CHANGE_EXPIRED/);
 assert.equal(f.deliveries.length,0);assert.equal((await f.assetService.status(f.session)).revision,'0');
});
