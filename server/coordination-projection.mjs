import {validateCoordinationView} from '../web/coordination-view.mjs';
const refuse=ok=>{if(!ok)throw Error('COORDINATION_SOURCE_REFUSED');};
/** Private trusted-source projection; it never releases funds or creates authority. */
export function projectCoordination({snapshot,evidence,ownOccurrenceId,payments=null}) {
 const ids=[snapshot.initialOccurrenceId,...snapshot.legs.map(l=>l.buyerOccurrenceId)],i=ids.indexOf(ownOccurrenceId);
 refuse(i>=0&&(snapshot.offChainDetached??0n)===0n);
 const coordination={blockNumber:snapshot.blockNumber.toString(),blockHash:snapshot.blockHash,sourceRevision:snapshot.revision.toString(),knownEnd:snapshot.legs.length.toString(),scaleEnd:(snapshot.legs.length+1).toString()};
 const empty=state=>({state,tokenState:state,fundsState:state,boundaryPosition:null,nftPosition:null,holderPosition:null,fundsPosition:null,frozen:false});
 let funds={state:'unknown',legs:[]},rollback=empty('unknown');
 if(payments!==null){
  refuse(Array.isArray(payments)&&payments.length===snapshot.legs.length);
  payments.forEach((p,n)=>{const l=snapshot.legs[n];refuse(p.sequenceId===snapshot.sequenceId&&p.legId===l.id&&typeof p.amount==='bigint'&&p.amount>=0n&&p.amount<1n<<256n);
   // The pinned native adapter cannot settle a returned leg or refund an active one.
   refuse(!['settlement-due','settled'].includes(p.state)||l.outcome==='completed');
   refuse(!['refund-due','refunded'].includes(p.state)||l.outcome==='returned');
   refuse(p.state!=='reserved'); // An accepted leg consumes its reservation atomically.
  });
  funds={state:'observed',legs:[i>0?i-1:null,i<snapshot.legs.length?i:null].filter(n=>n!==null).map(n=>{const p=payments[n],position=(n+1).toString();return {role:n===i?'outgoing':'incoming',position,state:p.state,amountBaseUnits:p.amount.toString(),locationPosition:p.state==='settled'?n.toString():p.state==='refunded'?position:null};})};
  const root=snapshot.legs.findIndex(l=>['returning','returned'].includes(l.outcome));
  if(root<0||i<root)rollback=empty('not-applicable');
  else{
   const tail=snapshot.legs.slice(root);refuse(tail.every(l=>['returning','returned'].includes(l.outcome)));
   const owner=evidence.kind==='bound'?ids.indexOf(evidence.owner.occurrenceId):-1,holder=evidence.kind==='bound'?ids.indexOf(evidence.admittedHolder.occurrenceId):-1;
   const tokenReturned=tail.every(l=>l.outcome==='returned')&&owner===root;
   const ps=payments.slice(root),noFunds=ps.every(p=>p.state==='unfunded'),refunds=ps.every(p=>['unfunded','refunded'].includes(p.state));
   const fundsState=noFunds?'not-required':refunds?'returned':'pending';
   rollback={state:tokenReturned&&holder===root&&refunds?'DONE':'PENDING',tokenState:tokenReturned?'returned':owner<0||holder<0?'unknown':'returning',fundsState,boundaryPosition:root.toString(),nftPosition:owner<0?null:owner.toString(),holderPosition:holder<0?null:holder.toString(),fundsPosition:null,frozen:tokenReturned&&holder===root&&refunds};
  }
 }
 return validateCoordinationView({coordination,funds,rollback},i.toString());
}
