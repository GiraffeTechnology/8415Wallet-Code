/** Newly affected mounted-composition races. Synthetic DOM/provider only; no browser or chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');
const stripped=name=>read(name).replace(/^import\s+(?:[^;]*?\s+from\s+)?['"][^'"]+['"];\s*/gm,'');
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function harness(kind){
 const nodes=new Map(),subscribers=[],events=new Map(),documentEvents=new Map();let prepareGate=null,fileGate=null,nftGate=null,statusGate=null,tokenGate=null,prepares=0,sends=0,started=deferred(),sessionLive=true,held=null;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:id==='asset-network'?'1':'',files:[],checked:false,disabled:false,handlers:new Map(),
  addEventListener(k,fn){const prior=this.handlers.get(k);this.handlers.set(k,prior?async event=>{await prior(event);return fn(event);}:fn);},querySelectorAll:()=>[...nodes.values()],set innerHTML(v){for(const m of v.matchAll(/id="([^"]+)"/g))node(m[1]);}});return nodes.get(id);};
 class Failure extends Error{constructor(code){super(code);this.code=code;}}
 const provider={request(){throw Error('UNEXPECTED_PROVIDER');},on(name,fn){events.set(name,fn);}};
 class Session{
  constructor(_p,chain,actor){this.chainId=String(chain);this.actor=actor;}
  async nftHolding(){started.resolve();if(nftGate)await nftGate.promise;return {chainId:'1',account:'0x'+'1'.repeat(40),owner:'0x'+'9'.repeat(40),contract:'0x'+'3'.repeat(40),tokenId:'2',standard:'ERC-721',balanceRaw:'0',blockNumber:'0x1',blockHash:'0x'+'4'.repeat(64)};}
  async verify(){} async balance(){return {balanceWei:1n};} async status(){if(statusGate){started.resolve();return await statusGate.promise;}return {status:'idle'};}
  async erc20Balance(){started.resolve();if(tokenGate)await tokenGate.promise;return {balanceRaw:'10'};}
  async prepare(){prepares++;if(!statusGate)started.resolve();return prepareGate?await prepareGate.promise:{digest:'prepared',asset:'ETH',amount:1n,tradeKey:'trade'};}
  async submit(){sends++;return 'transaction';}
 }
 const context={document:{getElementById:node,querySelectorAll:()=>[...nodes.values()],addEventListener(k,f){documentEvents.set(k,f);},dispatchEvent(){}},CustomEvent:class{},
  msg:x=>x,paint:(n,v)=>{n.textContent=typeof v==='string'?v:JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x);},jsonUi:x=>x,decimalUi:x=>x,
  translateStatic(){},trustedMessage:x=>x,presentation:()=>'',renderUi:x=>x,clearingReviewDisplay:()=> 'PREPARED',
  walletLogin:{check:async()=>{if(!sessionLive)throw new Failure('LOGIN_REQUIRED');},assert(){if(!sessionLive)throw new Failure('LOGIN_REQUIRED');return {account:'0x'+'1'.repeat(40)};},provider:()=>provider,subscribe:fn=>subscribers.push(fn)},
  WalletLoginError:Failure,ControlAdapterError:Failure,getReleaseProfile:async()=>({features:{externalAssets:true}}),
  acquireWalletUi:()=>held===null?(held=Symbol()):null,releaseWalletUi:token=>{if(token===held)held=null;},walletUiBusy:()=>held!==null,
  ExternalAssetSession:Session,LegacyClearingSession:Session,BrowserExternalAssetStore:class{},BrowserLegacyClearingStore:class{},
  parseLegacyClearingDeployment:()=>({chainId:1}),CLEARING_NOTES:'',formatWeiAsEth:x=>String(x),ASSET_CHAINS:{1:'Ethereum',8453:'Base'},
  controlRpc:async(_p,method)=>method==='eth_requestAccounts'?['0x'+'1'.repeat(40)]:'0x1'};
 runInNewContext(stripped(kind==='asset'?'external-assets.mjs':'legacy-clearing.mjs'),context);
 const fire=async(id,event='click')=>node(id).handlers.get(event)?.();
 async function connect(){if(kind==='clearing'){node('clearing-deployment').files=[{size:2,text:async()=>'{}'}];await fire('clearing-deployment','change');}await fire(kind==='asset'?'asset-connect':'clearing-connect');}
 return {node,fire,connect,events,page:detail=>documentEvents.get('wallet:page')?.({detail}),prepares:()=>prepares,sends:()=>sends,started:()=>started.promise,
  holdStatus(){statusGate=deferred();return()=>statusGate.resolve(Promise.reject(Error('late status failure')));},
  holdToken(){tokenGate=deferred();return()=>tokenGate.resolve();},
  holdNft(){nftGate=deferred();return()=>nftGate.resolve();},
  holdPrepare(){prepareGate=deferred();return v=>prepareGate.resolve(v??{digest:'late',asset:'ETH',amount:1n,tradeKey:'late'});},
  logout(){sessionLive=false;subscribers.forEach(fn=>fn(false));},file(){fileGate=deferred();return {size:10,text:()=>{started.resolve();return fileGate.promise;}};},resolveFile:x=>fileGate.resolve(x)};
}
for(const kind of ['asset','clearing']){
 const prepare=kind==='asset'?'asset-prepare':'clearing-review-open',cancel=kind==='asset'?'asset-dismiss':'clearing-cancel-review';
 test(`${kind}: late preparation after cancel cannot re-enable or repaint review; unrelated controls retain controller ownership`,async()=>{
  const f=harness(kind);await f.connect();const unblock=f.holdPrepare();
  f.node('task-authorize').disabled=true;f.node('owner-policy').disabled=false;
  const pending=f.fire(prepare);await f.started();
  f.node('owner-policy').disabled=true; // capability revoked by its own controller midawait
  await f.fire(cancel);unblock();await pending;
  assert.equal(f.node('task-authorize').disabled,true);assert.equal(f.node('owner-policy').disabled,true);
  assert.match(f.node(kind==='asset'?'asset-result':'clearing-result').textContent,/REVIEW_CHANGED/);
  f.node(kind==='asset'?'asset-ack':'clearing-acknowledge').checked=true;
  await f.fire(kind==='asset'?'asset-send':'clearing-send');assert.equal(f.sends(),0);
 });
 test(`${kind}: session invalidation while prepare is pending clears state and discards late result`,async()=>{
  const f=harness(kind);await f.connect();const unblock=f.holdPrepare(),pending=f.fire(prepare);await f.started();f.logout();unblock();await pending;assert.equal(f.sends(),0);
  assert.match(f.node(kind==='asset'?'asset-result':'clearing-result').textContent,/CONNECTION_CHANGED/);
 });
 test(`${kind}: repeated click while another prepare is pending does not duplicate work`,async()=>{
  const f=harness(kind);await f.connect();const unblock=f.holdPrepare(),pending=f.fire(prepare);await f.started();await f.fire(prepare);assert.equal(f.prepares(),1);unblock();await pending;
 });
}
test('external file cancellation before text resolves cannot start a new review',async()=>{
 const f=harness('asset');await f.connect();f.node('asset-request-file').files=[f.file()];
 const pending=f.fire('asset-review-file');await f.started();await f.fire('asset-dismiss');f.resolveFile('{}');await pending;
 assert.equal(f.prepares(),0);assert.equal(f.sends(),0);assert.equal(f.node('asset-result').textContent,'ASSET_REVIEW_CHANGED');
});
test('external network changes during prepare cannot reuse old review',async()=>{
 const f=harness('asset');await f.connect();const unblock=f.holdPrepare(),pending=f.fire('asset-prepare');await f.started();
 f.node('asset-network').value='8453';await f.fire('asset-network','change');unblock();await pending;
 assert.equal(f.node('asset-result').textContent,'ASSET_CONNECTION_CHANGED');assert.equal(f.sends(),0);
});
test('all mounted operations leave unrelated task, auth and policy controls to their controllers',()=>{
 for(const name of ['app.mjs','external-assets.mjs','legacy-clearing.mjs'])assert.doesNotMatch(read(name),/querySelectorAll\('button:not\(\[data-auth-control\]/,name);
});
for(const name of ['app.mjs','app-v2.mjs'])test(`${name}: an operation finishing after policy revocation never changes other controllers' controls`,async()=>{
 const nodes=new Map(),gate=deferred();const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,disabled:false,handlers:new Map(),addEventListener(k,fn){const prior=this.handlers.get(k);this.handlers.set(k,prior?async event=>{await prior(event);return fn(event);}:fn);}});return nodes.get(id);};
 const task=node('task-authorize'),policy=node('owner-policy');task.disabled=true;
 const context={document:{getElementById:node,querySelectorAll:selector=>selector.startsWith('button:not')?[task,policy]:[],addEventListener(){},dispatchEvent(){}},CustomEvent:class{},
  msg:x=>x,paint:(n,v)=>n.textContent=v,jsonUi:x=>x,trustedMessage:x=>x,
  walletLogin:{assert:()=>({}),check:()=>gate.promise,subscribe(){}},WalletLoginError:class extends Error{},ControlAdapterError:class extends Error{constructor(code){super(code);this.code=code;}},TransactionWouldRevertError:class extends Error{},
  getReleaseProfile:async()=>{return ({id:name==='app.mjs'?'v3':'v2',tenant:{label:'fixture'},features:{linkedResponsibilities:name==='app.mjs'}});},
  currentAccountClient:()=>null,currentAccountFeatures:()=>null,acquireWalletUi:()=>Symbol(),releaseWalletUi(){},recoveryGuidance:()=>'',
  mountAssetWorkspace(){},mountAuditExport(){},mountFeedContinuity(){},mountWatchtowerRead(){},mountKitRead(){},mountForwardProgress(){}};
 runInNewContext(stripped(name),context);await Promise.resolve();
 node('connect').disabled=false;node('settlement-prepare').disabled=false;node('settlement-send').disabled=true;
 node('wallet-login').disabled=false;node('wallet-logout').disabled=false;
 const pending=node('connect').handlers.get('click')();
 assert.equal(node('connect').disabled,true);assert.equal(node('settlement-prepare').disabled,true);assert.equal(node('settlement-send').disabled,true);
 assert.equal(node('wallet-login').disabled,false);assert.equal(node('wallet-logout').disabled,false);
 policy.disabled=true;gate.resolve();await pending;
 assert.equal(task.disabled,true);assert.equal(policy.disabled,true);assert.equal(node('result').textContent,'CONTROL_DEPLOYMENT_REQUIRED');
 assert.equal(node('connect').disabled,false);assert.equal(node('settlement-prepare').disabled,false);assert.equal(node('settlement-send').disabled,true);
});
function nativeHarness(name,{loginGate=null,profileGate=null}={}){
 const nodes=new Map(),providers=[],calls=[],events=new Map();let signed=0,live=true,chainGate=null,readGate=null;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,files:[],handlers:new Map(),addEventListener(k,fn){const prior=this.handlers.get(k);this.handlers.set(k,prior?async event=>{await prior(event);return fn(event);}:fn);}});return nodes.get(id);};
 class Failure extends Error{constructor(code){super(code);this.code=code;}}
 class Session{async status(){return {state:'idle'};}async execute(){signed++;}}
 const context={document:{getElementById:node,querySelectorAll:()=>[],addEventListener(k,fn){events.set(k,fn);},dispatchEvent(){}},CustomEvent:class{},
  msg:x=>x,paint:(n,v)=>n.textContent=v,jsonUi:x=>x,trustedMessage:x=>x,
  walletLogin:{assert:()=>{if(!live)throw new Failure('LOGIN_REQUIRED');return {};},check:async()=>{if(loginGate)await loginGate.promise;},subscribe(){},provider:()=>({request(){signed++;},on(){}})},WalletLoginError:Failure,ControlAdapterError:Failure,TransactionWouldRevertError:class extends Error{},
  getReleaseProfile:async()=>{if(profileGate)await profileGate.promise;return ({id:name==='app.mjs'?'v3':'v2',tenant:{label:'fixture'},features:{linkedResponsibilities:name==='app.mjs'}});},
  currentAccountClient:()=>null,currentAccountFeatures:()=>null,acquireWalletUi:()=>Symbol(),releaseWalletUi(){},recoveryGuidance:()=>'',
  mountAssetWorkspace(){},mountAuditExport(){},mountFeedContinuity(){},mountWatchtowerRead(){},mountKitRead(){},mountForwardProgress(){},
  privateNativeSummary:value=>value,privateKeyedNativeUi:(_renderer,value)=>value,renderAssetView:x=>x,
  verifyControlDeployment:async()=>{},WalletSession:class{async assetView(){if(readGate)await readGate.promise;return {oldToken:true};}},RpcErc8415Reader:class{},Eip1193ReadTransport:class{},StandaloneSettlementSession:Session,ResponsibilityWalletSession:Session,StandaloneAccountSession:Session,BrowserSettlementStore:class{},BrowserPublicOperationStore:class{},
  reviewAgentRequest:()=>({operation:{kind:'deposit'},digest:'reviewed'}),controlRpc:async(_p,method)=>{calls.push(method);if(method==='eth_requestAccounts')return ['0x'+'1'.repeat(40)];if(method==='eth_chainId')return '0x88bb0';if(chainGate)await chainGate.promise;return {timestamp:'0x1'};}};
 runInNewContext(stripped(name),context);
 const fire=(id,event='click')=>node(id).handlers.get(event)?.();
 const pin={address:'0x'+'1'.repeat(40),runtimeCodeHash:'0x'+'2'.repeat(64)};
 const file={size:100,text:async()=>JSON.stringify({schema:'8415-controls-testnet/1',chainId:'560048',controller:pin,payment:null,token:pin})};
 return {node,fire,file,calls,navigate:page=>events.get('wallet:page')?.({detail:page}),signed:()=>signed,async connect(){node('deployment').files=[file];await fire('deployment','change');await fire('connect');assert.notEqual(node('result').textContent,'CONTROL_UI_OPERATION_REFUSED');},holdChain(){chainGate=deferred();return()=>chainGate.resolve();},holdRead(){readGate=deferred();return()=>readGate.resolve();}};
}
for(const name of ['app.mjs','app-v2.mjs']){
 test(`${name}: cancelled agent file read cannot create an owner review or sign`,async()=>{
  const f=nativeHarness(name);await f.connect();const gate=deferred();f.node('agent-file').files=[{size:2,text:()=>gate.promise}];
  const pending=f.fire('agent-review');await new Promise(r=>setImmediate(r));await f.fire('agent-dismiss');gate.resolve('{}');await pending;
  assert.equal(f.node('result').textContent,'AGENT_REVIEW_CHANGED');assert.equal(f.signed(),0);assert.equal(f.calls.includes('eth_getBlockByNumber'),false);
 });
 test(`${name}: replacing a deployment while old file is reading invalidates it even while busy`,async()=>{
  const f=nativeHarness(name),gate=deferred();f.node('deployment').files=[{size:100,text:()=>gate.promise}];
  const pending=f.fire('deployment','change');await new Promise(r=>setImmediate(r));f.node('deployment').files=[f.file];await f.fire('deployment','change');
  gate.resolve(await f.file.text());await pending;await f.fire('connect');assert.equal(f.node('result').textContent,'CONTROL_DEPLOYMENT_REQUIRED');assert.equal(f.calls.length,0);
 });
 test(`${name}: dismiss during agent context read discards the eventual prepared review`,async()=>{
  const f=nativeHarness(name);await f.connect();const release=f.holdChain();f.node('agent-file').files=[{size:2,text:async()=>'{}'}];
  const pending=f.fire('agent-review');await new Promise(r=>setImmediate(r));await f.fire('agent-dismiss');release();await pending;
  assert.equal(f.node('result').textContent,'AGENT_REVIEW_CHANGED');assert.equal(f.signed(),0);
 });
}
for(const name of ['app.mjs','app-v2.mjs'])test(`${name}: cancelling agent execute during fresh context read prevents dispatch`,async()=>{
 const f=nativeHarness(name);await f.connect();f.node('agent-file').files=[{size:2,text:async()=>'{}'}];await f.fire('agent-review');
 f.node('agent-acknowledge').checked=true;const release=f.holdChain(),pending=f.fire('agent-execute');await new Promise(r=>setImmediate(r));
 await f.fire('agent-dismiss');release();await pending;assert.equal(f.node('result').textContent,'AGENT_REVIEW_CHANGED');assert.equal(f.signed(),0);
});

