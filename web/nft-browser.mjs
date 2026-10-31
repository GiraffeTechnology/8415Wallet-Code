import {readStateText} from './locales/read-states.mjs';
import {appendCoordinationView} from './coordination-render.mjs';
import {validateImageOrigins} from './image-policy.mjs';
/** In-memory browsing of exact, verified reads. Never discovers holdings or grants authority. */
import {NFT_BROWSER_TEXT} from './locales/nft-browser.mjs';
export function safeThumbnailUrl(value, walletOrigin){
 try{if(typeof value!=='string'||value.length>2048)return false;const u=new URL(value);
 return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443')&&u.origin!==walletOrigin&&
 /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}$/.test(u.hostname)&&!/(?:^|\.)(?:localhost|local|internal|invalid|test|lan|home|arpa)$/.test(u.hostname)&&!u.pathname.includes('%');
 }catch{return false;}
}
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<1n<<256n;
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&!/^0x0+$/.test(value);
export function nftSnapshot(input,session){
 if(!input||!session||input.account?.toLowerCase()!==session.account?.toLowerCase()||input.chainId!==session.chainId||
  !uint(input.chainId)||!address(input.contract)||!uint(input.tokenId)||!uint(input.balanceRaw)||!['ERC-721','ERC-1155'].includes(input.standard)||
  !/^0x[0-9a-f]{64}$/.test(input.blockHash)||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(input.blockNumber))throw Error('NFT_SNAPSHOT_REFUSED');
 // Explicit allowlist: never retain neighboring owner identities, arbitrary metadata or URLs.
 return Object.freeze({chainId:input.chainId,contract:input.contract,tokenId:input.tokenId,standard:input.standard,
  balanceRaw:input.balanceRaw,blockNumber:input.blockNumber,blockHash:input.blockHash});
}
export function sortNftSnapshots(entries,{category='all',sort='tokenId',direction='ascending'}={}){
 if(!['all','ERC-721','ERC-1155'].includes(category)||!['tokenId','contract','balanceRaw'].includes(sort)||!['ascending','descending'].includes(direction))throw Error('NFT_VIEW_REFUSED');
 return entries.filter(x=>category==='all'||x.standard===category).sort((a,b)=>{
  const left=sort==='contract'?a.contract:BigInt(a[sort]),right=sort==='contract'?b.contract:BigInt(b[sort]);
  const compared=left<right?-1:left>right?1:(a.contract+':'+a.tokenId).localeCompare(b.contract+':'+b.tokenId);
  return direction==='ascending'?compared:-compared;
 });
}
export function mountNftBrowser({document,root,login,clientFor=()=>null,available=()=>false,imageOrigins=()=>[],locale=()=>document.documentElement.lang,window=globalThis,now=Date.now}){
 if(!root)return null;
 const section=document.createElement('section');section.className='card nft-browser';section.setAttribute('data-page','nft');root.append(section);
 const title=document.createElement('h2'),note=document.createElement('p'),controls=document.createElement('div'),output=document.createElement('div'),boundary=document.createElement('p');
 output.setAttribute('aria-live','polite');controls.className='nft-browser-controls';
 const load=document.createElement('button'),cancel=document.createElement('button');load.type=cancel.type='button';section.append(title,note,load,cancel,controls,output,boundary);
 const selections={category:'all',view:'list',sort:'tokenId',direction:'ascending'},widgets={};let entries=new Map(),page=window.history?.state?.walletPage??'overview',epoch=0,pending=false,inventory=null,sourceState='session',expiryTimer=null;
 for(const [key,values]of Object.entries({category:['all','ERC-721','ERC-1155'],view:['list','thumbnails'],sort:['tokenId','contract','balanceRaw'],direction:['ascending','descending']})){
  const label=document.createElement('label'),name=document.createElement('span'),select=document.createElement('select');label.append(name,select);controls.append(label);
  for(const value of values){const option=document.createElement('option');option.value=value;select.append(option);}select.value=selections[key];
  widgets[key]={name,select};select.addEventListener('change',()=>{selections[key]=select.value;draw();});
 }
 const images=new Set();
 const revokeImages=()=>{for(const image of images)image.removeAttribute('src');images.clear();};
 const stopExpiry=()=>{if(expiryTimer!==null)window.clearTimeout(expiryTimer);expiryTimer=null;};
 const armExpiry=()=>{stopExpiry();if(inventory?.validUntil>now())expiryTimer=window.setTimeout(()=>{expiryTimer=null;draw();armExpiry();},Math.min(inventory.validUntil-now(),2147483647));};
 const clear=()=>{stopExpiry();epoch++;pending=false;inventory=null;sourceState='session';entries.clear();draw();};
 const usable=()=>{try{login.assert();return page==='nft'&&available()===true&&clientFor()!==null&&document.visibilityState!=='hidden';}catch{return false;}};
 function draw(){
  revokeImages();
  const text=NFT_BROWSER_TEXT[locale()]??NFT_BROWSER_TEXT.en;section.hidden=page!=='nft';title.textContent=text[0];const expired=inventory&&inventory.validUntil<=now();note.textContent=expired?text[21]:pending?text[20]:sourceState==='unavailable'?text[21]:inventory?text[22]+': '+readStateText(inventory.inventoryState,locale()):text[1];boundary.textContent=text[18];
  load.textContent=text[19];load.disabled=pending||!usable();cancel.textContent=text[30];cancel.hidden=!pending;cancel.disabled=!pending;
  const specs={category:[2,[3,'ERC-721','ERC-1155']],view:[4,[5,6]],sort:[7,[8,9,10]],direction:[11,[12,13]]};
  for(const [key,[label,options]]of Object.entries(specs)){widgets[key].name.textContent=text[label];
   // HTMLCollection is iterable, but does not implement Array.forEach in browsers.
   Array.from(widgets[key].select.children).forEach((option,i)=>option.textContent=typeof options[i]==='number'?text[options[i]]:options[i]);}
  output.replaceChildren();output.className=selections.view==='thumbnails'?'nft-browser-grid':'nft-browser-list';
  let rows=[];try{login.assert();rows=expired?[]:sortNftSnapshots([...entries.values()],selections);}catch{entries.clear();}
  if(!rows.length){output.textContent=!expired&&inventory?.state==='ready'&&inventory.inventoryState==='complete'?text[23]:text[14];return;}
  for(const row of rows){const card=document.createElement('article');card.className='nft-browser-item';const heading=document.createElement('h3');heading.textContent=row.standard+' #'+row.tokenId;card.append(heading);
   if(selections.view==='thumbnails'){
    const box=document.createElement('div');box.className='nft-browser-thumbnail';box.textContent=row.metadata?.imageUrl?text[26]+': '+row.metadata.imageUrl:text[15];card.append(box);
    const url=row.metadata?.imageUrl;
    let approved=false;try{approved=safeThumbnailUrl(url,inventory?.scope.origin)&&validateImageOrigins(imageOrigins()).includes(new URL(url).origin);}catch{}
    if(url&&!approved){const reason=document.createElement('p');reason.textContent=text[63];box.append(reason);}
    if(row.metadata?.state==='available'&&approved){
     const button=document.createElement('button');button.type='button';button.textContent=text[61];box.append(button);const revision=epoch,binding=login.capture(),snapshot=inventory;
     button.addEventListener('click',()=>{try{login.assert(binding);if(!validateImageOrigins(imageOrigins()).includes(new URL(url).origin)||revision!==epoch||page!=='nft'||!snapshot||snapshot!==inventory||snapshot.validUntil<=now()||document.visibilityState==='hidden')return;
      const image=document.createElement('img');image.alt=row.metadata.name??text[62];image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';image.loading='lazy';image.decoding='async';
      image.addEventListener('error',()=>{if(images.has(image)){image.removeAttribute('src');images.delete(image);box.replaceChildren();box.textContent=text[15];}});
      images.add(image);box.replaceChildren(image);image.src=url;
     }catch{revokeImages();}});
    }
   }
   for(const value of [row.contract,'chainId: '+row.chainId,text[16]+': '+row.balanceRaw,text[17]+': '+row.blockNumber,
    ...(row.metadata?.state==='available'?[text[24]+': '+(row.metadata.name??'—'),text[25]+': '+(row.metadata.description??'—')]:[]),
    ...(row.native?.state==='unavailable'?[text[27]]:[]),...(row.escrow?.state==='unavailable'?[text[28]]:[]),...(row.pending?.state==='unavailable'?[text[29]]:[])]){const p=document.createElement('p');p.textContent=value;card.append(p);}appendNftDetails(card,row,text,document,locale());output.append(card);}
 }
 const receive=input=>{try{const value=nftSnapshot(input,login.assert());if(inventory){stopExpiry();entries.clear();inventory=null;}sourceState='session';entries.set(value.chainId+':'+value.contract+':'+value.tokenId,value);draw();}catch{clear();}};
 login.subscribe(clear);
 document.addEventListener('wallet:nft-view',event=>{if(event.detail)receive(event.detail);});
 document.addEventListener('wallet:summary-stale',event=>{if(!event.detail||['all','external','nft'].includes(event.detail))clear();});
 document.addEventListener('wallet:page',event=>{if(event.detail!==page&&pending)clear();page=event.detail;draw();});
 document.addEventListener('wallet:account-features',clear);
 document.addEventListener('visibilitychange',clear);
 document.querySelector('[data-ui-locale-select]')?.addEventListener('change',draw);
 window.addEventListener?.('pagehide',clear);
 async function readInventory(){
  if(pending||!usable())return;
  const current=++epoch,binding=login.capture(),client=clientFor();pending=true;entries.clear();inventory=null;draw();
  try{
   await login.check();const session=login.assert(binding);if(current!==epoch||!usable()||client!==clientFor())return;
   const value=await client.readNftInventory();login.assert(binding);if(current!==epoch||!usable()||client!==clientFor())return;
   if(value.scope.account.toLowerCase()!==session.account.toLowerCase()||value.scope.chainId!==session.chainId||value.scope.tenant!==session.tenant||value.scope.origin!==session.origin)throw Error('NFT_INVENTORY_CONTEXT_REFUSED');
   inventory=value;sourceState=value.state;armExpiry();
   for(const record of value.records){const safe=nftSnapshot({...record,account:session.account},session);entries.set(safe.chainId+':'+safe.contract+':'+safe.tokenId,{...safe,metadata:record.metadata,native:record.native,escrow:record.escrow,pending:record.pending});}
  }catch{if(current===epoch){entries.clear();inventory=null;sourceState='unavailable';}}
  finally{if(current===epoch){pending=false;draw();}}
 }
 load.addEventListener('click',readInventory);cancel.addEventListener('click',clear);
 draw();return {receive,clear,section,widgets,output,load,cancel,readInventory,refreshPolicy:draw};
}

