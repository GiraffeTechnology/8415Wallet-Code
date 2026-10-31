/** Synthetic DOM regression only; no device, provider, signer or runtime acceptance. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {mountAssetControls} from '../web/asset-control-ui.mjs';
import {setLocale} from '../web/i18n.mjs';
import {READ_STATE_TEXT,readStateText} from '../web/locales/read-states.mjs';
class Node {
 children=[];style={};attrs={};handlers={};textContent='';hidden=false;
 constructor(tag='div'){this.tag=tag;}
 setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
 append(...v){this.children.push(...v);}replaceChildren(...v){this.children=v;}
 addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}emit(k){for(const fn of this.handlers[k]??[])fn();}
 querySelectorAll(){return this.children.flatMap(n=>[...(['button','select'].includes(n.tag)?[n]:[]),...n.querySelectorAll()]);}
}
const walk=n=>[n,...n.children.flatMap(walk)];
const flush=()=>new Promise(r=>setImmediate(r));
function fixture(read){const host=new Node(),document={createElement:tag=>new Node(tag),createTextNode:text=>Object.assign(new Node('text'),{textContent:text}),querySelectorAll:()=>[]};let changes=0;const login={assert:()=>({}),capture:()=>({}),subscribe:()=>()=>{}};const client={read:read??(async()=>({canChange:true,view:{scope:{chainId:'1'},entries:[]},catalog:{inventoryComplete:true,branches:[],entries:[]}})),change:async()=>{changes++;}};return {host,document,changes:()=>changes,panel:mountAssetControls({document,walletLogin:login,host,getClient:()=>client})};}
test('mounted saved and draft ON/OFF have independent state styling and localized accessible name',async()=>{
 const f=fixture();f.panel.show();await flush();const choice=walk(f.host).find(n=>n.tag==='select');assert.ok(choice);
 assert.equal(choice.attrs['data-state'],'ON');assert.equal(choice.disabled,false);
 const saved=walk(f.host).find(n=>n.className==='asset-control-state');assert.equal(saved.attrs['data-state'],'ON');
 const name=walk(f.host).find(n=>n.id===choice.attrs['aria-labelledby']);assert.ok(name);
 const labels=[];for(const locale of Object.keys(READ_STATE_TEXT)){setLocale(locale,{document:f.document,persist:false});labels.push(name.textContent);assert.ok(name.textContent);assert.equal(choice.attrs['aria-label'],undefined);}
 assert.equal(new Set(labels).size,6);
 choice.value='OFF';choice.emit('change');assert.equal(choice.attrs['data-state'],'OFF');assert.equal(saved.attrs['data-state'],'ON');assert.equal(f.changes(),0);
 const css=readFileSync(new URL('../web/wallet.css',import.meta.url),'utf8');assert.match(css,/asset-control-choice\[data-state="ON"\].*background:var\(--accent/);assert.match(css,/asset-control-choice\[data-state="OFF"\].*background:#aaa/);
 f.panel.destroy();setLocale('en',{document:f.document,persist:false});
});
test('late policy read after hide cannot restore control or saved-state display',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.panel.show();f.panel.hide();resolve({canChange:true,view:{scope:{chainId:'1'},entries:[]},catalog:{inventoryComplete:true,branches:[],entries:[]}});await flush();assert.equal(walk(f.host).filter(n=>n.tag==='select').length,0);assert.equal(f.changes(),0);f.panel.destroy();
});
test('authored dynamic read states cover six locales with English fallback and preserve unknown external text',()=>{
 assert.equal(Object.keys(READ_STATE_TEXT).length,6);for(const [locale,labels]of Object.entries(READ_STATE_TEXT))for(const [key,label]of Object.entries(labels)){assert.equal(readStateText(key,locale),label);assert.ok(label);}
 assert.equal(readStateText('partial','unsupported'),'Partial');assert.equal(readStateText('<external signed term>','fr'),'<external signed term>');assert.equal(readStateText('OPEN','ja'),'OPEN');
});
