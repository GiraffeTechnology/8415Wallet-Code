// New source definitions only. NOT_RUN; original approved environment required.
import test from 'node:test';
import assert from 'node:assert/strict';
import {taskIntent,decodeExternalIntent,captureOperationIntent,verifyTaskIntent} from '../../web/ex-operation-intent.mjs';
const locator={schema:'8415-ex-task-locator/1',tenant:'synthetic',chainId:'11155111',taskDigest:'0x'+'a'.repeat(64)};
const session={tenant:'synthetic',chainId:'11155111',account:'0x'+'b'.repeat(40)};
const raw=()=>({task:{digest:locator.taskDigest,policy:{tenant:locator.tenant,chainId:locator.chainId,origin:'https://wallet.example.invalid',actor:session.account,intent:{kind:'exact-operation'}}},effectiveStatus:'pending'});
test('task locator rejects operation fields, challenges, callbacks and secrets',()=>{
 assert.deepEqual(taskIntent(locator),locator);
 for(const field of ['operationId','childDigest','challengeId','code','callback','proof'])assert.throws(()=>taskIntent({...locator,[field]:'value'}));
 assert.throws(()=>decodeExternalIntent({...locator,schema:'unknown'}));
});
test('task review binds original owner and pending or existing authorized task without new authority',()=>{
 assert.deepEqual(verifyTaskIntent(locator,session,raw(),'https://wallet.example.invalid'),locator);
 for(const state of ['revoked','expired','suspended'])assert.throws(()=>verifyTaskIntent(locator,session,{...raw(),effectiveStatus:state},'https://wallet.example.invalid'));
 for(const s of [{...session,tenant:'other'},{...session,chainId:'560048'},{...session,account:'0x'+'c'.repeat(40)}])assert.throws(()=>verifyTaskIntent(locator,s,raw(),'https://wallet.example.invalid'));
 assert.deepEqual(verifyTaskIntent(locator,session,{...raw(),effectiveStatus:'authorized'},'https://wallet.example.invalid'),locator);
});
test('task and operation navigations replace one locator while preserving restrictive holds',()=>{
 const op={...locator,schema:'8415-ex-operation-locator/1',operationId:'original',childDigest:'0x'+'c'.repeat(64),expectedBudgetRevision:'0'};
 const w={location:{hash:'#wallet-operation='+encodeURIComponent(JSON.stringify(op)),pathname:'/synthetic',search:''},history:{state:{},replaceState(s){this.state=s;}}};
 captureOperationIntent(w);assert.equal(w.history.state.walletExOperationIntent.schema,op.schema);
 w.location.hash='#wallet-task='+encodeURIComponent(JSON.stringify(locator));captureOperationIntent(w);
 assert.deepEqual(w.history.state.walletExOperationIntent,locator);
 assert.deepEqual(w.history.state.walletVerificationOnlyTasks,[locator.taskDigest]);
});
