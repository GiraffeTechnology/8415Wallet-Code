import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateTaskListingConfig } from '../server/task-listing-config.mjs';
import { bootstrapTaskListingRuntime } from '../server/task-listing-bootstrap.mjs';
import { createTaskListingRuntime } from '../server/task-listing-runtime.mjs';
import { createAuthRuntime } from '../server/main.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
const h = 'a'.repeat(64);
function config() {
 const tls = { certFile:'/private/client.crt',keyFile:'/private/client.key',caFile:'/private/ca.crt',serverFingerprint256:h };
 const gateway = { url:'https://example.invalid/only',timeoutMs:1000,tls };
 return { schema:'8415-task-listing-runtime/1',enabled:true,artfi:{schema:'artfi-server-listing-config/1'},
   executor:{agentId:'synthetic:test',agentVersion:'1'},observationPolicy:{minimumConfirmations:'3'},
   stores:{bridge:{path:'/private/bridge.enc',keyFile:'/private/bridge.key'},observation:{path:'/private/observation.enc',keyFile:'/private/observation.key'}},
   peer:{id:'spiffe://artfi/wallet',journalUrl:'https://example.invalid/internal/v1/nft/operations',tls,
     capabilityListener:{peerId:'spiffe://artfi/journal',host:'127.0.0.1',port:12345,certFile:'/private/server.crt',keyFile:'/private/server.key',caFile:'/private/ca.crt',clientFingerprint256:h}},
   gateways:{quote:gateway,request:gateway,signer:{...gateway,protocol:'8415-sign-only-http/1',capabilityId:'synthetic:signer',version:'1'}} };
}
test('disabled default is inert and bootstrap cannot turn JSON into a trusted factory', async () => {
 assert.equal(createTaskListingRuntime({}).state,'disabled');
 const b = await bootstrapTaskListingRuntime({store:{}}); assert.equal(b.runtime.state,'disabled'); await b.start(); await b.stop();
 assert.throws(() => b.runtime.consumeCapability({}), /NOT_CONFIGURED/);
 for (const bad of [{...config(),factory:'file:///tmp/evil.mjs'}, {...config(),enabled:false}, {...config(),modules:{}}, {...config(),artfi:{factory(){}}}]) {
   assert.throws(()=>validateTaskListingConfig(bad));
 }
 assert.throws(()=>createTaskListingRuntime({store:{withReadGate(){}},serverConfiguration:config()}), /REFUSED/);
});
test('deployment schema refuses insecure endpoints, ambient credentials and peer identity confusion', () => {
 assert.equal(validateTaskListingConfig(config()).peer.id,'spiffe://artfi/wallet');
 for (const mutate of [c=>c.peer.journalUrl='http://127.0.0.1/internal/v1/nft/operations',c=>c.gateways.signer.url='https://user:password@example.invalid/only',
 c=>c.gateways.quote.url='https://example.invalid/only?apiKey=oops',c=>c.peer.capabilityListener.host='0.0.0.0',c=>c.peer.capabilityListener.peerId=c.peer.id,
 c=>c.stores.observation.path=c.stores.bridge.path,c=>c.peer.tls.rejectUnauthorized=false,c=>c.gateways.signer.module='./signer.mjs',c=>c.gateways.signer.timeoutMs=0,c=>c.observationPolicy.minimumConfirmations='1025']) {
   const c = config(); mutate(c); assert.throws(()=>validateTaskListingConfig(c));
 }
});
test('missing installed or operational configuration is disabled, never an executable claim', async () => {
 const missing = await bootstrapTaskListingRuntime({configuration:{schema:'8415-task-listing-runtime/1',enabled:true},store:{}});
 assert.equal(missing.runtime.code,'TASK_LISTING_CONFIGURATION_REQUIRED');
 const state = await bootstrapTaskListingRuntime({configuration:config(),store:{},authStatePath:'/private/auth.enc'});
 assert.equal(state.runtime.state,'disabled'); assert.equal(state.runtime.authOptions.taskListingExecution,null); await state.stop();
});
test('reusable main is inert until start; default auth HTTP advertises listing disabled and cannot accept factories', async t => {
 const probe = createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const origin=`http://127.0.0.1:${port}`, runtime=await createAuthRuntime({config:{origin,tenant:'xiongan',port,statePath:'/private/auth.enc',accounts:[{username:'tester',wallets:[{account:`0x${'1'.repeat(40)}`,chainId:'1'}]}]},store:new MemoryCredentialStore()});
 assert.equal(runtime.server.listening,false);await runtime.start();t.after(()=>runtime.stop());
 const response=await fetch(`${origin}/auth/capabilities`,{headers:{'X-Wallet-Tenant':'xiongan'}}), data=await response.json();
 assert.equal(response.status,200);assert.deepEqual(data.taskAuthorization.listing,{adapterConfigured:false,resultsConfigured:false,state:'disabled',code:'TASK_LISTING_NOT_CONFIGURED'});
 const rejected=await fetch(`${origin}/internal/v1/task-journal-capabilities/consume`,{method:'POST',headers:{'X-Wallet-Tenant':'xiongan','content-type':'application/json'},body:JSON.stringify({factory:'evil',peerId:'spiffe://artfi/journal'})});
 assert.equal(rejected.status,404);
});