for(const name of ['app.mjs','app-v2.mjs'])for(const phase of ['login','profile'])test(`${name}: deployment replacement during ${phase} await prevents stale callback`,async()=>{
 const gate=deferred();const f=nativeHarness(name,phase==='login'?{loginGate:gate}:{profileGate:gate});let reads=0;
 f.node('deployment').files=[{size:100,text:async()=>{reads++;return f.file.text();}}];
 const pending=f.fire('deployment','change');await new Promise(r=>setImmediate(r));
 f.node('deployment').files=[f.file];await f.fire('deployment','change');gate.resolve();await pending;
 assert.equal(reads,0);assert.equal(f.calls.length,0);assert.equal(f.node('result').textContent,'CONTROL_CONNECTION_CHANGED');
});

for(const name of ['app.mjs','app-v2.mjs'])test(`${name}: page navigation cancels unsent agent review before execution`,async()=>{
 const f=nativeHarness(name);await f.connect();f.node('agent-file').files=[{size:2,text:async()=>'{}'}];await f.fire('agent-review');
 f.node('agent-acknowledge').checked=true;f.navigate('assets');await f.fire('agent-execute');
 assert.equal(f.signed(),0);assert.equal(f.node('agent-acknowledge').checked,false);
 assert.equal(f.node('result').textContent,'AGENT_OWNER_REVIEW_REQUIRED');
});

