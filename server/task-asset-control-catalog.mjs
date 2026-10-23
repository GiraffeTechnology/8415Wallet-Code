/** Server-owned deterministic asset identities and saved-policy evaluation.
 * Never accept an HTTP/UI asset path as the actual executed asset. The caller
 * first validates the durable grant/child, contract role, wire, balances and nonce.
 * This module derives identities from that grant and supplies no signer or grant.
 */
import { createHash } from 'node:crypto';
import { freezeTaskPolicy } from '../src/agent/taskContract.ts';
import { readTaskGrantVerificationPolicy } from './task-verification-execution.mjs';
import { readCredentialAssetControlPolicy, assetControlValue, AssetControlStateError } from './task-asset-control-state.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const check=(ok,code='ASSET_CONTROL_ASSET_BINDING_REFUSED')=>{if(!ok)throw new AssetControlStateError(code,403);};
const freeze=value=>{for(const v of Object.values(value))if(v&&typeof v==='object')freeze(v);return Object.freeze(value);};
const uint=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<1n<<256n;
const addr=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/.test(x)&&!/^0x0+$/.test(x);
function exact(value,keys) {
  check(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const d=Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&Object.hasOwn(d[k],'value')&&d[k].enumerable));
}
export function canonicalAssetControlSubject(input) {
  exact(input,['chainId','standard','contract','tokenId']);
  check(uint(input.chainId)&&input.chainId!=='0'&&['native','ERC-20','ERC-721','ERC-1155'].includes(input.standard));
  check(input.standard==='native'?input.contract===null:addr(input.contract));
  check(['native','ERC-20'].includes(input.standard)?input.tokenId===null:uint(input.tokenId));
  return freeze({chainId:input.chainId,standard:input.standard,contract:input.contract,tokenId:input.tokenId});
}
/** Identifiers are stable one-way functions of canonical chain/asset identity.
 * They are not wallet ownership evidence. A private authenticated inventory
 * reader must supply its actual observed subjects to the catalog builder.
 */
export function assetControlCatalogPath(input) {
  const subject=canonicalAssetControlSubject(input);
  return freeze(['all', ['native','ERC-20'].includes(subject.standard)?'category:fungible':'category:nonfungible',
    'subcategory:'+hash({chainId:subject.chainId,standard:subject.standard}),
    'asset:'+hash(subject)]);
}
export function createAssetControlCatalog(input,subjects) {
  // Reuse the authoritative scope codec; never accept an alternate body scope.
  const initial=readCredentialAssetControlPolicy(null,input);
  check(Array.isArray(subjects)&&subjects.length<=10000);
  const d=Object.getOwnPropertyDescriptors(subjects);
  check(Reflect.ownKeys(d).length===subjects.length+1);
  const entries=Array.from({length:subjects.length},(_,i)=>{
    check(Object.hasOwn(d[String(i)],'value'));
    const subject=canonicalAssetControlSubject(d[String(i)].value);
    check(subject.chainId===initial.scope.chainId);
    return {subject,path:assetControlCatalogPath(subject)};
  }).sort((a,b)=>a.path[3]<b.path[3]?-1:a.path[3]>b.path[3]?1:0);
  check(new Set(entries.map(e=>e.path[3])).size===entries.length);
  const value={schema:'8415-asset-control-catalog/1',scopeDigest:hash(initial.scope),entries};
  return freeze({...value,digest:hash(value),ownershipVerified:false,grantsAuthority:false});
}
/** Existing task execution already freezes/validates the durable task. We repeat
 * the immutable digest check here when deriving a supported asset identity.
 * Mint/controller/receipt operations are deliberately not mislabeled ERC8183.
 */
