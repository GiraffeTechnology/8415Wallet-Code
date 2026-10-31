/** Strict existing-protocol/ledger privacy DTOs; no owner, holder or counterparties. */
import { validateForwardProgress } from './forward-progress-client.mjs';
const check=ok=>{if(!ok)throw Error('NFT_DETAILS_REFUSED');};
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)&&'value' in Object.getOwnPropertyDescriptor(v,k));
const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<1n<<256n;
const u64=v=>uint(v)&&BigInt(v)<1n<<64n;
const bytes=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const hash=v=>bytes(v)&&!/^0x0+$/.test(v);
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0+$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v);
export function validateNftDetails(row) {
 const n=row.native;
 if(n?.state==='ready'){
  check(row.standard==='ERC-721');
  check(exact(n,['state','registerId','verificationProfile','entry','instant','finality','gap','settlement']));
  check(hash(n.registerId)&&(n.verificationProfile===null||bytes(n.verificationProfile))&&u64(n.instant)&&typeof n.finality==='boolean');
  const e=n.entry;check(exact(e,['version','effectiveAt','supersededAt','recordCommitment','previousCommitment','registryReference'])&&u64(e.version)&&e.version!=='0'&&u64(e.effectiveAt)&&u64(e.supersededAt)&&hash(e.recordCommitment)&&bytes(e.previousCommitment)&&bytes(e.registryReference));
  check(e.supersededAt==='0'||BigInt(e.supersededAt)>BigInt(e.effectiveAt));
  const g=n.gap;if(g?.state==='open'){check(exact(g,['state','settlementId','openedAt','deadline','snapshotHash'])&&hash(g.settlementId)&&u64(g.openedAt)&&u64(g.deadline)&&BigInt(g.deadline)>=BigInt(g.openedAt)&&bytes(g.snapshotHash));}else check(exact(g,['state'])&&['none','unsupported'].includes(g.state));
  const s=n.settlement;check(exact(s,['state','settlementId'])&&(['none','unsupported'].includes(s.state)?s.settlementId===null:['OPEN','ADMITTED','CANCELLED','SUPERSEDED'].includes(s.state)&&hash(s.settlementId)));
  if(g.state==='open')check(s.state==='OPEN'&&s.settlementId===g.settlementId);
 }else check(exact(n,['state'])&&['unavailable','not-applicable'].includes(n.state));
 const e=row.escrow;
 if(e?.state==='ready'){
  check(exact(e,['state','inventoryState','records'])&&['complete','partial'].includes(e.inventoryState)&&Array.isArray(e.records)&&e.records.length<=4096);
  const seen=new Set();for(const r of e.records){check(exact(r,['reservationId','currency','amountBaseUnits','state','blockHash'])&&id(r.reservationId)&&!seen.has(r.reservationId)&&uint(r.amountBaseUnits)&&['held','released','refunded','unknown'].includes(r.state)&&r.blockHash===row.blockHash);seen.add(r.reservationId);
   const c=r.currency;check(exact(c,['chainId','kind','contract','decimals'])&&c.chainId===row.chainId&&Number.isInteger(c.decimals)&&c.decimals>=0&&c.decimals<=255&&(c.kind==='native'?c.contract===null:c.kind==='erc20'&&address(c.contract)));}
 }else check(exact(e,['state'])&&e.state==='unavailable');
 const p=row.pending;
 if(p?.state==='ready'){
  check(exact(p,['state','progress']));const asset={chainId:row.chainId,contract:row.contract,tokenId:row.tokenId};
  validateForwardProgress(p.progress,{asset,sequenceId:p.progress.sequenceId});
  // Frozen milestones may predate the current holdings snapshot. Never move their marker.
  check(BigInt(p.progress.blockNumber)<=BigInt(row.blockNumber));
  if(!p.progress.frozen)check(p.progress.blockHash===row.blockHash&&BigInt(p.progress.blockNumber)===BigInt(row.blockNumber));
  if(p.progress.schema==='8415-forward-progress/2'){
   const c=p.progress.coordination;check(BigInt(c.blockNumber)<=BigInt(row.blockNumber));
   if(!p.progress.rollback.frozen)check(c.blockHash===row.blockHash&&BigInt(c.blockNumber)===BigInt(row.blockNumber));
  }
 }else check(exact(p,['state'])&&p.state==='unavailable');
 return row;
}
