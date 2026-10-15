import test from 'node:test';
import assert from 'node:assert/strict';
import { KitProjectionApi, KitTransportError } from '../src/adapters/kit/kitApi.ts';
import { KitErc8415Reader } from '../src/adapters/kit/kitReader.ts';
import { divergentToken, T, TOKEN } from '../src/adapters/memory/scenarios.ts';
import { BackendDisagreementError } from '../src/sdk/errors.ts';
import type { Bytes32 } from '../src/sdk/types.ts';
import { fakeKitFetch } from './support/fakeKit.ts';
const url = 'http://localhost:8415';
const wrong: Bytes32 = `0x${'9'.repeat(64)}`;
const calls: {name: string; read: (kit: KitErc8415Reader) => Promise<unknown>}[] = [
  {name:'registerId',read:k=>k.registerId()}, {name:'verificationProfile',read:k=>k.verificationProfile()},
  {name:'entryCount',read:k=>k.entryCount(TOKEN)}, {name:'openGapOf',read:k=>k.openGapOf(TOKEN)},
  {name:'currentEntry',read:k=>k.currentEntry(TOKEN)}, {name:'openGap',read:k=>k.openGap(TOKEN)},
  {name:'entryAt',read:k=>k.entryAt(TOKEN,2n)}, {name:'entryAsOf',read:k=>k.entryAsOf(TOKEN,T.asOf)},
  {name:'holderAsOf',read:k=>k.holderAsOf(TOKEN,T.asOf)}, {name:'isFinalAsOf',read:k=>k.isFinalAsOf(TOKEN,T.asOf)},
];
for (const field of ['registerId','verificationProfile'] as const) for (const call of calls) {
  test(`identity matrix: ${call.name} refuses ${field} mismatch on every retry`, async () => {
    const {reader}=divergentToken();
    const api=new KitProjectionApi({baseUrl:url,fetch:fakeKitFetch(reader,{[field]:wrong})});
    const kit=new KitErc8415Reader(api,reader,reader.source,{chainIdentity:reader});
    for(let i=0;i<2;i++) await assert.rejects(()=>call.read(kit),BackendDisagreementError);
  });
}
for (const field of ['registerId','verificationProfile'] as const) {
  test(`identity retry: ${field} transport failure rejects all waiters then permits a verified retry`, async () => {
    const {reader}=divergentToken(); let fail=true, attempts=0;
    const identity={registerId:()=>reader.registerId(),verificationProfile:()=>reader.verificationProfile!()};
    const original=identity[field];identity[field]=async()=>{attempts++;if(fail)throw Error('SYNTHETIC_CHAIN_UNAVAILABLE');return original();};
    const kit=new KitErc8415Reader(new KitProjectionApi({baseUrl:url,fetch:fakeKitFetch(reader)}),reader,reader.source,{chainIdentity:identity});
    const results=await Promise.allSettled(calls.map(c=>c.read(kit)));
    assert.equal(results.filter(r=>r.status==='rejected').length,calls.length);
    fail=false;
    await Promise.all(calls.map(c=>c.read(kit)));
    assert.ok(attempts>=2);
  });
}
test('identity concurrency: all first readers wait for the same chain verification', async () => {
  const {reader}=divergentToken();let release!:()=>void,entered!:()=>void,reads=0,settled=0;
  const block=new Promise<void>(r=>{release=r;}),arrival=new Promise<void>(r=>{entered=r;});
  const identity={async registerId(){reads++;entered();await block;return reader.registerId();},verificationProfile:()=>reader.verificationProfile!()};
  const kit=new KitErc8415Reader(new KitProjectionApi({baseUrl:url,fetch:fakeKitFetch(reader)}),reader,reader.source,{chainIdentity:identity});
  const pending=calls.map(c=>c.read(kit).then(v=>{settled++;return v;}));
  await arrival;
  try { await new Promise<void>(r=>setImmediate(r));assert.equal(settled,0);assert.equal(reads,1); }
  finally {release();await Promise.all(pending);}
});
for(const field of ['registerId','verificationProfile'] as const) {
  test(`identity drift: a later summary cannot change verified ${field}`,async()=>{
    const {reader}=divergentToken();const options:{registerId?:string;verificationProfile?:string}={};
    const kit=new KitErc8415Reader(new KitProjectionApi({baseUrl:url,fetch:fakeKitFetch(reader,options)}),reader,reader.source,{chainIdentity:reader});
    await kit.entryCount(TOKEN);options[field]=wrong;
    for(const call of calls)await assert.rejects(()=>call.read(kit),BackendDisagreementError);
    delete options[field];assert.equal(await kit.entryCount(TOKEN),await reader.entryCount(TOKEN));
  });
}
test('identity concurrency: differing summaries are each checked against the shared chain identity',async()=>{
  const {reader}=divergentToken();const honest=fakeKitFetch(reader),bad=fakeKitFetch(reader,{registerId:wrong});let n=0;
  const kit=new KitErc8415Reader(new KitProjectionApi({baseUrl:url,fetch:(u,i)=>(++n===1?honest:bad)(u,i)}),reader,reader.source,{chainIdentity:reader});
  const results=await Promise.allSettled([kit.entryCount(TOKEN),kit.entryCount(TOKEN)]);
  assert.equal(results[0]?.status,'fulfilled');assert.equal(results[1]?.status,'rejected');
});
test('identity retry: summary transport failure does not poison later verified reads',async()=>{
  const {reader}=divergentToken();let fail=true;const honest=fakeKitFetch(reader);
  const api=new KitProjectionApi({baseUrl:url,fetch:async(u,i)=>fail?{status:503,json:async()=>({error:'UNAVAILABLE'})}:honest(u,i)});
  const kit=new KitErc8415Reader(api,reader,reader.source,{chainIdentity:reader});
  await assert.rejects(()=>kit.entryCount(TOKEN),KitTransportError);fail=false;
  assert.equal(await kit.entryCount(TOKEN),await reader.entryCount(TOKEN));
});
test('identity isolation: a checked instance cannot authorize another instance',async()=>{
  const {reader}=divergentToken();
  const make=(bad=false)=>new KitErc8415Reader(new KitProjectionApi({baseUrl:url,fetch:fakeKitFetch(reader,bad?{registerId:wrong}:{})}),reader,reader.source,{chainIdentity:reader});
  await make().entryCount(TOKEN);await assert.rejects(()=>make(true).entryCount(TOKEN),BackendDisagreementError);
});
test('identity options are captured: mutating caller options cannot disable an established requirement',async()=>{
  const {reader}=divergentToken();const options={crossCheckIdentity:true,chainIdentity:reader};
  const kit=new KitErc8415Reader(new KitProjectionApi({baseUrl:url,fetch:fakeKitFetch(reader,{registerId:wrong})}),reader,reader.source,options);
  options.crossCheckIdentity=false;
  await assert.rejects(()=>kit.entryCount(TOKEN),BackendDisagreementError);
});