test('main releases listing-owned resources if auth capability connection fails', async () => {
 let stops=0;
 await assert.rejects(createAuthRuntime({config:{origin:'http://127.0.0.1:12345',tenant:'xiongan',port:12345,statePath:'/private/auth.enc',accounts:[{username:'tester',wallets:[{account:`0x${'1'.repeat(40)}`,chainId:'1'}]}]},store:new MemoryCredentialStore(),
 listingRuntime:{runtime:{authOptions:{},connectAuthorization(){throw Error('SYNTHETIC_CONNECT_FAILURE');}},async stop(){stops++;}}}),/SYNTHETIC_CONNECT_FAILURE/);
 assert.equal(stops,1);
});

test('schema rejects executable/accessor/array-subclass inputs without invoking them', () => {
 let calls=0;const c=config();Object.defineProperty(c.artfi,'sneaky',{enumerable:true,get(){calls++;return true;}});assert.throws(()=>validateTaskListingConfig(c));assert.equal(calls,0);
 class EvilArray extends Array {toJSON(){calls++;return [];}}const d=config();d.artfi.values=new EvilArray();assert.throws(()=>validateTaskListingConfig(d));assert.equal(calls,0);
 const e=config();e.artfi.list=[];e.artfi.list.extra=true;assert.throws(()=>validateTaskListingConfig(e));
});

test('reusable main cleans listing resources when socket preflight refuses startup', async t => {
 const directory=await mkdtemp(join(tmpdir(),'listing-socket-failure-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const socketPath=join(directory,'auth.sock');await writeFile(socketPath,'synthetic existing path');let starts=0,stops=0;
 const runtime=await createAuthRuntime({config:{origin:'http://127.0.0.1:12345',tenant:'xiongan',socketPath,statePath:join(directory,'auth.enc'),accounts:[{username:'tester',wallets:[{account:`0x${'1'.repeat(40)}`,chainId:'1'}]}]},store:new MemoryCredentialStore(),
   listingRuntime:{runtime:{authOptions:{},connectAuthorization(){},state:'disabled',code:'TASK_LISTING_NOT_CONFIGURED'},async start(){starts++;},async stop(){stops++;}}});
 await assert.rejects(runtime.start(),/AUTH_EXISTING_SOCKET_REFUSED/);assert.equal(starts,0);assert.equal(stops,1);
 await runtime.stop();assert.equal(stops,1);await assert.rejects(runtime.start(),/AUTH_LISTENER_ALREADY_STARTED/);
});
