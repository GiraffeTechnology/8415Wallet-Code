/** Focused human UI composition. Synthetic DOM and account fixtures only. */
import test from 'node:test';import assert from 'node:assert/strict';
import {mountFundsPanel,fundsDisplayAmount} from '../web/funds-panel.mjs';
import {FUNDS_TEXT} from '../web/locales/funds-panel.mjs';
const account='0x'+'1'.repeat(40),scope={tenant:'fixture',origin:'https://example.invalid',account,chainId:'1'};
const currency={chainId:'1',kind:'native',contract:null,decimals:2};
const projection=()=>({schema:'8415-currency-funds/1',scope,readId:'a'.repeat(32),state:'ready',inventoryState:'complete',observedAt:1,validUntil:1000000,
 currencies:[{currency,canExecute:false,state:'ready',reason:null,totalBaseUnits:'100',unreleasedBaseUnits:'30',availableBaseUnits:'70',nftEscrows:[{nftId:'nft-reference-one',unreleasedBaseUnits:'30'}],blockHash:'0x'+'2'.repeat(64)}]});
class Node{children=[];handlers=new Map();textContent='';hidden=false;disabled=false;value='';setAttribute(){}append(...x){this.children.push(...x);}replaceChildren(...x){this.children=x;this.textContent='';}addEventListener(k,f){this.handlers.set(k,[...(this.handlers.get(k)??[]),f]);}async emit(k,event={}){for(const fn of this.handlers.get(k)??[])await fn({type:k,...event});}}
const text=n=>n.textContent+' '+n.children.map(text).join(' ');
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function fixture({client,enabled=true,session=scope}={}){
 let current=session,revision=0,reads=0,clock=100;const listeners=[],document=new Node(),root=new Node();
 Object.assign(document,{visibilityState:'visible',documentElement:{lang:'en'},createElement:()=>new Node(),querySelector:()=>null});
 const login={assert:b=>{if(!current||b&&b.revision!==revision)throw Error('LOGIN_CHANGED');return current;},check:async()=>{},capture:()=>({revision}),subscribe:fn=>listeners.push(fn)};
 const transport=client??{readFunds:async()=>{reads++;return projection();}};
 const window={history:{state:{walletPage:'overview'}},setTimeout:()=>1,clearTimeout(){},addEventListener(){}};
 const panel=mountFundsPanel({document,root,login,clientFor:()=>transport,available:()=>enabled,window,now:()=>clock});
 return {...panel,document,reads:()=>reads,change:s=>{revision++;current=s;listeners.forEach(f=>f(s));},clock:t=>{clock=t;}};
}
test('per-currency total, original NFT escrow and available render losslessly without FX or inferred NFT mapping',async()=>{
 const f=fixture();await f.load.emit('click');assert.equal(f.reads(),1);assert.match(text(f.output),/Total funds: 1\.00/);assert.match(text(f.output),/Unreleased escrow: 0\.30/);assert.match(text(f.output),/Available funds: 0\.70/);
 assert.match(text(f.nftOutput),/NFT reference: nft-reference-one/);assert.doesNotMatch(text(f.nftOutput),/owner|seller|payer|0x1{40}/);
 assert.equal(fundsDisplayAmount('900719925474099312345',3),'900719925474099312.345');
});
for(const reason of ['cancel','logout','chain','account','page'])test(`pending funds response after ${reason} cannot repaint another context`,async()=>{
 const gate=deferred(),f=fixture({client:{readFunds:()=>gate.promise}});const pending=f.load.emit('click');await new Promise(r=>setImmediate(r));
 if(reason==='cancel')await f.cancel.emit('click');else if(reason==='page')await f.document.emit('wallet:page',{detail:'nft'});else f.change(reason==='logout'?null:{...scope,...(reason==='chain'?{chainId:'8453'}:{account:'0x'+'3'.repeat(40)})});
 gate.resolve(projection());await pending;assert.doesNotMatch(text(f.output),/1\.00/);assert.equal(f.output.children.length,0);
});
test('missing funds runtime is inert and never displayed as zero; errors omit private backend text',async()=>{
 const missing=fixture({enabled:false});await missing.load.emit('click');assert.equal(missing.reads(),0);assert.match(text(missing.status),/No verified/);assert.equal(missing.output.children.length,0);
 const failed=fixture({client:{readFunds:async()=>{throw Error('PRIVATE_ENDPOINT_SECRET');}}});await failed.load.emit('click');assert.match(text(failed.status),/unavailable/);assert.doesNotMatch(text(failed.section),/PRIVATE_ENDPOINT/);
});
test('partial inventory and expired observations never claim a complete current inventory',async()=>{
 const partial=projection();partial.state='partial';partial.inventoryState='partial';partial.currencies=[];
 const f=fixture({client:{readFunds:async()=>partial}});await f.load.emit('click');assert.match(text(f.nftOutput),/Unavailable/);assert.doesNotMatch(text(f.nftOutput),/complete snapshot/);
 const ready=fixture();await ready.load.emit('click');ready.clock(1000001);await ready.document.emit('wallet:page',{detail:'overview'});assert.match(text(ready.status),/expired/);assert.equal(ready.output.children.length,0);assert.doesNotMatch(text(ready.nftOutput),/0\.30|nft-reference-one/);await ready.load.emit('click');assert.equal(ready.reads(),2);
});
test('funds UI covers exactly six served locales with every fixed label',()=>{
 assert.deepEqual(Object.keys(FUNDS_TEXT).sort(),['en','es','fr','ja','zh-Hans','zh-Hant']);for(const labels of Object.values(FUNDS_TEXT))assert.ok(labels.length===26&&labels.every(Boolean));
});

test('original principal lifecycle details stay read-only and never imply refund execution',async()=>{
 const value=projection();value.currencies[0].principalRecords=['held','released','refunded','unknown'].map((state,index)=>({reservationId:'ref-'+index,nftId:'nft-reference-one',amountBaseUnits:'30',state,blockHash:'0x'+'2'.repeat(64)}));
 const f=fixture({client:{readFunds:async()=>value}});await f.load.emit('click');
 for(const state of ['Held','Released','Refunded','Outcome unknown'])assert.match(text(f.nftOutput),new RegExp(state));
 assert.match(text(f.nftOutput),/Original principal: 0\.30/);assert.equal(f.nftOutput.children.some(n=>n.tagName==='button'),false);
});

import {READ_STATE_TEXT} from '../web/locales/read-states.mjs';
test('new read-state localization follows mounted funds locale without another read',async()=>{
 const value=projection();value.state='partial';value.currencies[0].state='unavailable';
 const f=fixture({client:{readFunds:async()=>value}});await f.load.emit('click');
 for(const [locale,labels]of Object.entries(READ_STATE_TEXT)){
  f.document.documentElement.lang=locale;await f.document.emit('wallet:page',{detail:'overview'});
  assert.ok(text(f.status).includes(labels.partial));assert.ok(text(f.output).includes(labels.unavailable));assert.doesNotMatch(text(f.output),/Available funds: 0/);
 }
});
