import assert from 'node:assert/strict';import {test} from 'node:test';
import {ContractIdentityPin} from '../src/sdk/identity.ts';import {IdentityChangedError} from '../src/sdk/errors.ts';
import {detectConformance} from '../src/sdk/conformance.ts';import {divergentToken} from '../src/adapters/memory/scenarios.ts';
import {delegateReader} from './support/delegateReader.ts';
const defer=()=>{let resolve:any;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
for(const field of ['registerId','verificationProfile'])test('review: identity pin rejects configured '+field+' returning undefined',async()=>{
 const {reader}=divergentToken();const broken=delegateReader(reader,{[field]:async()=>undefined} as any);const pin=new ContractIdentityPin(broken);
 await assert.rejects(pin.read(await detectConformance(broken)));assert.equal(pin.pinned,undefined);
});
for(const field of ['chainId','address'])test('review: identity pin refuses '+field+' mutation during asynchronous identity read',async()=>{
 const {reader}=divergentToken(),entered=defer(),release=defer();
 const delayed=delegateReader(reader,{registerId:async()=>{entered.resolve();await release.promise;return reader.registerId();}});
 const pin=new ContractIdentityPin(delayed),conf=await detectConformance(delayed),pending=pin.read(conf);const refused=assert.rejects(pending,IdentityChangedError);
 await entered.promise;Object.assign(delayed.source,field==='chainId'?{chainId:999n}:{address:'0x'+'9'.repeat(40)});release.resolve();await refused;assert.equal(pin.pinned,undefined);
});
test('review: concurrent first identity reads cannot each establish incompatible pins',async()=>{
 const {reader}=divergentToken();let calls=0;const bad='0x'+'9'.repeat(64),entered=defer(),release=defer();
 const mixed=delegateReader(reader,{registerId:async()=>{if(++calls===1){entered.resolve();await release.promise;return reader.registerId();}return bad;}});
 const pin=new ContractIdentityPin(mixed),conf=await detectConformance(mixed);const first=pin.read(conf);const refused=assert.rejects(first,IdentityChangedError);await entered.promise;
 const second=await pin.read(conf);assert.equal(second.registerId,bad);release.resolve();await refused;assert.equal(pin.pinned?.registerId,bad);
});
