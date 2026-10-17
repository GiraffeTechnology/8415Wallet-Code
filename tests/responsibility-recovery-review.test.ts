import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ResponsibilityWalletSession} from '../src/controls/session.ts';
const a=(n:string)=>'0x'+n.repeat(40),h=(n:string)=>'0x'+n.repeat(64);
const pin={chainId:1n,controller:a('1'),runtimeCodeHash:h('2')},actor=a('3');
const defer=()=>{let resolve:any;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
function fixture(status='outcome-unknown'){
 let state:any={schema:'8415-operation/1',revision:4n,status,deployment:pin,actor,requestDigest:h('4'),submission:{schema:'8415-control-submission/1',deployment:pin,kind:'create-account',transactionHash:status==='submitted'?h('a'):h('0'),actor,nonce:0n,calldataHash:h('5'),sequenceId:null,legId:null,expectedRevision:null,acceptanceHash:null}};
 const store={read:async()=>structuredClone(state),compareAndSwap:async(expected:any,next:any)=>{if(state.revision!==expected)return false;state=structuredClone(next);return true;}};
 let providerCalls=0;
 const provider={request:async()=>{providerCalls++;throw Error('UNEXPECTED_PROVIDER');}};
 const session=()=>new ResponsibilityWalletSession(provider,pin,actor,store);
 return {session,store,provider,read:()=>structuredClone(state),calls:()=>providerCalls};
}
const receipt=(hash:string,state='confirmed')=>({state,transactionHash:hash,blockNumber:1n,blockHash:h('b'),confirmations:2n,executionEventObserved:true,protocolFinality:'not-evaluated'});

test('review: competing recovery sessions use CAS and cannot overwrite winning recovered hash',async()=>{
 const f=fixture(),s1=f.session(),s2=f.session(),ready=defer(),release=defer();let arrivals=0;
 const read=async(record:any)=>{if(++arrivals===2)ready.resolve();await release.promise;return receipt(record.transactionHash);};
 s1.controls.receipt=read as any;s2.controls.receipt=read as any;
 const both=Promise.allSettled([s1.recoverTransactionHash(h('a')),s2.recoverTransactionHash(h('c'))]);
 await ready.promise;release.resolve();const results=await both;
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected'&&/CONTROL_OPERATION_CONCURRENT/.test(x.reason.message)).length,1);
 assert.equal(f.read().status,'submitted');assert.equal(f.read().revision,5n);assert.equal(f.calls(),0);
});

test('review: same-session recovery reentry is refused, failure releases busy and later recovery succeeds',async()=>{
 const f=fixture(),s=f.session(),entered=defer(),release=defer();let reads=0;
 s.controls.receipt=async(record:any)=>{if(++reads===1){entered.resolve();await release.promise;throw Error('RECEIPT_UNAVAILABLE');}return receipt(record.transactionHash) as any;};
 const first=s.recoverTransactionHash(h('a'));const refused=assert.rejects(first,/RECEIPT_UNAVAILABLE/);await entered.promise;
 await assert.rejects(s.recoverTransactionHash(h('c')),/CONTROL_OPERATION_BUSY/);release.resolve();await refused;
 assert.equal(f.read().status,'outcome-unknown');await s.recoverTransactionHash(h('c'));assert.equal(f.read().submission.transactionHash,h('c'));assert.equal(reads,2);
});

test('review: pending unbound recovery leaves original uncertainty intact',async()=>{
 const f=fixture(),s=f.session(),before=f.read();s.controls.receipt=async(record:any)=>receipt(record.transactionHash,'pending') as any;
 await assert.rejects(s.recoverTransactionHash(h('a')),/CONTROL_RECOVERY_BINDING_NOT_OBSERVED/);assert.deepEqual(f.read(),before);assert.equal(f.calls(),0);
});

test('review: competing terminal acknowledgements clear exactly once',async()=>{
 const f=fixture('submitted'),s1=f.session(),s2=f.session(),ready=defer(),release=defer();let arrivals=0;
 const read=async(record:any)=>{if(++arrivals===2)ready.resolve();await release.promise;return receipt(record.transactionHash);};s1.controls.receipt=read as any;s2.controls.receipt=read as any;
 const both=Promise.allSettled([s1.acknowledgeTerminal(h('a')),s2.acknowledgeTerminal(h('a'))]);await ready.promise;release.resolve();const results=await both;
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.read().status,'idle');assert.equal(f.read().revision,5n);assert.equal(f.calls(),0);
});

for(const field of ['actor','chainId','controller'])test('review: recovery refuses journal from different '+field+' before receipt provider',async()=>{
 const f=fixture();const otherPin=field==='chainId'?{...pin,chainId:2n}:field==='controller'?{...pin,controller:a('4')}:pin;
 const s=new ResponsibilityWalletSession(f.provider,otherPin,field==='actor'?a('6'):actor,f.store);let read=false;s.controls.receipt=async()=>{read=true;throw Error('UNEXPECTED_RECEIPT');};
 await assert.rejects(s.recoverTransactionHash(h('a')),/CONTROL_JOURNAL_SESSION_REFUSED/);assert.equal(read,false);assert.equal(f.calls(),0);
});