/** Only previously validated privacy DTOs; no positions are inferred from addresses. */
export function appendNftDetails(card,row,text,document,locale='en'){
 const line=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;card.append(node);return node;};
 const field=(label,value)=>line('p',text[label]+': '+String(value??'—'));
 if(row.native?.state==='ready'){
  const n=row.native,e=n.entry;line('h4',text[31]);
  for(const [label,value]of [[32,n.registerId],[33,n.verificationProfile],[34,e.version],[35,e.effectiveAt+' / '+e.supersededAt],[36,e.recordCommitment],[37,e.previousCommitment],[38,e.registryReference],[39,n.instant]])field(label,value);
  line('p',n.finality?text[40]:text[41]);field(42,n.gap.state);field(43,n.settlement.state);
  if(n.gap.state==='open')for(const key of ['settlementId','openedAt','deadline','snapshotHash'])line('p',key+': '+n.gap[key]);
 }
 if(row.escrow?.state==='ready'){
  line('h4',text[44]);field(45,readStateText(row.escrow.inventoryState,locale));
  for(const record of row.escrow.records){const c=record.currency;line('p','chainId '+c.chainId+' / '+(c.contract??'native'));
   field(46,record.amountBaseUnits+' ('+text[59]+'; '+text[60]+' '+c.decimals+')');line('p',text[{held:47,released:48,refunded:49,unknown:50}[record.state]]);field(17,record.blockHash);
  }
 }
 if(row.pending?.state==='ready'){
  const p=row.pending.progress;line('h4',text[51]+': '+readStateText(p.state,locale));if(p.schema==='8415-forward-progress/2')appendCoordinationView(card,p,document,locale);else line('p',text[54]+' · '+text[55]);
  for(const [label,track]of [[52,p.owner],[53,p.holder]]){
   field(label,track.position===null?'—':track.position+'/'+p.scaleEnd);
   if(track.position===null)continue;
   const scale=BigInt(p.scaleEnd),position=BigInt(track.position),end=BigInt(p.knownEnd),percent=n=>Number(n*10000n/scale)/100;
   const bar=document.createElement('div');bar.className='nft-progress-track';bar.setAttribute('aria-label',text[label]+': '+track.position+'/'+p.scaleEnd+'; '+text[56]+' / '+text[57]+' / '+text[58]);
   for(const [kind,size]of [['changed',position],['unchanged',end-position],['untraded',scale-end]]){const span=document.createElement('span');span.className='nft-progress-'+kind;span.style.width=percent(size)+'%';bar.append(span);}
   const marker=document.createElement('span');marker.className='nft-progress-marker';marker.style.left=percent(position)+'%';marker.setAttribute('aria-hidden','true');bar.append(marker);card.append(bar);
  }
 }
}
