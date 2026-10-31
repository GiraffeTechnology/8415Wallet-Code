/** Synthetic DOM from exact read records; no account discovery, RPC or media fetch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nftSnapshot,sortNftSnapshots,mountNftBrowser,safeThumbnailUrl} from '../web/nft-browser.mjs';
import {NFT_BROWSER_TEXT} from '../web/locales/nft-browser.mjs';
const account='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40),contract='0x'+'3'.repeat(40),session={account,chainId:'1'};
const source=(tokenId='1',balanceRaw='1')=>({account,chainId:'1',contract,tokenId,balanceRaw,standard:'ERC-721',owner:other,blockNumber:'0x1',blockHash:'0x'+'4'.repeat(64)});
class Node{style={};children=[];handlers=new Map();textContent='';hidden=false;value='';className='';setAttribute(){}removeAttribute(k){delete this[k];}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;this.textContent='';}addEventListener(k,f){this.handlers.set(k,[...(this.handlers.get(k)??[]),f]);}async emit(k,event={}){for(const fn of this.handlers.get(k)??[])await fn({type:k,...event});}}
function fixture({client=null,enabled=false,imageOrigins=[]}={}){const document=new Node(),root=new Node(),listeners=[];let current={...session,tenant:'fixture',origin:'https://example.invalid'},revision=0,clock=100;
 Object.assign(document,{documentElement:{lang:'en'},createElement:()=>new Node(),querySelector:()=>null});
 const login={assert:binding=>{if(!current||binding&&binding.revision!==revision)throw Error('LOGIN_REQUIRED');return current;},capture:()=>({revision}),check:async()=>{},subscribe:fn=>listeners.push(fn)};
 const mounted=mountNftBrowser({document,root,login,clientFor:()=>client,available:()=>enabled,imageOrigins:()=>imageOrigins,now:()=>clock,window:{setTimeout:()=>1,clearTimeout(){},addEventListener(){}}});
 return {document,...mounted,clock:value=>{clock=value;},change(next){revision++;current=next;listeners.forEach(f=>f(next));}};
}
function text(node){return node.textContent+' '+node.children.map(text).join(' ');}
test('snapshot drops owner and arbitrary metadata and refuses wrong account/chain',()=>{
 const result=nftSnapshot({...source(),image:'javascript:evil()',name:'<img>'},session);
 assert.equal('owner'in result,false);assert.equal('image'in result,false);assert.equal('name'in result,false);assert.doesNotMatch(JSON.stringify(result),new RegExp(other));
 for(const patch of [{chainId:'8453'},{account:other},{tokenId:'-1'},{standard:'unverified'},{contract:'javascript:evil'}])assert.throws(()=>nftSnapshot({...source(),...patch},session));
});
test('sort is lossless and categories do not fabricate underlying asset classifications',()=>{
 const entries=[nftSnapshot(source('9007199254740993123'),session),nftSnapshot(source('2'),session),nftSnapshot({...source('3','10'),standard:'ERC-1155'},session)];
 assert.deepEqual(sortNftSnapshots(entries).map(x=>x.tokenId),['2','3','9007199254740993123']);
 assert.deepEqual(sortNftSnapshots(entries,{category:'ERC-1155',sort:'balanceRaw',direction:'descending'}).map(x=>x.tokenId),['3']);
 assert.throws(()=>sortNftSnapshots(entries,{category:'commodities'}));
});
test('mounted list and thumbnails retain view/sort choice across navigation, clear account history, never fetch media',()=>{
 const f=fixture();f.document.emit('wallet:page',{detail:'nft'});f.document.emit('wallet:nft-view',{detail:source('20')});f.document.emit('wallet:nft-view',{detail:source('2')});
 assert.equal(f.output.children.length,2);assert.match(text(f.output.children[0]),/#2/);
 f.widgets.view.select.value='thumbnails';f.widgets.view.select.emit('change');f.widgets.direction.select.value='descending';f.widgets.direction.select.emit('change');
 assert.match(f.output.className,/grid/);assert.match(text(f.output.children[0]),/#20/);assert.match(text(f.output),/Artwork and metadata unavailable/);assert.doesNotMatch(text(f.output),new RegExp(other));
 f.document.emit('wallet:page',{detail:'overview'});f.document.emit('wallet:page',{detail:'nft'});assert.equal(f.widgets.view.select.value,'thumbnails');
 f.change({...session,account:other});assert.equal(f.output.children.length,0);assert.match(text(f.output),/No verified/);
 f.receive(source());assert.equal(f.output.children.length,0);
});
test('selection edits do not invent an empty holdings result; source invalidation and logout clear cache',()=>{
 const f=fixture();f.receive(source());f.document.emit('wallet:nft-view',{detail:null});assert.equal(f.output.children.length,1);
 f.document.emit('wallet:summary-stale',{detail:'external'});assert.equal(f.output.children.length,0);f.receive(source());f.change(null);assert.equal(f.output.children.length,0);
});
test('all existing six locales have every authored label and external read strips neighboring owner before DOM/event',()=>{
 assert.deepEqual(Object.keys(NFT_BROWSER_TEXT).sort(),['en','es','fr','ja','zh-Hans','zh-Hant']);
 for(const labels of Object.values(NFT_BROWSER_TEXT))assert.ok(labels.length===64&&labels.every(s=>typeof s==='string'&&s.length));
 const code=readFileSync(new URL('../web/external-assets.mjs',import.meta.url),'utf8');assert.match(code,/owner: _privateOwner, \.\.\.snapshot/);assert.match(code,/format\(snapshot\)/);
});

const inventory=()=>({schema:'8415-nft-inventory/1',scope:{...session,tenant:'fixture',origin:'https://example.invalid'},readId:'a'.repeat(32),state:'ready',inventoryState:'complete',observedAt:1,validUntil:1000,records:[{...nftSnapshot(source(),session),metadata:{state:'available',name:'<script>untrusted metadata</script>',description:'Exact metadata text',imageUrl:'https://example.invalid/image.png'},native:{state:'unavailable'},escrow:{state:'unavailable'},pending:{state:'unavailable'}}]});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
test('authoritative inventory refresh binds owner, displays safe metadata text, and never guesses native/escrow/Pending details',async()=>{
 let reads=0;const f=fixture({client:{readNftInventory:async()=>{reads++;return inventory();}},enabled:true});await f.document.emit('wallet:page',{detail:'nft'});await f.load.emit('click');
 assert.equal(reads,1);assert.match(text(f.output),/untrusted metadata/);assert.match(text(f.output),/Native projection unavailable/);assert.match(text(f.output),/Pending progress unavailable/);assert.equal(f.output.children.length,1);
 f.clock(1001);await f.document.emit('wallet:page',{detail:'nft'});assert.equal(f.output.children.length,0);assert.doesNotMatch(text(f.output),/untrusted metadata|complete snapshot/);
});
for(const kind of ['cancel','logout','chain','page'])test(`late authoritative inventory after ${kind} cannot refill prior records`,async()=>{
 const gate=deferred(),f=fixture({client:{readNftInventory:()=>gate.promise},enabled:true});await f.document.emit('wallet:page',{detail:'nft'});const pending=f.load.emit('click');await new Promise(r=>setImmediate(r));
 if(kind==='cancel')await f.cancel.emit('click');else if(kind==='page')await f.document.emit('wallet:page',{detail:'overview'});else f.change(kind==='logout'?null:{...session,chainId:'8453'});gate.resolve(inventory());await pending;assert.equal(f.output.children.length,0);
});
test('missing inventory capability is inert and partial inventory is not labeled complete',async()=>{
 let reads=0;const none=fixture({client:{readNftInventory:async()=>{reads++;return inventory();}}});await none.document.emit('wallet:page',{detail:'nft'});await none.load.emit('click');assert.equal(reads,0);
 const value=inventory();value.state='partial';value.inventoryState='partial';value.records=[];const f=fixture({client:{readNftInventory:async()=>value},enabled:true});await f.document.emit('wallet:page',{detail:'nft'});await f.load.emit('click');assert.doesNotMatch(text(f.output),/complete snapshot/);
});

test('ready per-NFT native, principal and full-chain Pending details render their own validated evidence',async()=>{
 const value=inventory(),row=value.records[0],hash='0x'+'4'.repeat(64);
 row.native={state:'ready',registerId:hash,verificationProfile:null,entry:{version:'1',effectiveAt:'1',supersededAt:'0',recordCommitment:hash,previousCommitment:'0x'+'0'.repeat(64),registryReference:hash},instant:'10',finality:false,gap:{state:'none'},settlement:{state:'none',settlementId:null}};
 row.escrow={state:'ready',inventoryState:'complete',records:[{reservationId:'principal-one',currency:{chainId:'1',kind:'native',contract:null,decimals:18},amountBaseUnits:'300',state:'released',blockHash:hash}]};
 const track=position=>({state:'observed',position,changedThrough:position,unchangedThrough:'20',untradedThrough:'21',ratio:{numerator:position,denominator:'21'}});
 row.pending={state:'ready',progress:{schema:'8415-forward-progress/1',asset:{chainId:'1',contract,tokenId:'1'},sequenceId:hash,userPosition:'6',sourceRevision:'2',blockNumber:'1',blockHash:hash,knownEnd:'20',scaleEnd:'21',state:'DONE',owner:track('20'),holder:track('6'),funds:{state:'not-evaluated'},rollback:{state:'not-evaluated'},protocolFinality:false,commercialExecution:'not-evaluated',canExecute:false,recordRevision:'1',frozen:true}};
 const {validateNftDetails}=await import('../web/nft-details-client.mjs');validateNftDetails(row);
 const f=fixture({client:{readNftInventory:async()=>value},enabled:true});await f.document.emit('wallet:page',{detail:'nft'});await f.load.emit('click');
 const content=text(f.output);for(const expected of ['Register:','Entry version: 1','Provisional','Released','Done','20/21','6/21','Funds not evaluated','Rollback not evaluated'])assert.ok(content.includes(expected),expected);
 const card=f.output.children[0],bars=card.children.filter(n=>n.className==='nft-progress-track');assert.equal(bars.length,2);assert.equal(bars[0].children[0].style.width,'95.23%');assert.equal(bars[0].children[2].style.width,'4.76%');assert.doesNotMatch(content,new RegExp(other));
});

test('external thumbnail requires explicit load and has no referrer or cross-origin credentials',async()=>{
 const value=inventory();value.records[0].metadata.imageUrl='https://media.example.com/nft.png';
 const f=fixture({client:{readNftInventory:async()=>value},enabled:true,imageOrigins:['https://media.example.com']});await f.document.emit('wallet:page',{detail:'nft'});await f.load.emit('click');f.widgets.view.select.value='thumbnails';await f.widgets.view.select.emit('change');
 const box=f.output.children[0].children.find(n=>n.className==='nft-browser-thumbnail');assert.equal(box.children.length,1);assert.equal(box.children[0].src,undefined);await box.children[0].emit('click');const image=box.children[0];assert.equal(image.src,value.records[0].metadata.imageUrl);assert.equal(image.crossOrigin,'anonymous');assert.equal(image.referrerPolicy,'no-referrer');assert.equal(image.alt,'<script>untrusted metadata</script>');await image.emit('error');assert.equal(image.src,undefined);assert.match(box.textContent,/unavailable/);
});
for(const kind of ['logout','chain','page'])test(`loaded thumbnail is revoked on ${kind}`,async()=>{
 const value=inventory();value.records[0].metadata.imageUrl='https://media.example.com/nft.png';const f=fixture({client:{readNftInventory:async()=>value},enabled:true,imageOrigins:['https://media.example.com']});await f.document.emit('wallet:page',{detail:'nft'});await f.load.emit('click');f.widgets.view.select.value='thumbnails';await f.widgets.view.select.emit('change');const box=f.output.children[0].children.find(n=>n.className==='nft-browser-thumbnail');const button=box.children[0];await button.emit('click');const image=box.children[0];if(kind==='page')await f.document.emit('wallet:page',{detail:'overview'});else f.change(kind==='logout'?null:{...session,chainId:'8453'});assert.equal(image.src,undefined);await button.emit('click');assert.equal(image.src,undefined);
});
test('thumbnail URL policy rejects private hosts credentials query and active schemes',()=>{
 for(const url of ['http://media.example.com/x','data:image/png;base64,a','javascript:alert(1)','https://127.0.0.1/x','https://[::1]/x','https://0x7f000001/x','https://host.local/x','https://localhost/x','https://host.internal/x','https://host.lan/x','https://u:p@media.example.com/x','https://media.example.com/x?wallet=abc','https://media.example.com/x#id','https://media.example.com:444/x','https://wallet.example.com/x'])assert.equal(safeThumbnailUrl(url,'https://wallet.example.com'),false,url);
 assert.equal(safeThumbnailUrl('https://media.example.com/x.png','https://wallet.example.com'),true);
});
test('metadata cannot approve its image origin and missing capability is explained',async()=>{
 const value=inventory();value.records[0].metadata.imageUrl='https://media.example.com/nft.png';const f=fixture({client:{readNftInventory:async()=>value},enabled:true});await f.document.emit('wallet:page',{detail:'nft'});await f.load.emit('click');f.widgets.view.select.value='thumbnails';await f.widgets.view.select.emit('change');const box=f.output.children[0].children.find(n=>n.className==='nft-browser-thumbnail');assert.match(text(box),/origin not enabled/);assert.equal(box.children.some(n=>n.type==='button'||n.src),false);
});

import {READ_STATE_TEXT} from '../web/locales/read-states.mjs';
test('new NFT inventory and escrow states follow six mounted locales while metadata stays literal',async()=>{
 const value=inventory();value.records[0].escrow={state:'ready',inventoryState:'partial',records:[]};
 const f=fixture({client:{readNftInventory:async()=>value},enabled:true});await f.document.emit('wallet:page',{detail:'nft'});await f.load.emit('click');
 for(const [locale,labels]of Object.entries(READ_STATE_TEXT)){
  f.document.documentElement.lang=locale;await f.document.emit('wallet:page',{detail:'nft'});
  assert.ok(text(f.section).includes(labels.complete));assert.ok(text(f.output).includes(labels.partial));assert.ok(text(f.output).includes('<script>untrusted metadata</script>'));
 }
});
