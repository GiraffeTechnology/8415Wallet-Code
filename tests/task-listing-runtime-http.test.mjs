import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as modules from '@artfi/task-listing-runtime/server';
import { createAuthRuntime } from '../server/main.mjs';
import { createTaskListingRuntime } from '../server/task-listing-runtime.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { base32, hashPassword, hotp } from '../server/crypto.mjs';
import { createNativeFixture, installDurableFixtureJournal } from './fixtures/listing-runtime/native-fixture.mjs';
import { createFillProvider } from './fixtures/listing-runtime/fill-provider.mjs';
const a=c=>`0x${c.repeat(40)}`, secret=base32(Buffer.alloc(20,0x41)), password='synthetic-listing-http-password';
const accepted=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
async function fixture(t,options={}) {
 const clock={now:Date.now(),sign:0,consumes:0,journal:0};const original=Date.now;Date.now=()=>clock.now;t.after(()=>{Date.now=original;});
 const stores={wallet:new MemoryCredentialStore({'xiongan:tester':{secret,lastStep:-1,revision:1}}),bridge:new MemoryCredentialStore(),observation:new MemoryCredentialStore(),native:new MemoryCredentialStore()};
 let directory=null;const key=Buffer.alloc(32,0x43),paths={};
 if(options.durable){directory=await mkdtemp(join(tmpdir(),'wallet-runtime-restart-'));for(const name of Object.keys(stores)){paths[name]=join(directory,`${name}.enc`);stores[name]=await openEncryptedStore(paths[name],key);}await stores.wallet.transaction('xiongan:tester',()=>({secret,lastStep:-1,revision:1}));}
 t.after(async()=>{for(const store of Object.values(stores))await store.close();if(directory)await rm(directory,{recursive:true,force:true});});
 const native=createNativeFixture();installDurableFixtureJournal(native,stores.native);let fixtureJournal=native.deps.journal;
 const fill=createFillProvider(()=>clock.now), seconds=()=>Math.floor(clock.now/1000);
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin=`http://127.0.0.1:${port}`, walletPeer='spiffe://artfi/wallet', goPeer='spiffe://artfi/journal';
 const policy={schema:'8415-agent-task/1',taskId:'task:runtime-http',tenant:'xiongan',origin,chainId:'1',actor:a('1'),expiresAt:String(seconds()+7200),fees:{perOperationWei:'100',totalWei:'200'},intent:{kind:'nft-sale',direction:'sell',standard:'ERC-1155',contract:a('2'),tokenId:'7',quantity:'10',minimumProceeds:{currency:'USD',amountMinor:'50000',minorUnit:2,comparison:'gt',basis:'net'},marketAdapters:['artfi:seaport']}};
 const valuation={source:'synthetic:eth-usd',base:{chainId:'1',token:a('0'),decimals:18},quote:{currency:'USD',decimals:2},rateDecimals:8,priceAt:'order-review',validFrom:String(seconds()-10),validUntil:String(seconds()+7200),maxAgeSeconds:'600'};
 const quote={source:valuation.source,base:valuation.base,quote:valuation.quote,rateDecimals:8,observedAt:String(seconds()),expiresAt:String(seconds()+900),rate:'200000000000'};
 let listing;
 const transport=async(url,init)=>{
   assert.equal(url,'https://synthetic.invalid/internal/v1/nft/operations');clock.journal++;
   const {action,operation}=JSON.parse(init.body),token=new Headers(init.headers).get('authorization').slice(7);
   const request={capability:token,peerId:walletPeer,action,nativeOperationId:operation.id,planDigest:action==='get'?'':modules.nftTaskJournalDigest(operation.plan),requestDigest:modules.nftTaskJournalDigest({action,operation})};
   // Synthetic peer transport only. The actual adapter and capability registry
   // are production functions, with the Wallet store gate still held here.
   const claim=listing.consumeCapability(request,goPeer);clock.consumes++;assert.equal(claim.peerId,walletPeer);
   assert.throws(()=>listing.consumeCapability(request,goPeer),/CAPABILITY_REFUSED/);
   try {const result=await fixtureJournal(claim.principal,action,operation);return Response.json(result);}
   catch(error){return Response.json({error:'synthetic journal refusal'},{status:error.status??503});}
 };
 function installListing(){listing=createTaskListingRuntime({store:stores.wallet,now:()=>clock.now,serverConfiguration:{modules,bridgeStore:stores.bridge,observationStore:stores.observation,
   nativeDependencies:native.deps,observationDependencies:fill.dependencies,canonicalReader:fill.reader,executor:{agentId:'synthetic:runtime',agentVersion:'1'},observationPolicy:{minimumConfirmations:'3'},
   configurationDigest:'1'.repeat(64),consumerPeerId:goPeer,peerJournal:{url:'https://synthetic.invalid/internal/v1/nft/operations',peerId:walletPeer,transport},
   signerMetadata:{protocol:'8415-sign-only-http/1',capabilityId:'synthetic:sign-only',version:'1'},signerTimeoutMs:1000,
   signer:{async signTypedData(request,{signal}){clock.sign++;assert.equal(modules.ethers.TypedDataEncoder.hash(request.typedData.domain,request.typedData.types,request.typedData.message),request.typedDataDigest);await options.onSign?.({request,signal,clock});if(options.loseSigner)throw Error('SYNTHETIC_LOST_SIGNER');return '0x1234';}},quoteSource:async()=>quote,requestSource:async()=>native.request}});}
 installListing();
 const passwordHash=await hashPassword(password);
 const authConfig={origin,tenant:'xiongan',port,statePath:'/synthetic/auth.enc',accounts:[{username:'tester',passwordHash,wallets:[{account:a('1'),chainId:'1'}]}]};
 let runtime;async function installRuntime(){const instance=listing;runtime=await createAuthRuntime({config:authConfig,store:stores.wallet,now:()=>clock.now,listingRuntime:{runtime:instance,async start(){},async stop(){instance.stop();}}});}
 await installRuntime();
 await runtime.start();await runtime.background.stop();t.after(()=>runtime.stop());
 let csrf='';const cookies=new Map();
 async function call(path,body){const r=await fetch(`${origin}/auth/${path}`,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'X-Wallet-Tenant':'xiongan','X-Wallet-CSRF':csrf,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});for(const c of r.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');if(v)cookies.set(k,v);else cookies.delete(k);}const data=await r.json();if(data.csrf)csrf=data.csrf;return{status:r.status,data};}
 async function login(){accepted(await call('bootstrap'));return accepted(await call('password',{username:'tester',password,account:a('1'),chainId:'1'}));}
 async function grant(){await login();const p=accepted(await call('tasks/prepare',{policy,valuationPolicy:valuation}));return accepted(await call('tasks/authorize',{challengeId:p.challengeId,taskDigest:p.task.digest,executorDigest:p.executor.digest,observationPolicyDigest:p.observationPolicy.digest,valuationPolicyDigest:p.valuationPolicy.digest,priceAt:'order-review',code:hotp(secret,Math.floor(clock.now/30000))}));}
 return{clock,stores,native,fill,get listing(){return listing;},get runtime(){return runtime;},call,login,grant,async restart(){
  await runtime.stop();for(const store of Object.values(stores))await store.close();for(const name of Object.keys(stores))stores[name]=await openEncryptedStore(paths[name],key);
  installDurableFixtureJournal(native,stores.native);fixtureJournal=native.deps.journal;installListing();await installRuntime();await runtime.start();await runtime.background.stop();
 }};
}
test('actual main/auth HTTP\u2192one TOTP/logout\u2192real installed port+journal adapter\u2192held capability\u2192SDK publication\u2192continuous results',async t=>{
 const f=await fixture(t),g=await f.grant();accepted(await f.call('logout',{}));
 const result=await f.runtime.background.tick();assert.equal(result.results[0].state,'submitted',JSON.stringify(result));assert.equal(f.clock.sign,1);assert.equal(f.native.state.posts,1);assert.ok(f.clock.consumes>=6);assert.equal(f.clock.journal,f.clock.consumes);
 const caps=accepted(await f.call('capabilities'));assert.equal(caps.taskAuthorization.listing.adapterConfigured,true);assert.equal(caps.taskAuthorization.listing.resultsConfigured,true);
 const binding={taskId:g.task.policy.taskId,taskDigest:g.task.digest,executorDigest:g.executor.digest,grantReference:g.authorization.reference,grantPolicyVersion:g.authorization.grantPolicyVersion,operationId:`listing:${g.task.digest.slice(2)}`};
 const bridgeKey=`task-native-listing:${modules.kernelRequestDigest(binding)}`;
 const order=(await f.stores.bridge.read(bridgeKey)).order;f.fill.addFill(order);f.clock.now+=5000;
 const observation=await f.runtime.background.tick();assert.equal(observation.results[0].state,'listing-observed-at-depth',JSON.stringify(observation));
 await f.login();const status=accepted(await f.call('tasks/status',{taskDigest:g.task.digest}));assert.equal(status.listing.result.summary.aggregate.quantity,'10');assert.equal(status.listing.result.summary.finality,'NOT_EVALUATED');assert.equal(status.budget.reservations[0].units,'10');
 f.fill.state.reorg=true;const stale=accepted(await f.call('tasks/status',{taskDigest:g.task.digest}));assert.equal(stale.listing.result.summary.freshness,'STALE');assert.equal(stale.listing.result.summary.aggregate,null);assert.equal(f.clock.sign,1);assert.equal(f.native.state.posts,1);
});
test('lost signer response survives encrypted-store reopen and runtime recreation without signing or publishing again',async t=>{
 const f=await fixture(t,{loseSigner:true,durable:true});await f.grant();accepted(await f.call('logout',{}));
 assert.equal((await f.runtime.background.tick()).results[0].state,'outcome-unknown');await f.restart();f.clock.now+=5000;await f.runtime.background.tick();
 assert.equal(f.clock.sign,1);assert.equal(f.native.state.posts,0);
});
