import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../web/external-assets.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
function fixture({selected='1',observed='0x1',missing=false,balancePromise=null}={}){
 const nodes=new Map();const node=id=>{if(id==='asset-network'&&missing)return null;if(!nodes.has(id))nodes.set(id,{value:id==='asset-network'?selected:'',checked:false,handlers:new Map(),addEventListener(k,fn){this.handlers.set(k,fn);}});return nodes.get(id);};
 const calls=[],created=[];let reads=0,sends=0,markStarted;const started=new Promise(resolve=>{markStarted=resolve;});
 class Failure extends Error{constructor(code){super(code);this.code=code;}}
 class Session{constructor(_provider,chainId,actor,_store,check){this.chainId=chainId;this.actor=actor;this.check=check;created.push(chainId);}async balance(){reads++;markStarted();return balancePromise?await balancePromise:{balanceWei:0n};}async status(){return {state:'idle'};}async submit(){sends++;return 'tx';}}
 const provider={on(){},request(){throw Error('unexpected direct request');}};
 const context={document:{getElementById:node,querySelectorAll:()=>[...nodes.values()],dispatchEvent(){}},CustomEvent:class{},
  msg:x=>x,paint:(n,v)=>{n.textContent=typeof v==='string'?v:JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);},jsonUi:x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v),decimalUi:x=>x,
  walletLogin:{check:async()=>{},assert(){},provider:()=>provider,subscribe(){}},WalletLoginError:class extends Error{},ControlAdapterError:Failure,
  getReleaseProfile:async()=>({features:{externalAssets:true}}),acquireWalletUi:()=>Symbol(),releaseWalletUi(){},walletUiBusy:()=>false,
  ExternalAssetSession:Session,BrowserExternalAssetStore:class{},formatWeiAsEth:x=>String(x),ASSET_CHAINS:{1:'Ethereum',8453:'Base',11155111:'Sepolia',84532:'Base Sepolia',560048:'Hoodi'},
  controlRpc:async(_p,method)=>{calls.push(method);return method==='eth_requestAccounts'?['0x'+'1'.repeat(40)]:observed;}};
 runInNewContext(source,context);
 return {node,calls,created,started,reads:()=>reads,sends:()=>sends,click:()=>node('asset-connect').handlers.get('click')(),change:chain=>{node('asset-network').value=chain;node('asset-network').handlers.get('change')();}};
}
test('default Ethereum and missing-control legacy composition reject another provider chain before assets',async()=>{
 for(const missing of [false,true]){const f=fixture({missing,observed:'0x2105'});await f.click();assert.deepEqual(f.created,[]);assert.equal(f.reads(),0);assert.equal(f.sends(),0);assert.equal(f.node('asset-result').textContent,'CONTROL_CHAIN_MISMATCH');}
});
test('explicit supported selected network reaches exact chain session without auto-changing selection',async()=>{
 const f=fixture({selected:'8453',observed:'0x2105'});await f.click();assert.deepEqual(f.created,['8453']);assert.equal(f.reads(),1);assert.equal(f.node('asset-network').value,'8453');assert.equal(f.sends(),0);
 const bad=fixture({selected:'999',observed:'0x3e7'});await bad.click();assert.deepEqual(bad.calls,[]);assert.equal(bad.reads(),0);
});
test('network switch during balance read discards late result and clears review without sends',async()=>{
 let resolve;const balancePromise=new Promise(r=>resolve=r);const f=fixture({balancePromise});const pending=f.click();
 await f.started;assert.equal(f.reads(),1);
 f.node('asset-ack').checked=true;f.change('8453');resolve({balanceWei:77n});await pending;
 assert.equal(f.node('asset-network').value,'8453');assert.equal(f.node('asset-ack').checked,false);assert.equal(f.node('asset-result').textContent,'ASSET_CONNECTION_CHANGED');assert.equal(f.sends(),0);
});
