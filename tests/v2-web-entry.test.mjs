import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('web/index-v2.html'),app=read('web/app-v2.mjs');
function tags(){return [...html.matchAll(/<(button|input|select|form)\b([^>]*)>/g)].map(m=>({tag:m[1],raw:m[0],id:m[2].match(/\bid="([^"]+)"/)?.[1]}));}
test('V2 composition mounts retained ordinary modules once and keeps unopened placeholders inert',()=>{
 for(const file of ['app-v2.mjs','external-assets.mjs','legacy-clearing.mjs','task-ui.mjs','wallet-auth.mjs','asset-control-startup.mjs'])
  assert.equal([...html.matchAll(new RegExp('src="'+file.replaceAll('.','\\.')+'"','g'))].length,1,file);
 assert.doesNotMatch(html, /src="app\.mjs"/);
 assert.match(html,/data-wallet-composition="foundation"/);
 for(const node of tags()){
  if(!node.raw.includes('data-foundation-placeholder="true"'))continue;
  assert.ok(/foundation\.rbac|data-policy-source|id="tenant-avatar-/.test(node.raw),node.raw);
 }
 for(const id of ['connect','asset-connect','settlement-prepare','task-authorize-form','task-refresh']){
  const node=tags().find(n=>n.id===id);assert.ok(node,id);assert.doesNotMatch(node.raw,/\sdisabled|data-foundation-placeholder/);
 }
 assert.doesNotMatch(html,/data-action="(?:forward|complete|return-hop|allocate|reserve-payment|read-detached-history)"/);
});
test('V2 app initializes required controls without a provider request, signature or transaction',async()=>{
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],{id:m[1],listeners:new Map(),hidden:false,checked:false,value:'',
  addEventListener(name,fn){this.listeners.set(name,fn);}}]));
 const document={getElementById:id=>elements.get(id),querySelectorAll:()=>[],addEventListener(){},dispatchEvent(){}};
 let effects=0; const mounts=[];
 const context={document,console,CustomEvent:class{},setTimeout,clearTimeout,
  msg:x=>x,paint(){},jsonUi:x=>x,trustedMessage:x=>x,
  walletLogin:{subscribe(){},assert(){throw Error('LOGIN_REQUIRED');},check:async()=>{throw Error('LOGIN_REQUIRED');}},
  WalletLoginError:class extends Error{},ControlAdapterError:class extends Error{constructor(code){super(code);this.code=code;}},TransactionWouldRevertError:class extends Error{},
  getReleaseProfile:async()=>({id:'v2',product:'8415wallet',version:'2.2',platform:'8415wallet.com',tenant:{label:'wallet'},features:{linkedResponsibilities:false}}),
  currentAccountClient:()=>null,currentAccountFeatures:()=>null,
  acquireWalletUi:()=>Symbol('lock'),releaseWalletUi(){},
  recoveryGuidance:()=>'',controlRpc:()=>{effects++;throw Error('UNEXPECTED_RPC');},
  mountAssetWorkspace:()=>mounts.push('workspace'),mountAuditExport:()=>mounts.push('audit'),mountFeedContinuity:()=>mounts.push('feed'),mountWatchtowerRead:()=>mounts.push('watchtower'),mountKitRead:()=>mounts.push('kit')};
 const body=app.replace(/^import\s+(?:[^;]*?\s+from\s+)?['"][^'"]+['"];\s*/gm,'');
 runInNewContext(body,context);await Promise.resolve();await Promise.resolve();
 assert.equal(effects,0);assert.deepEqual(mounts,['workspace','audit','feed','watchtower','kit']);
 for(const id of ['connect','settlement-prepare','settlement-send','recover','recover-hash','agent-review'])assert.ok(elements.get(id).listeners.size,id);
 assert.equal(elements.get('linked-tab').hidden,true);
 // Actual registered handler: unauthenticated click cannot reach a provider.
 await elements.get('connect').listeners.get('click')();assert.equal(effects,0);
 // Existing JSON deployment input then a wrong provider chain is refused before
 // constructing any account/session or requesting a signature/transaction.
 const outputs=[];context.paint=(node,value)=>outputs.push(value);
 context.walletLogin.check=async()=>{};context.walletLogin.assert=()=>({});
 context.walletLogin.provider=()=>({request(){effects++;throw Error('UNEXPECTED_PROVIDER');},on(){}});
 const address='0x'+'1'.repeat(40),runtimeCodeHash='0x'+'2'.repeat(64);
 elements.get('deployment').files=[{size:200,text:async()=>JSON.stringify({schema:'8415-controls-testnet/1',chainId:'560048',controller:null,payment:null,token:{address,runtimeCodeHash}})}];
 context.controlRpc=async(_provider,method)=>{effects++;return method==='eth_requestAccounts'?[address]:'0x1';};
 await elements.get('deployment').listeners.get('change')();
 await elements.get('connect').listeners.get('click')();
 assert.equal(effects,2);assert.ok(outputs.includes('CONTROL_CHAIN_MISMATCH'));

});
test('V2 source entry and app contain no linked implementations or broad control reexports',()=>{
 const source=read('src/browser-v2.ts');
 assert.doesNotMatch(source,/controls\/index|sdk\/linked|linkedChainView|renderLinkedChain|ResponsibilityWalletSession/);
 assert.doesNotMatch(app,/new ResponsibilityWalletSession|DetachedResponsibilityHistoryClient|mountForwardProgress|signForwardConsent|kind: 'forward'|kind: 'complete'/);
 assert.match(app,/profile\.id !== 'v2'/);
});