export function deriveTaskAssetControlBinding(grant) {
  readTaskGrantVerificationPolicy(null,grant);
  const intent=grant.task.policy.intent;
  if(!['exact-operation','nft-sale'].includes(intent?.kind))return null;
  const task=freezeTaskPolicy(grant.task.policy);check(task.digest===grant.task.digest);
  let subject,operation;
  if(intent.kind==='nft-sale') {
    subject={chainId:task.policy.chainId,standard:intent.standard,contract:intent.contract,tokenId:intent.tokenId};
    operation=intent.standard==='ERC-721'?'wallet:erc721-transfer':'wallet:erc1155-transfer';
  } else {
    const op=task.policy.intent.operation;
    const standards={'native-transfer':'native','erc20-transfer':'ERC-20','erc721-transfer':'ERC-721','erc1155-transfer':'ERC-1155'};
    if(!Object.hasOwn(standards,op.kind))return null;
    subject={chainId:op.chainId,standard:standards[op.kind],contract:op.kind==='native-transfer'?null:op.contract,
      tokenId:['erc721-transfer','erc1155-transfer'].includes(op.kind)?op.tokenId:null};
    operation='wallet:'+op.kind;
  }
  subject=canonicalAssetControlSubject(subject);
  return freeze({subject,path:assetControlCatalogPath(subject),operation,taskDigest:task.digest,
    executorDigest:grant.executor.digest});
}
function scopeForGrant(credential,grant) {
  readTaskGrantVerificationPolicy(credential,grant); // exact principal/task/executor binding
  const p=JSON.parse(grant.principal);
  return {origin:p[0],tenant:p[1],username:p[2],account:p[3],chainId:p[4],agentId:grant.executor.identity.agentId};
}
/** Invoke only inside the SAME credential/grant signing/dispatch boundary.
 * Never call on submitted/UNKNOWN read-only reconciliation. Default ON is
 * unlocked/NOT_EVALUATED, not invented asset ownership or signature verification.
 */
export function assertTaskAssetControlAuthorization(credential,grant) {
  const state=readCredentialAssetControlPolicy(credential,scopeForGrant(credential,grant));
  const allow=assetControlValue(state,{kind:'allow-agent'});
  check(allow.value,'ASSET_CONTROL_AGENT_DISABLED');
  if(state.revision==='0')return freeze({revision:'0',state:'NOT_EVALUATED',reason:'default-on',grantsAuthority:false});
  if(!state.entries.some(e=>e.target.kind!=='allow-agent'))
    return freeze({revision:state.revision,state:'APPLIED_SAVED_SETTINGS',reason:'allow-agent-only',grantsAuthority:false});
  const binding=deriveTaskAssetControlBinding(grant);
  if(binding===null) {
    const intent=grant.task.policy.intent,kind=intent?.operation?.kind;
    // Retained controller/mint/receipt work is not an ERC8183 transfer. Until
    // its own exact mapping is operational, unrelated saved native settings
    // cannot turn its initial unlocked control into a whole-wallet stop.
    // A saved overall OFF was already enforced above. Never bypass a potentially
    // effective asset denial when no actual asset occurrence can be resolved.
    const root=assetControlValue(state,{kind:'asset',path:['all']});
    const nft=['deposit','standalone-withdraw','complete','return-hop','artfi-test-series-mint','artfi-test-nft721-mint'].includes(kind)||intent?.kind==='artfi-receipt';
    const category=nft?'category:nonfungible':null;
    const blanket=root.value||(category!==null&&assetControlValue(state,{kind:'asset',path:['all',category]}).value);
    check(kind==='create-account'||blanket,'ASSET_CONTROL_OPERATION_BINDING_UNAVAILABLE');
    return freeze({revision:state.revision,state:'NOT_EVALUATED',reason:'unmapped-control-default-on',grantsAuthority:false});
  }
  let assetAllowed=false,operationAllowed=true,assetSource=null,operationSource=null;
  for(let i=1;i<=4;i++) {
    const path=binding.path.slice(0,i),asset=assetControlValue(state,{kind:'asset',path});
    if(!assetAllowed&&asset.value){assetAllowed=true;assetSource=path.at(-1);}
    const op=assetControlValue(state,{kind:'operation',path,operation:binding.operation});
    if(op.source==='owner-saved'){operationAllowed=op.value;operationSource=path.at(-1);}
  }
  check(assetAllowed,'ASSET_CONTROL_ASSET_DISABLED');
  check(operationAllowed,'ASSET_CONTROL_OPERATION_DISABLED');
  return freeze({revision:state.revision,state:'APPLIED_SAVED_SETTINGS',reason:'saved-scope',
    assetSource,operationSource,asset:binding.subject,operation:binding.operation,grantsAuthority:false});
}
