import { readOwnerChangeOriginBinding } from './owner-change-origin.mjs';
/** Authoritative asset-control state codec. No signer, route or approval issuer.
 * Initial ON values are projections, never writes. Only verified owner changes
 * are appended by the human-owned service under the existing credential lock.
 * This module alone does not make an asset control operational.
 */
import { createHash } from 'node:crypto';
import { scope, revision } from './task-verification-state.mjs';
export const ASSET_CONTROL_SCHEMA = '8415-asset-control-state/1';
export const ASSET_CONTROL_OPERATIONS = Object.freeze([
  'erc8183:createJob','erc8183:setProvider','erc8183:setBudget','erc8183:fund',
  'erc8183:submit','erc8183:complete','erc8183:reject','erc8183:claimRefund',
  'wallet:native-transfer','wallet:erc20-transfer','wallet:erc721-transfer',
  'wallet:erc1155-transfer','wallet:receive',
]);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class AssetControlStateError extends Error {
  constructor(code = 'ASSET_CONTROL_STATE_REFUSED', status = 503) { super(code); this.status = status; }
}
const check = (ok, code, status) => { if (!ok) throw new AssetControlStateError(code, status); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fields(value, keys) {
  check(plain(value));
  const d = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(d).length === keys.length && keys.every(k =>
    Object.hasOwn(d,k) && Object.hasOwn(d[k],'value') && d[k].enumerable));
}
function dataArray(value, maximum) {
  check(Array.isArray(value) && value.length <= maximum);
  const d = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(d).length === value.length + 1);
  return Array.from({length:value.length}, (_,i) => {
    const item=d[String(i)]; check(item && Object.hasOwn(item,'value') && item.enumerable); return item.value;
  });
}
const frozen = value => { for (const item of Object.values(value)) if (item && typeof item === 'object') frozen(item); return Object.freeze(value); };
const time = value => { check(Number.isSafeInteger(value) && value >= 0); return value; };
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function checkedScope(value) {
  fields(value,['origin','tenant','username','account','chainId','agentId']);
  return scope(value);
}
export function normalizeAssetControlTarget(value) {
  check(plain(value), 'ASSET_CONTROL_TARGET_REFUSED', 400);
  const kind = Object.getOwnPropertyDescriptor(value,'kind');
  check(kind && Object.hasOwn(kind,'value'), 'ASSET_CONTROL_TARGET_REFUSED', 400);
  if (kind.value === 'allow-agent') {
    fields(value,['kind']); return Object.freeze({kind:'allow-agent'});
  }
  check(['asset','operation'].includes(kind.value),'ASSET_CONTROL_TARGET_REFUSED',400);
  fields(value,kind.value === 'asset' ? ['kind','path'] : ['kind','path','operation']);
  const path = dataArray(value.path,4);
  check(path.length >= 1 && path.every(x => typeof x === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)) &&
    new Set(path).size === path.length,'ASSET_CONTROL_TARGET_REFUSED',400);
  if (kind.value === 'operation') check(ASSET_CONTROL_OPERATIONS.includes(value.operation),
    'ASSET_CONTROL_TARGET_REFUSED',400);
  return frozen({kind:kind.value,path,...(kind.value === 'operation' ? {operation:value.operation} : {})});
}
export const assetControlFieldKey = target => hash(normalizeAssetControlTarget(target));
export const assetControlPolicyKey = input => '@asset-controls:'+hash(checkedScope(input));
/** One explicit field per request. No whole-tree UI snapshot is persisted. */
export function normalizeAssetControlPatch(value) {
  fields(value,['target','value','expectedFieldRevision']);
  check(typeof value.value === 'boolean','ASSET_CONTROL_VALUE_REFUSED',400);
  return frozen({target:normalizeAssetControlTarget(value.target),value:value.value,
    expectedFieldRevision:revision(value.expectedFieldRevision)});
}
export function assetControlRequest(value) {
  check(plain(value));const schema=Object.getOwnPropertyDescriptor(value,'schema');check(schema && Object.hasOwn(schema,'value'));
  const continued=schema.value==='8415-asset-control-change/2';
  fields(value,['schema','scope',...(continued?['originBinding']:[]),'expectedRevision','patch','credentialRevision','changeId','nonce','issuedAt','expiresAt']);
  check((continued || value.schema === '8415-asset-control-change/1') &&
    Number.isSafeInteger(value.credentialRevision) && value.credentialRevision >= 0 &&
    token(value.changeId) && token(value.nonce));
  const issuedAt=time(value.issuedAt),expiresAt=time(value.expiresAt);
  check(issuedAt < expiresAt && expiresAt-issuedAt <= 300000);
  return frozen({schema:value.schema,scope:checkedScope(value.scope),
    ...(continued?{originBinding:readOwnerChangeOriginBinding(value.originBinding,checkedScope(value.scope))}:{}),expectedRevision:revision(value.expectedRevision),
    patch:normalizeAssetControlPatch(value.patch),credentialRevision:value.credentialRevision,
    changeId:value.changeId,nonce:value.nonce,issuedAt,expiresAt});
}
export const assetControlChangeDigest = request => hash(assetControlRequest(request));
function blank(input) {
  return {schema:ASSET_CONTROL_SCHEMA,scope:checkedScope(input),revision:'0',entries:[],changes:[]};
}
function applyEntry(state, request, verifiedFactors, changedAt) {
  const key=assetControlFieldKey(request.patch.target),index=state.entries.findIndex(e=>e.key===key);
  const previous=index<0 ? null : state.entries[index];
  check(request.expectedRevision === state.revision,'ASSET_CONTROL_REVISION_CONFLICT',409);
  check(request.patch.expectedFieldRevision === (previous?.revision ?? '0'),
    'ASSET_CONTROL_FIELD_REVISION_CONFLICT',409);
  const nextRevision=revision((BigInt(state.revision)+1n).toString());
  const fieldRevision=revision((BigInt(previous?.revision ?? '0')+1n).toString());
  const entry={key,target:request.patch.target,value:request.patch.value,revision:fieldRevision,
    policyRevision:nextRevision,changedAt,changeId:request.changeId};
  const entries=state.entries.slice(); if(index<0) entries.push(entry); else entries[index]=entry;
  return {...state,revision:nextRevision,entries,changes:[...state.changes,{
    request,changeDigest:assetControlChangeDigest(request),verifiedFactors,changedAt}]};
}
/** Validate the complete audit chain and reconstruct final sparse entries.
 * An explicit null/damaged member never becomes the initial ON projection.
 */
