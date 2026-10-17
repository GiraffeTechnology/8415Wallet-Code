import assert from 'node:assert/strict';import {test} from 'node:test';
import {ResponsibilityWalletSession} from '../src/controls/session.ts';
import {hashControlBytes} from '../src/controls/authorization.ts';
const a=(n:string)=>'0x'+n.repeat(40),h=(n:string)=>'0x'+n.repeat(64);
const pin={chainId:560048n,controller:a('1'),runtimeCodeHash:hashControlBytes('0x6000')},actor=a('2');
const defer=()=>{let resolve:any;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
function fixture(){let state:any={schema:'8415-operation/1',revision:0n,status:'idle',deployment:pin,actor,requestDigest:null,submission:null};let sends=0;
 const store={read:async()=>structuredClone(state),compareAndSwap:async(expected:any,next:any)=>{if(state.revision!==expected)return false;state=structuredClone(next);return true;}};
 const provider={request:async({method}:any)=>{if(method==='eth_chainId')return '0x88bb0';if(method==='eth_getCode')return '0x6000';if(method==='eth_accounts')return [actor];if(method==='eth_getTransactionCount')return '0x0';if(method==='eth_call')return '0x';if(method==='eth_sendTransaction'){sends++;return h('a');}throw Error('UNEXPECTED_'+method);}};
 return {store,provider,read:()=>structuredClone(state),sends:()=>sends,session:()=>new ResponsibilityWalletSession(provider,pin,actor,store)};
}
const operation={kind:'control',action:{kind:'create-account'}} as const;
test('review: concurrent execute sessions have one durable claimant and one synthetic provider send',async()=>{
 const f=fixture();const result=await Promise.allSettled([f.session().execute(operation),f.session().execute(operation)]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.sends(),1);assert.equal(f.read().status,'submitted');
});
test('review: discarding unprepared intent invalidates paused predecessor before provider send',async()=>{
 const f=fixture(),entered=defer(),release=defer(),original=f.provider.request;let once=true;
 f.provider.request=async(args:any)=>{if(once){once=false;entered.resolve();await release.promise;}return original(args);};
 const old=f.session().execute(operation);const refused=assert.rejects(old);await entered.promise;
 await f.session().discardUnpreparedIntent();assert.equal(f.read().status,'idle');release.resolve();await refused;assert.equal(f.sends(),0);
 await f.session().execute(operation);assert.equal(f.sends(),1);assert.equal(f.read().status,'submitted');
});
test('review: failed final submission CAS preserves template and prohibits automatic retry',async()=>{
 const f=fixture(),original=f.store.compareAndSwap;f.store.compareAndSwap=async(expected:any,next:any)=>next.status==='submitted'?false:original(expected,next);
 await assert.rejects(f.session().execute(operation),/CONTROL_SUBMISSION_PERSISTENCE_UNCERTAIN/);
 assert.equal(f.sends(),1);assert.equal(f.read().status,'outcome-unknown');assert.notEqual(f.read().submission,null);
 await assert.rejects(f.session().execute(operation),/CONTROL_RECONCILIATION_REQUIRED/);assert.equal(f.sends(),1);
 await assert.rejects(f.session().discardUnpreparedIntent(),/CONTROL_PREPARED_INTENT_CANNOT_DISCARD/);
});
