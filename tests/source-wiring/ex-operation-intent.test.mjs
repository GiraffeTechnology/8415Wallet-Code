// NOT_RUN: execute only in the original approved environment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {operationIntent,captureOperationIntent,verifyOperationIntent} from '../../web/ex-operation-intent.mjs';
const locator={schema:'8415-ex-operation-locator/1',tenant:'synthetic',chainId:'11155111',taskDigest:'0x'+'a'.repeat(64),operationId:'original-operation',childDigest:'0x'+'b'.repeat(64),expectedBudgetRevision:'7'};
const session={tenant:'synthetic',chainId:'11155111',account:'0x'+'c'.repeat(40)};
const raw=()=>({task:{digest:locator.taskDigest,policy:{tenant:'synthetic',origin:'https://wallet.example.invalid',actor:session.account,chainId:'11155111',intent:{kind:'exact-operation'}}},effectiveStatus:'authorized',budget:{revision:'7',reservations:[{operationId:locator.operationId,childDigest:locator.childDigest,status:'reserved'}]}});
test('exact public locator only, no authority or arbitrary callback fields',()=>{
 assert.deepEqual(operationIntent(locator),locator);
 for(const extra of ['callback','cookie','code','proof','account'])assert.throws(()=>operationIntent({...locator,[extra]:'secret'}));
 assert.throws(()=>operationIntent({...locator,chainId:'1'}));
});
test('owner session and original reservation must match; no chain switching',()=>{
 assert.deepEqual(verifyOperationIntent(locator,session,raw(),'https://wallet.example.invalid'),locator);
 for(const changed of [{...session,tenant:'other'},{...session,chainId:'560048'},{...session,account:'0x'+'d'.repeat(40)}])assert.throws(()=>verifyOperationIntent(locator,changed,raw(),'https://wallet.example.invalid'));
 for(const change of [r=>r.budget.revision='8',r=>r.budget.reservations[0].childDigest='0x'+'d'.repeat(64),r=>r.effectiveStatus='revoked']){const r=raw();change(r);assert.throws(()=>verifyOperationIntent(locator,session,r,'https://wallet.example.invalid'));}
});
test('navigation persists restrictive hold, strips fragment, and has no callback',()=>{
 const w={location:{hash:'#wallet-operation='+encodeURIComponent(JSON.stringify(locator)),pathname:'/synthetic',search:''},history:{state:{},replaceState(state,_,path){this.state=state;this.path=path;}}};
 captureOperationIntent(w);
 assert.equal(w.history.path,'/synthetic');assert.deepEqual(w.history.state.walletVerificationOnlyTasks,[locator.taskDigest]);
 assert.deepEqual(w.history.state.walletExOperationIntent,locator);
});
// Original flow, explicitly read-only opening: no implicit continuation.
import {TaskAuthorizationFlow} from '../../web/task-authorization.mjs';
test('verification-only opening never resumes or prepares task authorization',async()=>{
 const view={...raw(),executionState:'reserved',capabilities:{adapterConfigured:true},completion:{fresh:false}};
 let resumes=0,prepares=0;
 const client={list:async()=>[view],status:async()=>view,resume:async()=>{resumes++;throw Error('unexpected');},prepare:async()=>{prepares++;throw Error('unexpected');}};
 const flow=new TaskAuthorizationFlow({client});
 await flow.load(locator.taskDigest,{verificationOnly:true});
 assert.equal(flow.snapshot().phase,'authorized');assert.equal(resumes,0);assert.equal(prepares,0);
});
test('cancelled late status cannot restore an older navigation flow',async()=>{
 let release;const view={...raw(),executionState:'reserved',capabilities:{},completion:{fresh:false}};
 const flow=new TaskAuthorizationFlow({client:{status:()=>new Promise(r=>{release=r;})}});
 const pending=flow.open(locator.taskDigest,{verificationOnly:true});flow.lock();release(view);await pending;
 assert.equal(flow.snapshot().phase,'locked');assert.equal(flow.snapshot().selected,null);
});