export function readAssetControlPolicy(raw,input) {
  const expected=checkedScope(input);
  if(raw === null) return frozen(blank(expected));
  fields(raw,['schema','scope','revision','entries','changes']);
  check(raw.schema===ASSET_CONTROL_SCHEMA && JSON.stringify(checkedScope(raw.scope))===JSON.stringify(expected));
  revision(raw.revision);
  const changes=dataArray(raw.changes,10000),entries=dataArray(raw.entries,10000);
  // A canonical empty projection may be passed between pure helpers. It is
  // never an owner save and is separately refused as a persisted member below.
  if(raw.revision==='0') {
    check(changes.length===0 && entries.length===0); return frozen(blank(expected));
  }
  check(changes.length>0);
  let state=blank(expected);
  const seen=new Set(); let priorTime=0;
  for(const event of changes) {
    fields(event,['request','changeDigest','verifiedFactors','changedAt']);
    const request=assetControlRequest(event.request),changedAt=time(event.changedAt);
    const factors=dataArray(event.verifiedFactors,2);
    check(JSON.stringify(request.scope)===JSON.stringify(expected) &&
      event.changeDigest===assetControlChangeDigest(request) &&
      !seen.has(request.changeId) && !seen.has(request.nonce) &&
      factors.length===2 && ['password','wallet'].includes(factors[0]) && factors[1]==='verified-email' &&
      changedAt>=request.issuedAt && changedAt<request.expiresAt && changedAt>=priorTime);
    seen.add(request.changeId);seen.add(request.nonce);priorTime=changedAt;
    state=applyEntry(state,request,factors,changedAt);
  }
  check(state.revision===raw.revision && entries.length===state.entries.length);
  for(let i=0;i<entries.length;i++) {
    fields(entries[i],['key','target','value','revision','policyRevision','changedAt','changeId']);
    const e=entries[i];normalizeAssetControlTarget(e.target);
    check(JSON.stringify(e)===JSON.stringify(state.entries[i]));
  }
  return frozen(state);
}
export function readCredentialAssetControlPolicy(credential,input) {
  checkedScope(input);
  if(credential===null) return readAssetControlPolicy(null,input);
  check(plain(credential));
  const member=Object.getOwnPropertyDescriptor(credential,'assetControlPolicies');
  if(member===undefined) return readAssetControlPolicy(null,input);
  check(Object.hasOwn(member,'value') && member.enumerable && plain(member.value));
  const d=Object.getOwnPropertyDescriptors(member.value),key=assetControlPolicyKey(input);
  check(Reflect.ownKeys(d).every(k=>typeof k==='string' && /^@asset-controls:[a-f0-9]{64}$/.test(k) &&
    Object.hasOwn(d[k],'value') && d[k].enumerable));
  if(!Object.hasOwn(d,key)) return readAssetControlPolicy(null,input);
  check(d[key].value!==null && d[key].value!==undefined);
  const saved=readAssetControlPolicy(d[key].value,input);
  check(saved.revision!=='0'); // absence, not an explicit saved zero, means default
  return saved;
}
/** Projection only: default is ON for every field, not an execution grant. */
export function assetControlValue(state,target) {
  const current=readAssetControlPolicy(state,state.scope),normalized=normalizeAssetControlTarget(target);
  const entry=current.entries.find(e=>e.key===assetControlFieldKey(normalized));
  return frozen({target:normalized,value:entry?.value ?? true,source:entry?'owner-saved':'default',
    revision:entry?.revision ?? '0',policyRevision:current.revision,executable:false});
}
/** Called ONLY by the owner service after both exact-change factors have been
 * consumed and rechecked inside the existing authoritative credential write lock.
 * This pure append helper does not verify factors or mint such authority.
 */
export function appendVerifiedAssetControlChange(raw,input,requestInput,factorsInput,changedAt) {
  const prior=readAssetControlPolicy(raw,input),request=assetControlRequest(requestInput);
  check(JSON.stringify(request.scope)===JSON.stringify(prior.scope));
  const factors=dataArray(factorsInput,2);
  check(factors.length===2 && ['password','wallet'].includes(factors[0]) && factors[1]==='verified-email',
    'ASSET_CONTROL_TWO_FACTORS_REQUIRED',403);
  time(changedAt);
  check(changedAt>=request.issuedAt && changedAt<request.expiresAt,'ASSET_CONTROL_CHANGE_EXPIRED',409);
  return readAssetControlPolicy(applyEntry(prior,request,factors,changedAt),input);
}
