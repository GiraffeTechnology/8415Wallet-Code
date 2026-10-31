import * as identityProjection from '../web/wallet-identity-display.mjs';
import * as identityI18n from '../web/i18n.mjs';
const { default: workspaceCopy, workspaceNarrative } = await import(new URL('../web/locales/workspace.mjs', import.meta.url).href);
const { rendererMessages } = await import(new URL('../web/renderer-messages.mjs', import.meta.url).href);
/** Pure synthetic DOM/login scheduling probe. No provider requests, sockets or browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import vm from 'node:vm';
const root=resolve(import.meta.dirname,'..');
class Element extends EventTarget {
 constructor(tag){super();this.tagName=tag;this.children=[];this.textContent='';this.disabled=false;this.value='';this.style={};}
 append(...nodes){this.children.push(...nodes);if(this.tagName==='select'&&!this.value)this.value=this.children[0]?.value??'';}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(){}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
const drain=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
function workspaceInput(panel){
 const pending=[panel];
 while(pending.length){const node=pending.shift();if(node.tagName==='input'&&node.inputMode==='numeric')return node;pending.push(...(node.children??[]));}
 assert.fail('the actual workspace numeric input must exist');
}
function fixture(){
 const root=new Element('div'),token=new Element('input'),document=new EventTarget(),window=new EventTarget();
 document.visibilityState='visible';document.getElementById=id=>id==='tokenId'?token:root;document.createElement=tag=>new Element(tag);document.createTextNode=text=>({textContent:text});
 const session={account:'0x'+'1'.repeat(40),chainId:'560048',tenant:'xiongan'}, gates=[];
 let checks=0;
 const login={capture:()=>({id:1}),assert:()=>session,subscribe(){},provider:()=>Object.freeze({}),check(){checks++;return checks<=2?new Promise(r=>gates.push(r)):Promise.resolve();}};
 return {root,document,window,login,session,gates,get checks(){return checks;}};
}
for(const kind of ['asset-workspace','hoodi-journey']) test(`${kind}: rapid repeated click cannot leave a stale request holding the UI lock`,async()=>{
 const f=fixture();let source=readFileSync(join(root,`web/${kind}-panel.mjs`),'utf8');
 source=source.replace(/^import[\s\S]*?;\n/gm,'').replace('export function mountAssetWorkspace','function mountAssetWorkspace');
 const context={...identityProjection,...identityI18n,workspaceCopy,workspaceNarrative,rendererMessages,document:f.document,globalThis:f.window,walletLogin:f.login,readAssetWorkspace:async()=>({registerHistory:{state:'not-requested'}}),renderAssetWorkspace:()=> 'synthetic workspace',openHoodiJourneyRead:async()=>({}),compareHoodiReleaseHistory:async()=>({}),renderHoodiReleaseHistory:()=> 'synthetic history'};
 if(kind==='asset-workspace')source+='\nmountAssetWorkspace({root:document.getElementById("wallet-private"),login:walletLogin,getContext:()=>({wallet:{reader:{source:{chainId:560048n}}},tokenId:1n})});';
 // Stable wallet identity matters for publication; the fixture below supplies one object.
 if(kind==='asset-workspace')source=source.replace('mountAssetWorkspace({root:', 'const wallet={reader:{source:{chainId:560048n}}};mountAssetWorkspace({root:').replace('wallet:{reader:{source:{chainId:560048n}}},tokenId:1n','wallet,tokenId:1n');
 vm.runInNewContext(source,context);
 const panel=f.root.children[0];
 const input=(kind==='asset-workspace'?workspaceInput(panel):panel.children[2]),button=panel.children[kind==='asset-workspace'?4:3];
 if(kind==='asset-workspace')input.value='42';
 else input.files=[{size:100,text:async()=>JSON.stringify({original:{manifest:{wallets:[{account:f.session.account,tenant:'xiongan'}]}},laterV3:{}})}];
 button.click();button.click();await drain();const initialChecks=f.checks;
 // Resolve the newer request first, then the older request. If correctly serialized,
 // there is one pending login check; release that and its final publication check.
 if(f.gates.length>1){f.gates[1]();await drain();f.gates[0]();await drain();}
 else {f.gates[0]?.();await drain();f.gates[1]?.();await drain();}
 assert.equal(button.disabled,false,'stale first request must not leave controls disabled');
 assert.equal(initialChecks,1,'lock must be acquired before the first awaited login check');
});
for(const kind of ['asset-workspace','hoodi-journey']) test(`${kind}: pagehide/pageshow during read releases controls and rejects late content`,async()=>{
 const f=fixture();let source=readFileSync(join(root,`web/${kind}-panel.mjs`),'utf8');
 source=source.replace(/^import[\s\S]*?;\n/gm,'').replace('export function mountAssetWorkspace','function mountAssetWorkspace');
 const context={...identityProjection,...identityI18n,workspaceCopy,workspaceNarrative,rendererMessages,document:f.document,globalThis:f.window,walletLogin:f.login,readAssetWorkspace:async()=>({registerHistory:{state:'not-requested'}}),renderAssetWorkspace:()=> 'synthetic workspace',openHoodiJourneyRead:async()=>({}),compareHoodiReleaseHistory:async()=>({}),renderHoodiReleaseHistory:()=> 'synthetic history'};
 if(kind==='asset-workspace')source+='\nconst wallet={reader:{source:{chainId:560048n}}};mountAssetWorkspace({root:document.getElementById("wallet-private"),login:walletLogin,getContext:()=>({wallet,tokenId:1n})});';
 vm.runInNewContext(source,context);const panel=f.root.children[0],input=(kind==='asset-workspace'?workspaceInput(panel):panel.children[2]),button=panel.children[kind==='asset-workspace'?4:3],output=panel.children.at(-1);
 if(kind==='asset-workspace')input.value='42';else input.files=[{size:100,text:async()=>JSON.stringify({original:{manifest:{wallets:[{account:f.session.account,tenant:'xiongan'}]}},laterV3:{}})}];
 button.click();await drain();f.gates[0]();await drain();assert.equal(button.disabled,true);
 f.window.dispatchEvent(new Event('pagehide'));f.window.dispatchEvent(new Event('pageshow'));f.gates[1]?.();await drain();
 assert.equal(button.disabled,false,'panel invalidation must reset displayed control state');assert.equal(output.textContent,'','late result must stay suppressed');
});
