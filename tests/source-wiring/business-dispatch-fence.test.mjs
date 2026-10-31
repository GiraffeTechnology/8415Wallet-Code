// NOT_RUN. This tests capability capture/receipt validation, not a real EX CAS.
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {captureBusinessDispatchFence} from '../../server/task-business-dispatch-fence.mjs';
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const input={binding:{taskDigest:'0x'+'a'.repeat(64),childDigest:'0x'+'b'.repeat(64),operationId:'original',chainId:'11155111',actor:'0x'+'c'.repeat(40),nonce:'7',executorDigest:'0x'+'d'.repeat(64),grantPolicyVersion:'1'},task:{},child:{}};
const claim=()=>{const v={schema:'8415-ex-dispatch-claim/1',scope:'original:scope',operation:'original',commitment:'0x'+'e'.repeat(64),generation:2,binding:input.binding};return {...v,digest:createHash('sha256').update(canonical(v)).digest('hex')};};
const port=()=>({identity:{fenceId:'original:cas',fenceVersion:'1',implementationDigest:'0x'+'f'.repeat(64)},async claim(){return claim();},async assert(_,r){return r;}});
test('captures original fixed callbacks and immutable identity',async()=>{const p=port(),f=captureBusinessDispatchFence(p);p.claim=()=>{throw Error('replacement');};const r=await f.claim(input);assert.deepEqual(await f.assert(input,r),r);assert.ok(Object.isFrozen(f.identity));});
test('ordinary acknowledgement or altered original claim cannot pass',async()=>{const p=port();p.claim=async()=>({ok:true});await assert.rejects(captureBusinessDispatchFence(p).claim(input));const q=port();q.assert=async(_,r)=>({...r,generation:3});const f=captureBusinessDispatchFence(q);await assert.rejects(f.assert(input,claim()));});
test('descriptor hooks cannot choose a late substitute business port',()=>{const p=port();Object.defineProperty(p,'claim',{get(){throw Error('getter must not run');}});assert.throws(()=>captureBusinessDispatchFence(p),/TASK_BUSINESS_DISPATCH_FENCE_REFUSED/);});