for (const field of ['registerId','verificationProfile'] as const) for (const invalid of [undefined,null,'0x1234']) {
  test(`identity runtime validation: configured ${field} returning ${String(invalid)} is refused and retryable`,async()=>{
    const {reader}=divergentToken();let malformed=true;
    const identity={registerId:()=>reader.registerId(),verificationProfile:()=>reader.verificationProfile!()};
    const original=identity[field];identity[field]=async()=>malformed?invalid as unknown as Bytes32:original();
    const kit=new KitErc8415Reader(new KitProjectionApi({baseUrl:url,fetch:fakeKitFetch(reader)}),reader,reader.source,{chainIdentity:identity});
    await assert.rejects(()=>kit.entryCount(TOKEN));malformed=false;
    assert.equal(await kit.entryCount(TOKEN),await reader.entryCount(TOKEN));
  });
}

test('review: completed pending read cannot be replaced before pair publication',async()=>{
 const depth=1;
 const {reader}=divergentToken();const normal=await reader.registerId(),profile=await reader.verificationProfile();let resolveSecond:any;
 const second=new Promise<any>(resolve=>resolveSecond=resolve);let summaries=0,chainReads=0,profiles=0;
 const api=new KitProjectionApi({baseUrl:'http://localhost:8415',fetch:async()=>{throw Error('unused');}});
 (api as any).summary=async()=>++summaries===1?{registerId:normal,verificationProfile:profile,entryCount:3n,openGap:undefined}:second;
 const identity={registerId:async()=>++chainReads===1?normal:wrong,verificationProfile:async()=>{
  if(++profiles===1){let n=depth;const resolve=()=>{if(n-->0)queueMicrotask(resolve);else resolveSecond({registerId:wrong,verificationProfile:profile,entryCount:3n,openGap:undefined});};resolve();}return profile;
 }};
 const kit=new KitErc8415Reader(api,reader,reader.source,{chainIdentity:identity});
 const results=await Promise.allSettled([kit.entryCount(TOKEN),kit.entryCount(TOKEN)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1,'only one immutable identity may become accepted');
 assert.equal(results.filter(x=>x.status==='rejected'&&x.reason instanceof BackendDisagreementError).length,1);
});
