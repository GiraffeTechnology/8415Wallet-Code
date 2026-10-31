import { validateNftDetails } from './nft-details-client.mjs';
/** Read-only, exact privacy projection. URLs are data only; this module never fetches media. */
const check = ok => { if (!ok) throw Error('NFT_INVENTORY_RESPONSE_REFUSED'); };
export const exactNftKeys = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) && Reflect.ownKeys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k) && 'value' in Object.getOwnPropertyDescriptor(v,k));
const uint = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 1n << 256n;
const address = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v) && !/^0x0+$/.test(v);
const text = (v,max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v);
export function safeNftMediaUrl(value) {
 if (typeof value !== 'string' || value.length > 2048) return false;
 try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.search && !u.hash && (!u.port || u.port==='443') && /^[a-z0-9.-]+$/.test(u.hostname) && u.hostname.includes('.') && !/^(?:[0-9.]+)$/.test(u.hostname) && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(u.hostname) && !u.pathname.includes('%'); } catch { return false; }
}
export function validateNftRecord(row, chainId) {
 check(exactNftKeys(row,['chainId','contract','tokenId','standard','balanceRaw','blockNumber','blockHash','metadata','native','escrow','pending']));
 check(uint(row.chainId) && row.chainId !== '0' && row.chainId===chainId && address(row.contract) && uint(row.tokenId));
 check(['ERC-721','ERC-1155'].includes(row.standard) && uint(row.balanceRaw) && BigInt(row.balanceRaw)>0n && (row.standard!=='ERC-721' || row.balanceRaw==='1'));
 check(typeof row.blockNumber==='string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(row.blockNumber) && typeof row.blockHash==='string' && /^0x[0-9a-f]{64}$/.test(row.blockHash) && !/^0x0+$/.test(row.blockHash));
 const m=row.metadata; check(exactNftKeys(m,['state','name','description','imageUrl']));
 check(m.state==='unavailable' ? [m.name,m.description,m.imageUrl].every(v=>v===null) : m.state==='available' && (m.name===null||text(m.name,256)) && (m.description===null||text(m.description,2048)) && (m.imageUrl===null||safeNftMediaUrl(m.imageUrl)));
 validateNftDetails(row);
 return row;
}
export function validateNftInventory(value,{scope,readId},now=Date.now()) {
 check(exactNftKeys(value,['schema','scope','readId','state','inventoryState','observedAt','validUntil','records']) && value.schema==='8415-nft-inventory/1');
 check(exactNftKeys(value.scope,['tenant','origin','account','chainId']) && Object.keys(value.scope).every(k=>value.scope[k]===scope[k]) && value.readId===readId);
 check(['complete','partial','stale','unavailable'].includes(value.inventoryState) && value.state===(value.inventoryState==='complete'?'ready':value.inventoryState));
 check(Number.isSafeInteger(value.observedAt) && value.observedAt>=0 && value.observedAt<=now && Number.isSafeInteger(value.validUntil) && value.validUntil>=value.observedAt);
 check(Array.isArray(value.records) && value.records.length<=1024);
 if (['stale','unavailable'].includes(value.state)) check(value.records.length===0); else check(value.validUntil>now);
 const seen=new Set(); for(const row of value.records) {validateNftRecord(row,scope.chainId);const key=row.chainId+':'+row.contract+':'+row.tokenId;check(!seen.has(key));seen.add(key);}
 return value;
}
