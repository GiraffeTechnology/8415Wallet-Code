/** Authenticated server-owned inventory capability. Never imports classification catalogs. */
import { exactNftKeys as exact, validateNftRecord, validateNftInventory } from '../web/nft-inventory-client.mjs';
export class NftInventoryError extends Error {constructor(code='NFT_INVENTORY_SOURCE_UNAVAILABLE',status=503){super(code);this.status=status;}}
const check=(ok,code='NFT_INVENTORY_SOURCE_REFUSED',status=503)=>{if(!ok)throw new NftInventoryError(code,status);};
export function createNftInventoryService({reader=null,origin,tenant,now=Date.now,validateSession}) {
 check(reader===null || typeof reader.readForPrincipal==='function','NFT_INVENTORY_CONFIG_REFUSED',500);
 const readForPrincipal=reader===null?null:reader.readForPrincipal.bind(reader);
 return Object.freeze({async read(body,session){
  check(exact(body,['readId']) && typeof body.readId==='string' && /^[a-f0-9]{32}$/.test(body.readId),'NFT_INVENTORY_REQUEST_REFUSED',400);
  await validateSession(session);check(reader!==null,'NFT_INVENTORY_NOT_ENABLED');
  const principal=Object.freeze({tenant,origin,username:session.username,account:session.account,chainId:session.chainId});
  let source;try{source=await readForPrincipal(Object.freeze({principal,readId:body.readId}));}catch{throw new NftInventoryError();}
  await validateSession(session);
  check(exact(source,['schema','scope','readId','observedAt','validUntil','inventoryState','records']) && source.schema==='8415-authoritative-nft-inventory/1' && exact(source.scope,Object.keys(principal)) && Object.keys(principal).every(k=>source.scope[k]===principal[k]) && source.readId===body.readId);
  check(['complete','partial','stale','unavailable'].includes(source.inventoryState) && Array.isArray(source.records) && source.records.length<=1024);
  check(Number.isSafeInteger(source.observedAt) && source.observedAt>=0 && source.observedAt<=now() && Number.isSafeInteger(source.validUntil) && source.validUntil>=source.observedAt);
  const seen=new Set();try{for(const record of source.records){validateNftRecord(record,principal.chainId);const key=record.chainId+':'+record.contract+':'+record.tokenId;check(!seen.has(key));seen.add(key);}}catch{throw new NftInventoryError('NFT_INVENTORY_SOURCE_REFUSED');}
  const inventoryState=source.inventoryState==='unavailable'?'unavailable':source.validUntil<=now()?'stale':source.inventoryState;
  // Copy only validated DTOs. No owner, holder, neighbor, private endpoint or raw source survives.
  const result={schema:'8415-nft-inventory/1',scope:{tenant,origin,account:session.account,chainId:session.chainId},readId:body.readId,state:inventoryState==='complete'?'ready':inventoryState,inventoryState,observedAt:source.observedAt,validUntil:source.validUntil,records:['stale','unavailable'].includes(inventoryState)?[]:structuredClone(source.records)};
  try{return validateNftInventory(result,{scope:result.scope,readId:body.readId},now());}catch{throw new NftInventoryError('NFT_INVENTORY_SOURCE_REFUSED');}
 }});
}
