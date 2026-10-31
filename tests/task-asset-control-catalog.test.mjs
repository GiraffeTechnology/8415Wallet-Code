import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeTaskPolicy} from '../src/agent/taskContract.ts';
import {readAssetControlPolicy,appendVerifiedAssetControlChange,assetControlPolicyKey} from '../server/task-asset-control-state.mjs';
import {canonicalAssetControlSubject,assetControlCatalogPath,createAssetControlCatalog,
 deriveTaskAssetControlBinding,assertTaskAssetControlAuthorization} from '../server/task-asset-control-catalog.mjs';
const scope={origin:'https://wallet.example.test',tenant:'tenant',username:'owner',
 account:'0x'+'1'.repeat(40),chainId:'560048',agentId:'agent:test'};
const h=c=>'0x'+c.repeat(64),recipient='0x'+'2'.repeat(40),contract='0x'+'3'.repeat(40);
function grant(kind='native-transfer') {
 const operation={kind,actor:scope.account,chainId:scope.chainId,recipient,
 ...(kind==='native-transfer'?{valueWei:'1'}:kind==='erc20-transfer'?{contract,amount:'1'}:
 kind==='erc721-transfer'?{contract,tokenId:'0'}:{contract,tokenId:'0',amount:'2'})};
 const task=freezeTaskPolicy({schema:'8415-agent-task/1',taskId:'task-1',tenant:scope.tenant,origin:scope.origin,
 chainId:scope.chainId,actor:scope.account,expiresAt:'1800000000',fees:{perOperationWei:'100',totalWei:'1000'},
 intent:{kind:'exact-operation',operation}});
 return {principal:JSON.stringify(Object.values(scope).slice(0,5)),task,
 executor:{digest:h('a'),identity:{agentId:scope.agentId}}};
}
let serial=0;
function saved(changes) {
 let state=readAssetControlPolicy(null,scope);
 for(const[target,value]of changes) {
   serial++;const previous=state.entries.find(e=>JSON.stringify(e.target)===JSON.stringify(target));
   const request={schema:'8415-asset-control-change/1',scope,expectedRevision:state.revision,
    patch:{target,value,expectedFieldRevision:previous?.revision??'0'},credentialRevision:0,
    changeId:String(serial).padStart(43,'A'),nonce:String(serial).padStart(43,'B'),issuedAt:1000,expiresAt:200000};
   state=appendVerifiedAssetControlChange(state,scope,request,['wallet','verified-email'],2000+serial);
 }
 return {assetControlPolicies:{[assetControlPolicyKey(scope)]:state}};
}
const native={chainId:'560048',standard:'native',contract:null,tokenId:null};
test('canonical identities yield stable distinct four-level IDs for chains standards contracts and token IDs',()=>{
 const path=assetControlCatalogPath(native);assert.equal(path.length,4);assert.equal(path[0],'all');
 for(const s of [{...native,chainId:'1'},{...native,standard:'ERC-20',contract},
 {chainId:'560048',standard:'ERC-721',contract,tokenId:'0'},
 {chainId:'560048',standard:'ERC-721',contract,tokenId:'1'}])assert.notEqual(assetControlCatalogPath(s)[3],path[3]);
 assert.deepEqual(assetControlCatalogPath(JSON.parse(JSON.stringify(native))),path);
});
test('native token-contract and token-ID shape cannot alias a canonical identity',()=>{
 for(const value of [{...native,contract},{...native,tokenId:'0'},
 {chainId:'560048',standard:'ERC-20',contract,tokenId:'0'},
 {chainId:'560048',standard:'ERC-721',contract:contract.toUpperCase(),tokenId:'0'},
 {chainId:'560048',standard:'ERC-721',contract,tokenId:'01'}])assert.throws(()=>canonicalAssetControlSubject(value));
});
test('catalog binds scope chain canonical order and duplicate subjects without claiming ownership',()=>{
 const token={chainId:'560048',standard:'ERC-20',contract,tokenId:null};
 const one=createAssetControlCatalog(scope,[native,token]),two=createAssetControlCatalog(scope,[token,native]);
 assert.equal(one.digest,two.digest);assert.equal(one.ownershipVerified,false);assert.equal(one.grantsAuthority,false);
 assert.throws(()=>createAssetControlCatalog(scope,[native,native]));
 assert.throws(()=>createAssetControlCatalog(scope,[{...native,chainId:'1'}]));
 let reads=0;const subjects=[];Object.defineProperty(subjects,'0',{enumerable:true,get(){reads++;return native;}});subjects.length=1;
 assert.throws(()=>createAssetControlCatalog(scope,subjects));assert.equal(reads,0);
});
test('derive actual supported operation asset from immutable task rather than UI-supplied target',()=>{
 for(const kind of ['native-transfer','erc20-transfer','erc721-transfer','erc1155-transfer']) {
  const g=grant(kind),binding=deriveTaskAssetControlBinding(g);
  assert.equal(binding.operation,'wallet:'+kind);assert.equal(binding.taskDigest,g.task.digest);
  assert.equal(binding.subject.chainId,scope.chainId);
  assert.equal(binding.subject.contract,kind==='native-transfer'?null:contract);
 }
 const g=grant();g.task={...g.task,digest:h('f')};assert.throws(()=>deriveTaskAssetControlBinding(g));
});
test('initial absent policy is unlocked NOT_EVALUATED and never a grant or proof',()=>{
 const g=grant();assert.deepEqual(assertTaskAssetControlAuthorization({},g),
 {revision:'0',state:'NOT_EVALUATED',reason:'default-on',grantsAuthority:false});
});
test('saved overall OFF blocks even when all lower asset controls default ON',()=>{
 const g=grant(),credential=saved([[{kind:'allow-agent'},false]]);
 assert.throws(()=>assertTaskAssetControlAuthorization(credential,g),/AGENT_DISABLED/);
});
test('asset ancestor ON blankets saved leaf OFF; disabling each ancestor exposes leaf OFF',()=>{
 const g=grant(),path=deriveTaskAssetControlBinding(g).path,leaf={kind:'asset',path};
 const blanket=saved([[leaf,false]]);
 assert.equal(assertTaskAssetControlAuthorization(blanket,g).state,'APPLIED_SAVED_SETTINGS');
 const denies=saved([...[1,2,3].map(n=>[{kind:'asset',path:path.slice(0,n)},false]),[leaf,false]]);
 assert.throws(()=>assertTaskAssetControlAuthorization(denies,g),/ASSET_DISABLED/);
});
test('operation permission inherits nearest explicit parent setting and child override changes only that operation',()=>{
 const g=grant(),path=deriveTaskAssetControlBinding(g).path,operation='wallet:native-transfer';
 const parent={kind:'operation',path:path.slice(0,2),operation},leaf={kind:'operation',path,operation};
 assert.throws(()=>assertTaskAssetControlAuthorization(saved([[parent,false]]),g),/OPERATION_DISABLED/);
 assert.equal(assertTaskAssetControlAuthorization(saved([[parent,false],[leaf,true]]),g).operation,operation);
 const unrelated={kind:'operation',path,operation:'wallet:erc20-transfer'};
 assert.equal(assertTaskAssetControlAuthorization(saved([[unrelated,false]]),g).operation,operation);
});
test('principal mismatch corrupt saved policy and actual asset context are never replaced by requested path',()=>{
 const g=grant(),credential=saved([[{kind:'asset',path:['all']},false]]);
 const mismatch={...g,principal:JSON.stringify([scope.origin,scope.tenant,scope.username,recipient,scope.chainId])};
 assert.throws(()=>assertTaskAssetControlAuthorization(credential,mismatch));
 const malformed={assetControlPolicies:{[assetControlPolicyKey(scope)]:null}};
 assert.throws(()=>assertTaskAssetControlAuthorization(malformed,g));
 const other=grant('erc721-transfer'),binding=deriveTaskAssetControlBinding(other);
 assert.notEqual(binding.path[3],deriveTaskAssetControlBinding(g).path[3]);
});
test('unrelated native operation setting cannot globally stop retained controller work',()=>{
 const g=grant(),operation={kind:'create-account',actor:scope.account,chainId:scope.chainId,
  controller:{contract,runtimeCodeHash:h('b')}};
 g.task=freezeTaskPolicy({...g.task.policy,intent:{kind:'exact-operation',operation}});
 const credential=saved([[{kind:'operation',path:['all'],operation:'wallet:native-transfer'},false]]);
 const view=assertTaskAssetControlAuthorization(credential,g);
 assert.equal(view.state,'NOT_EVALUATED');assert.equal(view.reason,'unmapped-control-default-on');
 assert.throws(()=>assertTaskAssetControlAuthorization(saved([[{kind:'allow-agent'},false]]),g),/AGENT_DISABLED/);
});
test('unmapped retained NFT work keeps an actual ancestor blanket but cannot bypass a potentially effective denial',()=>{
 const g=grant(),operation={kind:'complete',actor:scope.account,chainId:scope.chainId,
  controller:{contract:'0x'+'4'.repeat(40),runtimeCodeHash:h('b')},token:{contract,runtimeCodeHash:h('c')},
  sequenceId:h('d'),legId:h('e'),expectedRevision:'0'};
 g.task=freezeTaskPolicy({...g.task.policy,intent:{kind:'exact-operation',operation}});
 const root={kind:'asset',path:['all']},category={kind:'asset',path:['all','category:nonfungible']};
 assert.equal(assertTaskAssetControlAuthorization(saved([[root,false]]),g).state,'NOT_EVALUATED');
 assert.throws(()=>assertTaskAssetControlAuthorization(saved([[root,false],[category,false]]),g),/OPERATION_BINDING_UNAVAILABLE/);
});
