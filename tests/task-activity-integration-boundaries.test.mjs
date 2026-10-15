/** Pure source/DOM regressions. Requires wallet:browser:build first. No listeners, HTTP, browser, provider requests, or implementation writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { freezeReceiptTask } from '../src/agent/receiptTask.ts';
import { freezeTaskPolicy } from '../src/agent/taskContract.ts';
const ROOT=resolve(import.meta.dirname,'..');
const { TaskActivityReader, taskActivity }=await import(pathToFileURL(join(ROOT,'web/task-activity.mjs')));
const { TaskAuthorizationClient }=await import(pathToFileURL(join(ROOT,'web/task-authorization.mjs')));
const { verifyClosure }=await import(pathToFileURL(join(ROOT,'scripts/package/verify-product-origin.mjs')));
const hash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const h=n=>'0x'+n.repeat(64), a=n=>'0x'+n.repeat(40);
const context={serverId:'synthetic-only',origin:'https://wallet.example.invalid',tenant:'xiongan',chainId:'560048',account:a('1')};
const identity={schema:'8415-task-executor/1',agentId:'synthetic',agentVersion:'1',adapterId:'synthetic',adapterVersion:'1',implementationDigest:h('9')};
const executor={identity,digest:'0x'+createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
function rawView(task, extra={}) { return {task,executor,authorization:null,effectiveStatus:'pending',budget:null,observationPolicy:null,receiptVerifier:null,observations:[],observationRevision:'0',completion:{state:'not-attempted',fresh:false},capabilities:{executable:false,adapterConfigured:false,receiptVerifierConfigured:false,missing:[]},...extra}; }
function pendingRaw() {
 const task=freezeTaskPolicy({schema:'8415-agent-task/1',taskId:'synthetic-read',...Object.fromEntries(['origin','tenant','chainId'].map(k=>[k,context[k]])),actor:context.account,expiresAt:'2000000000',fees:{perOperationWei:'100000',totalWei:'300000'},intent:{kind:'exact-operation',operation:{kind:'create-account',chainId:context.chainId,actor:context.account,controller:{contract:a('5'),runtimeCodeHash:h('8')}}}});
 return rawView(task);
}
function receiptRaw(status) {
 const task=freezeReceiptTask({schema:'8415-agent-task/1',taskId:'synthetic-receipt',origin:context.origin,tenant:context.tenant,chainId:context.chainId,actor:context.account,expiresAt:'2000000000',fees:{perOperationWei:'100000',totalWei:'300000'},intent:{kind:'artfi-receipt',handlerId:'artfi:whole-receipt:v1',escrow:a('5'),runtimeCodeHash:h('8'),segmentId:h('a'),sale:{seller:a('2'),collection:a('3'),tokenId:'7',paymentToken:a('4'),price:'100',buyer:a('1'),salt:'9',startsAt:'1',endsAt:'2000000000',epoch:'0'},correspondence:{settlementId:h('1'),assetRecordHash:h('2'),oracleSourceId:h('3'),requestHash:h('4'),executionReferenceHash:h('5'),previousSegment:h('0'),oldCertificateHash:h('6'),warehouseReceiptHash:h('7')},phases:[{phase:'funded',nonce:'0',calldataHash:h('1'),planDigest:h('2'),journalBindingHash:h('3'),gasLimit:'21000',maxFeePerGasWei:'2',maxPriorityFeePerGasWei:'1'}],recovery:{funding:'once',payout:'once',unknownOutcome:'reconcile-only'}}});
 return rawView(task,{authorization:{schema:'8415-task-authorization-reference/1',taskDigest:task.digest,reference:'grant:synthetic-only',status:'authorized',grantPolicyVersion:'1',credentialRevisionAtApproval:'0'},effectiveStatus:'authorized',budget:{schema:'8415-task-budget/1',taskDigest:task.digest,revision:'0',reservations:[]},receiptAttempts:[{phase:'funded',nonce:'0',operationId:'receipt-funded',maximumFeeWei:'42000',status,transactionHash:status==='submitted'?h('b'):null}]});
}
test('fresh browser decoder dependencies exist and bundled vendor matches installed dependency',()=>{
 // Prerequisite: npm run wallet:browser:build. The test never builds or downloads.
 for(const file of ['agent/taskContract.js','agent/receiptTask.js','agent/receiptObservation.js'])assert.ok(existsSync(join(ROOT,'dist/browser',file)),file);
 assert.deepEqual(readFileSync(join(ROOT,'dist/browser/vendor/ethers.js')),readFileSync(join(ROOT,'node_modules/ethers/dist/ethers.min.js')));
});
for(const status of ['outcome-unknown','submitted']) test(`valid receipt ${status} is retained in cockpit operations and allocated budget`,()=>{
 const decoded=new TaskAuthorizationClient({context,request:()=>{throw Error('NO_REQUEST')}}).view(receiptRaw(status));
 assert.equal(decoded.executionState,status==='outcome-unknown'?'unknown':'submitted');
 assert.equal(decoded.receiptAttempts.length,1); assert.equal(decoded.receiptAttempts[0].maximumFeeWei,'42000');
 const result=taskActivity(decoded);
 assert.equal(result.operations.length,1); assert.equal(result.unknownCount,status==='outcome-unknown'?1:0); assert.equal(result.submittedCount,status==='submitted'?1:0);
 assert.equal(result.allocatedFeeCeilingWei,'42000'); assert.equal(result.unallocatedFeeCeilingWei,'258000');
 assert.equal(result.savedCompletionState,null);assert.equal(result.receiptExecutionState,status==='outcome-unknown'?'unknown':'submitted');
});
test('mixed receipt attempts retain unknown ceiling and expose only public phase fields',()=>{
 const raw=structuredClone(receiptRaw('outcome-unknown'));
 const phase={...raw.task.policy.intent.phases[0],phase:'registered',nonce:'1'};
 raw.task.policy.intent.phases.push(phase);raw.task=freezeReceiptTask(raw.task.policy);
 raw.authorization.taskDigest=raw.task.digest;raw.budget.taskDigest=raw.task.digest;
 raw.receiptAttempts.push({...raw.receiptAttempts[0],phase:'registered',nonce:'1',operationId:'receipt-registered',status:'submitted',transactionHash:h('b')});
 const decoded=new TaskAuthorizationClient({context,request:()=>{throw Error('NO_REQUEST')}}).view(raw);
 const result=taskActivity(decoded);
 assert.equal(result.operations.length,2);assert.equal(result.unknownCount,1);assert.equal(result.submittedCount,1);
 assert.equal(result.allocatedFeeCeilingWei,'84000');assert.equal(result.unallocatedFeeCeilingWei,'216000');
 assert.equal(result.receiptExecutionState,'unknown');assert.equal(result.savedCompletionState,null);
 assert.equal(JSON.stringify(result).includes('grant:synthetic-only'),false);
 assert.deepEqual(result.operations.map(x=>x.phase),['funded','registered']);assert.ok(Object.isFrozen(result.operations));
});
test('receipt without attempts reports not-started, not generic reservation completion',()=>{
 const raw=receiptRaw('outcome-unknown');raw.receiptAttempts=[];
 const result=taskActivity(new TaskAuthorizationClient({context,request:()=>{throw Error('NO_REQUEST')}}).view(raw));
 assert.equal(result.receiptExecutionState,'not-started');assert.equal(result.savedCompletionState,null);assert.equal(result.allocatedFeeCeilingWei,'0');
});
test('real decoder plus new reader accepts a valid canonical pending list',async()=>{
 const decoder=new TaskAuthorizationClient({context,request:()=>{throw Error('NO_REQUEST')}});
 const reader=new TaskActivityReader({decode:x=>decoder.view(x,{allowFresh:x?.valuationPolicy!==undefined}),request:async()=>({tasks:[pendingRaw()],revision:'1',nextCursor:null})});
 const first=(await reader.page()).tasks[0];assert.equal(first.status,'pending');assert.equal(first.savedCompletionState,'not-attempted');assert.equal(first.receiptExecutionState,null);
});

// Evaluate the unchanged development handler with an inert HTTP capability: listen is NEVER called on a real server.
function developmentHandler(){
 const path='scripts/controls/serve-browser.cjs', source=readFileSync(join(ROOT,path));
 let handler; const require=createRequire(import.meta.url);
 const fakeServer={listen(){},close(){}};
 vm.runInNewContext(source.toString(),{URL,require:p=>p==='node:http'?{createServer(fn){handler=fn;return fakeServer;}}:require(p),__dirname:join(ROOT,'scripts/controls'),process:{env:{},on(){},stdout:{write(){}}}});
 return url=>{let code;const response={setHeader(){},writeHead(n){code=n;},end(){}};handler({url,method:'GET',headers:{host:'127.0.0.1:8415'}},response);return code;};
}
test('actual dev handler serves all four additive modules and their importers',()=>{
 const status=developmentHandler();
 for(const p of ['web/app.mjs','web/task-ui.mjs']) assert.equal(status('/'+p),200,p);
 for(const p of ['web/asset-workspace-panel.mjs','web/hoodi-journey-panel.mjs','web/task-activity-ui.mjs','web/task-activity.mjs']) assert.equal(status('/'+p),200,p);
});
test('curated allowlist includes additive required sources and current source pins',()=>{
 const policy=JSON.parse(readFileSync(join(ROOT,'config/product-source-allowlist.json'))), selected=new Map(policy.entries.map(e=>[e.path,e]));
 for(const p of ['web/asset-workspace-panel.mjs','web/hoodi-journey-panel.mjs','web/task-activity-ui.mjs','web/task-activity.mjs','src/wallet/assetWorkspace.ts','src/wallet/hoodiJourney.ts']) assert.equal(selected.has(p),true,p);
 for(const [p,entry] of selected)if((p.startsWith('web/')||p.startsWith('src/'))&&existsSync(join(ROOT,p)))assert.equal(entry.git_blob_sha1,hash(readFileSync(join(ROOT,p))),p);
});
test('actual product closure verifier accepts the selected candidate source graph',()=>{
 const policy=JSON.parse(readFileSync(join(ROOT,'config/product-source-allowlist.json')));
 const blobs=new Map(policy.entries.filter(e=>/\.(ts|mjs|js|sol|json|html|css)$/.test(e.path)).map(e=>{
  return [e.path,readFileSync(join(ROOT,e.path))];
 }));
 assert.doesNotThrow(()=>verifyClosure(policy,blobs));
});

// Pure DOM substitute around the unchanged production mount and real decoder.
const {mountTaskActivity}=await import(pathToFileURL(join(ROOT,'web/task-activity-ui.mjs')));
class Element extends EventTarget {
 constructor(tag){super();this.tagName=tag;this.children=[];this.textContent='';this.disabled=false;this.value='';}
 append(...nodes){this.children.push(...nodes);if(this.tagName==='select'&&!this.value)this.value=this.children[0]?.value??'';}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(){}
 click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
const event=(name,detail)=>{const e=new Event(name);e.detail=detail;return e;};
const drain=async()=>{for(let i=0;i<6;i++) await new Promise(resolve=>setImmediate(resolve));};
function mount(){
 const document=new EventTarget(),window=new EventTarget(),host=new Element('section');document.visibilityState='visible';document.getElementById=()=>host;document.createElement=tag=>new Element(tag);
 let session=context,version=1,checkHook=null,requestHook=null;const listeners=[];const calls=[];
 const walletLogin={assert(binding){assert.ok(session);if(binding)assert.equal(binding.version,version);return session;},capture(){this.assert();return {version};},async check(){this.assert();if(checkHook)await checkHook();this.assert();},subscribe(f){listeners.push(f);}};
 const client={async request(path,body){calls.push({path,body});if(requestHook)return requestHook(path,body);return path==='tasks/list'?{tasks:[pendingRaw()],revision:'1',nextCursor:null}:pendingRaw();}};
 mountTaskActivity({document,window,walletLogin,getClient:()=>client});
 const [, ,refresh,next,filter,status,list,detail]=host.children[0].children;
 return {document,window,refresh,next,filter,status,list,detail,calls,setRequest(fn){requestHook=fn;},setCheck(fn){checkHook=fn;},clearSession(){session=null;version++;listeners.forEach(f=>f());},show(){document.dispatchEvent(event('wallet:page','tasks'));}};
}
test('UI control: no implicit read, repeated click is bounded, selected detail uses status only',async()=>{
 const f=mount();await drain();assert.equal(f.calls.length,0);f.show();f.refresh.click();f.refresh.click();await drain();
 assert.equal(f.calls.length,1);assert.equal(f.list.children.length,1);f.list.children[0].click();await drain();
 assert.deepEqual(f.calls.map(x=>x.path),['tasks/list','tasks/status']);assert.match(f.detail.textContent,/SAVED_STATUS_NOT_A_FRESH_CHAIN_OBSERVATION/);
});
for(const boundary of ['navigation','visibility','pagehide','logout']) test(`UI control: ${boundary} suppresses pending list and preserves cleared state`,async()=>{
 const f=mount();let finish;f.setRequest(()=>new Promise(resolve=>finish=resolve));f.show();f.refresh.click();await drain();assert.equal(f.calls.length,1);
 if(boundary==='navigation')f.document.dispatchEvent(event('wallet:page','overview'));
 if(boundary==='visibility'){f.document.visibilityState='hidden';f.document.dispatchEvent(new Event('visibilitychange'));}
 if(boundary==='pagehide')f.window.dispatchEvent(new Event('pagehide'));
 if(boundary==='logout')f.clearSession();
 finish({tasks:[pendingRaw()],revision:'1',nextCursor:null});await drain();assert.equal(f.list.children.length,0);assert.equal(f.detail.textContent,'');assert.equal(f.status.textContent,'');
});
test('UI control: genuine decoder identity mismatch cannot publish a row',async()=>{
 const f=mount();const raw=pendingRaw();f.setRequest(async()=>{const changed=structuredClone(raw);changed.task.policy.tenant='other';return {tasks:[changed],revision:'1',nextCursor:null};});f.show();f.refresh.click();await drain();assert.equal(f.list.children.length,0);assert.match(f.status.textContent,/Activity unavailable/);
});