test('external NFT handler does not render neighboring ownerOf address into DOM',async()=>{
 const f=harness('asset');await f.connect();await f.fire('nft-read');
 assert.doesNotMatch(f.node('nft-result').textContent,/0x9{40}|\"owner\"/);assert.match(f.node('nft-result').textContent,/balanceRaw/);assert.equal(f.sends(),0);
});

test('external NFT selection changed while reading rejects late prior-token DOM result',async()=>{
 const f=harness('asset');await f.connect();const release=f.holdNft(),pending=f.fire('nft-read');await f.started();
 f.node('nft-token-id').value='new token';await f.fire('nft-token-id','input');release();await pending;
 assert.equal(f.node('asset-result').textContent,'ASSET_READ_CHANGED');assert.doesNotMatch(f.node('nft-result').textContent,/balanceRaw|0x9{40}/);
});

for(const kind of ['asset','clearing'])test(`${kind}: navigation away while prepare is pending cancels old review`,async()=>{
 const f=harness(kind);await f.connect();const release=f.holdPrepare(),pending=f.fire(kind==='asset'?'asset-prepare':'clearing-review-open');await f.started();
 f.page('settings');release();await pending;assert.match(f.node(kind==='asset'?'asset-result':'clearing-result').textContent,/REVIEW_CHANGED/);assert.equal(f.sends(),0);
});
test('external transfer to review navigation retains exactly the prepared owner review',async()=>{
 const f=harness('asset');await f.connect();await f.fire('asset-prepare');f.page('review');f.node('asset-ack').checked=true;await f.fire('asset-send');assert.equal(f.sends(),1);
});

for(const kind of ['asset','clearing'])test(`${kind}: late status failure after logout cannot overwrite cleared status`,async()=>{
 const f=harness(kind);await f.connect();const release=f.holdStatus(),pending=f.fire(kind==='asset'?'asset-prepare':'clearing-review-open');await f.started();
 f.logout();const id=kind==='asset'?'asset-state':'clearing-recovery-guidance',before=f.node(id).textContent;release();await pending;assert.equal(f.node(id).textContent,before);
});
test('external token balance changed selection discards old contract result',async()=>{
 const f=harness('asset');await f.connect();f.node('asset-contract').value='old';const release=f.holdToken(),pending=f.fire('asset-token-balance');await f.started();
 f.node('asset-contract').value='new';release();await pending;assert.equal(f.node('asset-result').textContent,'ASSET_READ_CHANGED');
});

for(const name of ['app.mjs','app-v2.mjs'])test(`${name}: native token selection change discards late previous-token read`,async()=>{
 const f=nativeHarness(name);await f.connect();f.node('tokenId').value='1';const before=f.node('result').textContent,release=f.holdRead(),pending=f.fire('native-read');await new Promise(r=>setImmediate(r));
 f.node('tokenId').value='2';await f.fire('tokenId','input');release();await pending;assert.equal(f.node('result').textContent,before);assert.equal(f.signed(),0);
});
