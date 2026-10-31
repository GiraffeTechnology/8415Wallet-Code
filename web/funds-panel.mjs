import {readStateText} from './locales/read-states.mjs';
/** Human read-only funds UI. Only the authenticated client's strict projection is accepted. */
import {FUNDS_TEXT} from './locales/funds-panel.mjs';
export function fundsDisplayAmount(value,decimals){
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>=1n<<256n||!Number.isInteger(decimals)||decimals<0||decimals>255)throw Error('FUNDS_DISPLAY_REFUSED');
 const amount=BigInt(value),unit=10n**BigInt(decimals);
 return decimals===0?amount.toString():(amount/unit).toString()+'.'+(amount%unit).toString().padStart(decimals,'0');
}
export function mountFundsPanel({document,root,login,clientFor,available,locale=()=>document.documentElement.lang,now=Date.now,window=globalThis}){
 if(!root)return null;
 const section=document.createElement('section'),nftSection=document.createElement('section');
 section.className='card funds-panel';section.setAttribute('data-page','overview');nftSection.className='card funds-nft-panel';nftSection.setAttribute('data-page','nft');
 const heading=document.createElement('h2'),load=document.createElement('button'),cancel=document.createElement('button'),status=document.createElement('p'),output=document.createElement('div'),note=document.createElement('p');
 const nftHeading=document.createElement('h2'),nftOutput=document.createElement('div'),nftNote=document.createElement('p');
 load.type=cancel.type='button';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 section.append(heading,load,cancel,status,output,note);nftSection.append(nftHeading,nftOutput,nftNote);root.append(section,nftSection);
 let epoch=0,pending=false,snapshot=null,error=false,page=window.history?.state?.walletPage??'overview',expiryTimer=null;
 const words=()=>FUNDS_TEXT[locale()]??FUNDS_TEXT.en;
 const clearTimer=()=>{if(expiryTimer!==null)window.clearTimeout(expiryTimer);expiryTimer=null;};
 const usable=()=>{try{login.assert();return available()===true&&clientFor()!==null&&page==='overview'&&document.visibilityState!=='hidden';}catch{return false;}};
 const clear=()=>{epoch++;pending=false;snapshot=null;error=false;clearTimer();draw();};
 const appendText=(parent,tag,text)=>{const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;};
 const currencyName=currency=>'chainId '+currency.chainId+' / '+(currency.kind==='native'?'native':currency.contract);
 const scheduleExpiry=()=>{clearTimer();if(snapshot?.validUntil!==null&&snapshot?.validUntil!==undefined){
  const delay=snapshot.validUntil-now();if(delay>0)expiryTimer=window.setTimeout(()=>{expiryTimer=null;draw();scheduleExpiry();},Math.min(delay,2147483647));
 }};
 function draw(){
  const text=words();section.hidden=page!=='overview';nftSection.hidden=page!=='nft';heading.textContent=text[0];load.textContent=text[1];cancel.textContent=text[2];note.textContent=text[14];nftHeading.textContent=text[10];nftNote.textContent=text[18];
  load.disabled=pending||!usable();cancel.hidden=!pending;cancel.disabled=!pending;
  const expired=snapshot?.validUntil!==null&&snapshot?.validUntil!==undefined&&snapshot.validUntil<=now();
  status.textContent=pending?text[4]:error?text[5]:!snapshot?text[3]:expired?text[19]:text[16]+': '+readStateText(snapshot.state,locale());
  output.replaceChildren();nftOutput.replaceChildren();
  if(!snapshot||expired){appendText(nftOutput,'p',expired?text[19]:text[3]);return;}
  const groups=new Map();let recordsUnavailable=false;
  const group=ref=>{if(!groups.has(ref))groups.set(ref,{summaries:[],records:[]});return groups.get(ref);};
  for(const row of snapshot.currencies){
   const card=document.createElement('article');card.className='funds-currency';appendText(card,'h3',text[6]+': '+currencyName(row.currency));
   appendText(card,'p',text[16]+': '+readStateText(row.state,locale()));
   for(const [label,key]of [[7,'totalBaseUnits'],[8,'unreleasedBaseUnits'],[9,'availableBaseUnits']]){
    appendText(card,'p',text[label]+': '+(row.state==='ready'&&row[key]!==null?fundsDisplayAmount(row[key],row.currency.decimals):text[12]));
   }
   if(row.blockHash)appendText(card,'p',text[13]+': '+row.blockHash);
   output.append(card);
   for(const escrow of row.nftEscrows)group(escrow.nftId).summaries.push({currency:row.currency,amount:escrow.unreleasedBaseUnits});
   if(Array.isArray(row.principalRecords)){for(const record of row.principalRecords)group(record.nftId).records.push({currency:row.currency,...record});}
   else recordsUnavailable=true;
  }
  if(!snapshot.currencies.length)appendText(output,'p',text[3]);
  if(!groups.size)appendText(nftOutput,'p',snapshot.state==='ready'&&snapshot.inventoryState==='complete'&&snapshot.currencies.every(x=>x.state==='ready')?text[11]:text[12]);
  if(recordsUnavailable)appendText(nftOutput,'p',text[20]);
  for(const [reference,records]of groups){const card=document.createElement('article');card.className='funds-currency';appendText(card,'h3',text[15]+': '+reference);
   for(const row of records.summaries)appendText(card,'p',currencyName(row.currency)+' — '+text[8]+': '+fundsDisplayAmount(row.amount,row.currency.decimals));
   for(const row of records.records){const state={held:22,released:23,refunded:24,unknown:25}[row.state];
    appendText(card,'p',currencyName(row.currency)+' — '+text[21]+': '+fundsDisplayAmount(row.amountBaseUnits,row.currency.decimals)+' — '+text[state??25]);
    appendText(card,'p',text[13]+': '+row.blockHash);
   }nftOutput.append(card);}
 }
 async function read(){
  if(pending||!usable())return;
  const current=++epoch,client=clientFor(),binding=login.capture();pending=true;error=false;draw();
  try{
   await login.check();const session=login.assert(binding);
   if(current!==epoch||!usable()||client!==clientFor())return;
   const result=await client.readFunds();login.assert(binding);
   if(current!==epoch||!usable()||client!==clientFor())return;
   if(result.scope.account.toLowerCase()!==session.account.toLowerCase()||result.scope.chainId!==session.chainId||result.scope.tenant!==session.tenant||result.scope.origin!==session.origin)throw Error('FUNDS_CONTEXT_CHANGED');
   snapshot=result;error=false;scheduleExpiry();
  }catch{if(current===epoch){snapshot=null;error=true;clearTimer();}}
  finally{if(current===epoch){pending=false;draw();}}
 }
 load.addEventListener('click',read);cancel.addEventListener('click',clear);
 login.subscribe(clear);
 document.addEventListener('wallet:page',event=>{if(event.detail!==page&&pending)clear();page=event.detail;draw();});
 for(const event of ['wallet:account-features','wallet:summary-stale','visibilitychange'])document.addEventListener(event,clear);
 document.querySelector('[data-ui-locale-select]')?.addEventListener('change',draw);
 window.addEventListener?.('pagehide',clear);
 draw();return {section,nftSection,load,cancel,status,output,nftOutput,clear,read};
}
