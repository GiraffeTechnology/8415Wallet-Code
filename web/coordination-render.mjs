import {NFT_BROWSER_TEXT} from './locales/nft-browser.mjs';
import {COORDINATION_TEXT} from './locales/coordination.mjs';
const states={unknown:15,'not-applicable':16,PENDING:17,pending:17,DONE:18,returning:19,returned:20,'not-required':21,unfunded:22,funded:23,'settlement-due':24,'refund-due':25,settled:26,refunded:27,reserved:28,observed:29};
/** Validated read DTO only. No payment/rollback state is derived here. */
export function coordinationLines(value,locale='en'){
 if(value.schema!=='8415-forward-progress/2')return [];
 const t=COORDINATION_TEXT[locale]??COORDINATION_TEXT.en,c=value.coordination,f=value.funds,r=value.rollback;
 const state=s=>t[states[s]??15],pos=p=>p===null?t[15]:p+'/'+c.scaleEnd;
 const lines=[t[r.frozen?32:0],t[1]+': '+c.blockNumber+' / '+c.blockHash,t[2]+': '+c.sourceRevision,t[3]+': '+state(f.state)];
 if(value.frozen)lines.push(t[30]);
 for(const leg of f.legs)lines.push(t[leg.role==='incoming'?5:6]+': '+t[7]+' '+leg.position+' · '+state(leg.state)+' · '+t[8]+' '+leg.amountBaseUnits+' · '+t[9]+' '+pos(leg.locationPosition));
 lines.push(t[4]+': '+state(r.state),t[13]+': '+state(r.tokenState),t[14]+': '+state(r.fundsState),t[10]+': '+pos(r.boundaryPosition),t[11]+': '+pos(r.nftPosition),t[31]+': '+pos(r.holderPosition));
 return lines;
}
export function appendCoordinationView(root,value,document,locale='en',includeLines=true){
 if(value.schema!=='8415-forward-progress/2')return;
 const t=COORDINATION_TEXT[locale]??COORDINATION_TEXT.en;
 for(const content of includeLines?coordinationLines(value,locale):[]){const p=document.createElement('p');p.textContent=content;root.append(p);}
 const positions=value.funds.legs.filter(leg=>leg.locationPosition!==null).map(leg=>[t[leg.role==='incoming'?5:6]+' / '+t[9],leg.locationPosition,false]);
 for(const [label,position]of [[t[11],value.rollback.nftPosition],[t[31],value.rollback.holderPosition]])if(position!==null)positions.push([label,position,true]);
 for(const [label,position,tokenTrack]of positions){const bar=document.createElement('div');bar.className='nft-progress-track coordination-position-track';bar.setAttribute('aria-label',label+': '+position+'/'+value.coordination.scaleEnd+(tokenTrack?'; '+(NFT_BROWSER_TEXT[locale]??NFT_BROWSER_TEXT.en).slice(56,59).join(' / '):''));if(tokenTrack){
    const scale=BigInt(value.coordination.scaleEnd),end=BigInt(value.coordination.knownEnd),point=BigInt(position);
    // Observed token positions only: never derive payment progress or DONE.
    for(const [kind,size]of [['changed',point],['unchanged',end-point],['untraded',scale-end]]){
     const segment=document.createElement('span');segment.className='nft-progress-'+kind;segment.style.width=(Number(size*10000n/scale)/100)+'%';segment.setAttribute('aria-hidden','true');bar.append(segment);
    }
   }
   const marker=document.createElement('span');marker.className='nft-progress-marker';marker.setAttribute('aria-hidden','true');marker.style.left=(Number(BigInt(position)*10000n/BigInt(value.coordination.scaleEnd))/100)+'%';bar.append(marker);root.append(bar);}
}
/** Forward owner/holder positions use their own (possibly frozen) scale. */
export function appendForwardTracks(root,value,document,labels){
 for(const [label,track]of [[labels[0],value.owner],[labels[1],value.holder]]){
  if(track.position===null)continue;
  const scale=BigInt(value.scaleEnd),position=BigInt(track.position),end=BigInt(value.knownEnd),pct=n=>Number(n*10000n/scale)/100;
  const bar=document.createElement('div');bar.className='nft-progress-track';bar.setAttribute('aria-label',label+': '+track.position+'/'+value.scaleEnd+'; '+labels.slice(2).join(' / '));
  for(const [kind,size]of [['changed',position],['unchanged',end-position],['untraded',scale-end]]){const span=document.createElement('span');span.className='nft-progress-'+kind;span.style.width=pct(size)+'%';bar.append(span);}
  const marker=document.createElement('span');marker.className='nft-progress-marker';marker.style.left=pct(position)+'%';marker.setAttribute('aria-hidden','true');bar.append(marker);root.append(bar);
 }
}
