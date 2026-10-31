import {projectCoordination} from '../server/coordination-projection.mjs';
/** Actual DOM handler -> AccountAuthClient -> loopback HTTP -> auth service/store.
 * DOM and trusted chain reader are synthetic; no browser automation, real account,
 * physical device, transaction signing, external RPC or deployed acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createAuthService} from '../server/auth-service.mjs';
import {MemoryCredentialStore} from '../server/store.mjs';
import {hashPassword} from '../server/crypto.mjs';
import {AccountAuthClient} from '../web/account-auth.mjs';
import {mountNftBrowser} from '../web/nft-browser.mjs';
import {mountFundsPanel} from '../web/funds-panel.mjs';
import {mountForwardProgress} from '../web/forward-progress-panel.mjs';
const h=n=>'0x'+n.toString(16).padStart(64,'0'),a=n=>'0x'+(100-n).toString(16).padStart(40,'0');
const password='synthetic-v3-assembly-only',passwordHash=await hashPassword(password);
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
class Node{
 style={};children=[];handlers=new Map();disabled=false;hidden=false;value='';textContent='';
 setAttribute(){} append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;this.textContent='';} addEventListener(k,f){this.handlers.set(k,[...(this.handlers.get(k)??[]),f]);}
 async emit(k,event={}){for(const f of this.handlers.get(k)??[])await f({type:k,...event});}
}
function observed(){
 const asset={chainId:560048n,contract:a(50),tokenId:7n},blockHash=h(10),sequenceId=h(1),revision=2n,blockNumber=10n;
 return {snapshot:{asset,sequenceId,revision,blockNumber,blockHash,initialOccurrenceId:h(100),initialHolder:a(0),
  legs:Array.from({length:8},(_,i)=>({id:h(200+i),predecessorId:i?h(199+i):null,buyerOccurrenceId:h(101+i),seller:a(i),buyer:a(i+1),termsHash:h(300+i),control:{controlId:h(400+i),acceptanceHash:h(500+i)},outcome:'active'}))},
  evidence:{kind:'bound',asset,sequenceId,revision,blockNumber,blockHash,owner:{occurrenceId:h(108),account:a(8)},admittedHolder:{occurrenceId:h(106),account:a(6)},protocolFinality:false},ownOccurrenceId:h(106),historical:[]};
}
async function fixture(t,{enabled=true,funds=false,nft=false,nftDetails=false,coordination=false}={}){
 const registration={version:1,email:'synthetic@example.invalid',verifiedAt:1};
 const store=new MemoryCredentialStore({'fixture:owner':{registration},'@registration:fixture':{version:1,records:[{username:'owner',email:registration.email,verifiedAt:1}]}});
 let handler,gate=null,started=defer(),reads=0;const requests=[];
 const server=createServer((req,res)=>{requests.push(req.url);handler(req,res);});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const origin='http://127.0.0.1:'+server.address().port;
 handler=createAuthService({origin,tenant:'fixture',store,nftInventoryReader:nft?{readForPrincipal:async context=>({schema:'8415-authoritative-nft-inventory/1',scope:{...context.principal},readId:context.readId,observedAt:Date.now()-1,validUntil:Date.now()+60000,inventoryState:'complete',records:[{chainId:'560048',contract:a(50),tokenId:'9007199254740993',standard:'ERC-721',balanceRaw:'1',blockNumber:'0xa',blockHash:h(10),metadata:{state:'unavailable',name:null,description:null,imageUrl:null},native:nftDetails?{state:'ready',registerId:h(20),verificationProfile:null,entry:{version:'1',effectiveAt:'1',supersededAt:'0',recordCommitment:h(21),previousCommitment:'0x'+'0'.repeat(64),registryReference:h(22)},instant:'10',finality:false,gap:{state:'none'},settlement:{state:'none',settlementId:null}}:{state:'unavailable'},escrow:nftDetails?{state:'ready',inventoryState:'complete',records:[{reservationId:'principle-one',currency:{chainId:'560048',kind:'native',contract:null,decimals:18},amountBaseUnits:'300',state:'released',blockHash:h(10)}]}:{state:'unavailable'},pending:{state:'unavailable'}}]})}:null, fundsReader: funds ? {readForPrincipal:async context=>({schema:'8415-authoritative-funds/1',scope:{...context.principal},readId:context.readId,observedAt:Date.now()-1,validUntil:Date.now()+60000,inventoryState:'complete',currencies:[['native',null,18,'70000000000000000000','30000000000000000000'],['erc20',a(60),6,'1250000','250000']].map(([kind,contract,decimals,balanceBaseUnits,amountBaseUnits])=>{const currency={chainId:'560048',kind,contract,decimals};return {currency,state:'ready',balanceBasis:'wallet-liquid',balanceBaseUnits,blockHash:h(10),escrowState:'complete',escrows:[{kind:'financial-principal',reservationId:'reservation-'+kind,nftId:'nft-reference-one',currency,amountBaseUnits,state:'held',blockHash:h(10)}]};})})} : null, accounts:[{username:'owner',passwordHash,wallets:[{account:a(6),chainId:'560048'}]}],
  forwardProgressReader:enabled?{readForPrincipal:async input=>{assert.equal(input.principal.account,a(6));reads++;started.resolve();if(gate)await gate.promise;return observed();},validateMilestone:async()=>true,...(coordination?{readCoordination:async context=>{const s=observed();const payments=s.snapshot.legs.map(leg=>({sequenceId:s.snapshot.sequenceId,legId:leg.id,amount:100n,state:'funded',payer:a(6),payee:a(5)}));return {...context,view:projectCoordination({...s,payments})};}}:{})}:null});
 const jar=new Map();const client=new AccountAuthClient({origin,tenant:'fixture',fetcher:async(url,input)=>{
  const response=await fetch(url,{...input,headers:{...input.headers,Origin:origin,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});
  for(const cookie of response.headers.getSetCookie()){const [k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}return response;
 }});
 const auth=await client.adapter('password',{username:'owner',password}).authenticate({account:a(6),chainId:'560048'},null);
 let session={...auth,serverId:auth.id},revision=0;const listeners=[];
 const login={assert(binding){if(!session)throw Error('LOGIN_REQUIRED');if(binding&&binding.revision!==revision)throw Error('LOGIN_CONTEXT_CHANGED');return session;},capture(){this.assert();return {revision};},async check(){this.assert();},subscribe:f=>listeners.push(f)};
 const root=new Node(),document=new Node();Object.assign(document,{visibilityState:'visible',documentElement:{lang:'en'},createElement:()=>new Node(),querySelector:()=>null,getElementById:()=>null});
 const old={document:globalThis.document,history:globalThis.history,addEventListener:globalThis.addEventListener};
 globalThis.document=document;globalThis.history={state:{walletPage:'linked'}};globalThis.addEventListener=()=>{};
 t.after(()=>{for(const [k,v]of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}});
 const input={asset:{chainId:'560048',contract:a(50),tokenId:'7'},sequenceId:h(1)};
 const account=await client.account();
 mountForwardProgress({root,login,clientFor:()=>session?client:null,available:()=>account.forwardProgressAvailable,selection:()=>input});
 const [title,button,output]=root.children[0].children;
 return {button,output,document,client,input,requests,login,account,reads:()=>reads,started:()=>started.promise,
  hold(){gate=defer();return()=>gate.resolve();},
  switchContext(kind){revision++;if(kind==='logout')session=null;else session={...session,[kind==='chain'?'chainId':'account']:kind==='chain'?'1':a(7)};listeners.forEach(f=>f(session));}};
}
test('V3 mounted progress read reaches real authenticated HTTP and privacy-safe durable DONE',async t=>{
 const f=await fixture(t);assert.equal(f.button.disabled,false);await f.button.emit('click');
 assert.equal(f.reads(),1);assert.match(f.output.textContent,/DONE/);assert.match(f.output.textContent,/8\/9/);assert.match(f.output.textContent,/6\/9/);
 assert.ok(f.requests.includes('/auth/assets/forward-progress'));assert.doesNotMatch(f.output.textContent,/0x[0-9a-f]{40}/i);
 assert.equal(f.requests.filter(p=>/execute|submit|send|sign|authorize/.test(p)).length,0);
});
for(const context of ['logout','account','chain'])test(`V3 HTTP response after ${context} switch cannot repaint the old owner view`,async t=>{
 const f=await fixture(t),release=f.hold(),pending=f.button.emit('click');await f.started();f.switchContext(context);release();await pending;
 assert.doesNotMatch(f.output.textContent,/DONE|8\/9/);assert.equal(f.reads(),1);
});
test('V3 leaving linked page while HTTP is in flight discards late result and repeated click',async t=>{
 const f=await fixture(t),release=f.hold(),pending=f.button.emit('click');await f.started();await f.button.emit('click');
 await f.document.emit('wallet:page',{detail:'overview'});release();await pending;
 assert.equal(f.reads(),1);assert.doesNotMatch(f.output.textContent,/DONE|8\/9/);
});
test('missing configured forward runtime is inert and direct API fails closed, not a fake empty inventory',async t=>{
 const f=await fixture(t,{enabled:false});assert.equal(f.button.disabled,true);await f.button.emit('click');assert.equal(f.reads(),0);
 assert.equal(f.requests.filter(p=>p==='/auth/assets/forward-progress').length,0);
 await assert.rejects(f.client.readForwardProgress(f.input),/NOT_ENABLED/);assert.doesNotMatch(f.output.textContent,/DONE|empty|zero/i);
});

test('V3 funds DOM handler reads actual authenticated HTTP multi-currency principal projection',async t=>{
 const f=await fixture(t,{funds:true}),root=new Node();
 const panel=mountFundsPanel({document:f.document,root,login:f.login,clientFor:()=>f.client,available:()=>f.account.fundsAvailable,window:{history:{state:{walletPage:'overview'}},setTimeout:()=>1,clearTimeout(){},addEventListener(){}}});
 await panel.load.emit('click');
 const text=node=>node.textContent+' '+node.children.map(text).join(' ');
 assert.ok(f.requests.includes('/auth/assets/funds'));assert.match(text(panel.output),/100\.000000000000000000/);assert.match(text(panel.output),/1\.500000/);
 assert.match(text(panel.nftOutput),/nft-reference-one/);assert.doesNotMatch(text(panel.nftOutput),/reservation-native|owner|payer|payee/);
 assert.equal(f.requests.filter(path=>/execute|submit|send|sign|authorize/.test(path)).length,0);
});

test('V3 inventory DOM refresh traverses actual authenticated HTTP without simulated holdings fallback',async t=>{
 const f=await fixture(t,{nft:true}),root=new Node();const panel=mountNftBrowser({document:f.document,root,login:f.login,clientFor:()=>f.client,available:()=>f.account.nftInventoryAvailable,window:{setTimeout:()=>1,clearTimeout(){},addEventListener(){}}});
 await f.document.emit('wallet:page',{detail:'nft'});await panel.load.emit('click');
 const text=node=>node.textContent+' '+node.children.map(text).join(' ');assert.ok(f.requests.includes('/auth/assets/nft-inventory'));assert.match(text(panel.output),/9007199254740993/);assert.match(text(panel.output),/Native projection unavailable/);assert.doesNotMatch(text(panel.output),/0x[0-9a-f]{39}5e/);
 assert.equal(f.requests.filter(path=>/execute|submit|send|sign|authorize/.test(path)).length,0);
});

test('V3 inventory HTTP ready native and principal DTOs reach actual per-NFT detail renderer',async t=>{
 const f=await fixture(t,{nft:true,nftDetails:true}),root=new Node();const panel=mountNftBrowser({document:f.document,root,login:f.login,clientFor:()=>f.client,available:()=>f.account.nftInventoryAvailable,window:{setTimeout:()=>1,clearTimeout(){},addEventListener(){}}});
 await f.document.emit('wallet:page',{detail:'nft'});await panel.load.emit('click');const text=node=>node.textContent+' '+node.children.map(text).join(' ');
 assert.match(text(panel.output),/Entry version: 1/);assert.match(text(panel.output),/Provisional/);assert.match(text(panel.output),/Original principal: 300/);assert.match(text(panel.output),/Released/);assert.match(text(panel.output),/Pending progress unavailable/);
 assert.equal(f.requests.filter(path=>/execute|submit|send|sign|authorize/.test(path)).length,0);
});

test('V3 actual mounted HTTP coordination shows own funds source instead of unevaluated placeholder',async t=>{
 const f=await fixture(t,{coordination:true});await f.button.emit('click');assert.match(f.output.textContent,/Current coordination snapshot/);assert.match(f.output.textContent,/Funds: Observed/);assert.match(f.output.textContent,/Incoming leg/);assert.match(f.output.textContent,/Amount \(base units\) 100/);assert.match(f.output.textContent,/Rollback: Not applicable/);assert.doesNotMatch(f.output.textContent,/Funds not evaluated|0x[0-9a-f]{40}\b/);assert.equal(f.requests.filter(path=>/execute|submit|send|sign|authorize/.test(path)).length,0);
});
