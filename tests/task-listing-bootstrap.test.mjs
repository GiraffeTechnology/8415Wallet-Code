import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrapTaskListingRuntime, createTaskListingDependencyOwner } from '../server/task-listing-bootstrap.mjs';
import { createTaskListingTransport, readTaskListingPrivateFile } from '../server/task-listing-transport.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { freezeTaskPolicy } from '../src/agent/taskContract.ts';
import { freezeTaskExecutorIdentity, freezeNftValuationPolicy } from '../server/task-authorization.mjs';
import { createFillProvider } from './fixtures/listing-runtime/fill-provider.mjs';
import { privateFixtureDirectory, certificates, service } from './helpers/task-https-fixture.mjs';
const a=c=>`0x${c.repeat(40)}`;
test('private-file reader rejects writable ancestors even when the immediate parent is private',async t=>{
 const directory=await privateFixtureDirectory(t),nested=join(directory,'nested'),file=join(nested,'synthetic.key');
 await mkdir(nested,{mode:0o700});await writeFile(file,'synthetic-private-file',{mode:0o600});
 assert.equal((await readTaskListingPrivateFile(file)).toString(),'synthetic-private-file');
 for(const mode of [0o720,0o702,0o1777]){
  await chmod(directory,mode);
  try {await assert.rejects(readTaskListingPrivateFile(file),/TASK_LISTING_PRIVATE_DIRECTORY_REFUSED/);}
  finally {await chmod(directory,0o700);}
 }
 assert.equal((await readTaskListingPrivateFile(file)).toString(),'synthetic-private-file');
});
test('fixed mTLS transport validates real peer; HTTP204/205 cannot crash process or produce success',async t=>{
 const certs=await certificates(t);let status=200;
 const s=await service(t,certs,(req,res)=>{assert.equal(req.socket.authorized,true);res.statusCode=status;res.end(status===200?'{}':undefined);});
 const url=`${s.url}/only`,transport=createTaskListingTransport({url,tls:{cert:certs.wallet.certBytes,key:certs.wallet.keyBytes,ca:certs.caBytes},serverFingerprint256:certs.journal.fingerprint,timeoutMs:1000});
 assert.deepEqual(await(await transport(url,{method:'POST',body:'{}'})).json(),{});
 for(status of[204,205,302])await assert.rejects(transport(url,{method:'POST',body:'{}'}),/UNAVAILABLE/);
 for(status of[404,409,503]){const response=await transport(url,{method:'POST',body:'{}'});assert.equal(response.status,status);assert.equal(response.ok,false);}
 const wrong=createTaskListingTransport({url,tls:{cert:certs.wallet.certBytes,key:certs.wallet.keyBytes,ca:certs.caBytes},serverFingerprint256:'0'.repeat(64),timeoutMs:1000});await assert.rejects(wrong(url,{method:'POST',body:'{}'}),/UNAVAILABLE/);
});
test('real JSON bootstrap retains encrypted-store key through writes, then releases all locks and reopens with original key',async t=>{
 const certs=await certificates(t),now=Date.now(),seconds=Math.floor(now/1000),fill=createFillProvider(()=>now);
 const policy=freezeTaskPolicy({schema:'8415-agent-task/1',taskId:'synthetic:key-lifetime',tenant:'xiongan',origin:'https://wallet.example.invalid',chainId:'1',actor:a('1'),expiresAt:String(seconds+7200),fees:{perOperationWei:'100',totalWei:'200'},intent:{kind:'nft-sale',direction:'sell',standard:'ERC-1155',contract:a('2'),tokenId:'7',quantity:'10',minimumProceeds:{currency:'USD',amountMinor:'50000',minorUnit:2,comparison:'gt',basis:'net'},marketAdapters:['artfi:seaport']}});
 const valuation={source:'synthetic:eth-usd',base:{chainId:'1',token:a('0'),decimals:18},quote:{currency:'USD',decimals:2},rateDecimals:8,priceAt:'order-review',validFrom:String(seconds-10),validUntil:String(seconds+7200),maxAgeSeconds:'600'};
 const quote={source:valuation.source,base:valuation.base,quote:valuation.quote,rateDecimals:8,observedAt:String(seconds),expiresAt:String(seconds+900),rate:'200000000000'};
 const nativeRequest={action:'list',account:a('1'),collection:'synthetic-digital',tokenId:'7',quantity:'10',priceWei:'1000000000000000000',expiresAt:seconds+3600};
 const s=await service(t,certs,async(req,res)=>{for await(const _ of req){};res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/quote'?quote:nativeRequest));});
 const portProbe=httpServer();portProbe.listen(0,'127.0.0.1');await once(portProbe,'listening');const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
 const tls={certFile:certs.wallet.cert,keyFile:certs.wallet.key,caFile:certs.ca,serverFingerprint256:certs.journal.fingerprint};
 const keyFile=join(certs.directory,'store.key'),key=Buffer.alloc(32,0x41);await writeFile(keyFile,key.toString('hex'),{mode:0o600});
 const gateway=name=>({url:`${s.url}/${name}`,tls,timeoutMs:1000});
 const config={schema:'8415-task-listing-runtime/1',enabled:true,executor:{agentId:'synthetic:bootstrap',agentVersion:'1'},observationPolicy:{minimumConfirmations:'3'},
  stores:{bridge:{path:join(certs.directory,'bridge.enc'),keyFile},observation:{path:join(certs.directory,'observation.enc'),keyFile}},
  artfi:{schema:'artfi-server-listing-config/1',chainId:'1',executionZone:'sin',tradingEnabled:true,collections:[{slug:'synthetic-digital',chain:'ethereum',contract:a('2'),standard:'erc1155',label:'Synthetic',charity:false}],rpc:{url:'http://127.0.0.1:1',sourceId:'synthetic-reader',timeoutMs:100},sdkTimeoutMs:12000,observation:{policyId:'synthetic-observation',allowedDeployments:fill.dependencies.allowedDeployments,scanPolicy:fill.dependencies.scanPolicy}},
  peer:{id:'spiffe://artfi/wallet',journalUrl:`${s.url}/internal/v1/nft/operations`,tls,capabilityListener:{peerId:'spiffe://artfi/journal',host:'127.0.0.1',port,certFile:certs.wallet.cert,keyFile:certs.wallet.key,caFile:certs.ca,clientFingerprint256:certs.journal.fingerprint}},
  gateways:{quote:gateway('quote'),request:gateway('request'),signer:{...gateway('sign'),protocol:'8415-sign-only-http/1',capabilityId:'synthetic:signer',version:'1'}}};
 if(Object.hasOwn(process.env,'OPENSEA_API_KEY'))throw Error('TEST_REQUIRES_NO_AMBIENT_API_KEY');const oldFetch=globalThis.fetch;process.env.OPENSEA_API_KEY='synthetic-no-credential';globalThis.fetch=()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};t.after(()=>{delete process.env.OPENSEA_API_KEY;globalThis.fetch=oldFetch;});
 const b=await bootstrapTaskListingRuntime({configuration:config,store:new MemoryCredentialStore(),authStatePath:join(certs.directory,'auth.enc'),now:()=>now});assert.equal(b.runtime.state,'configured',b.runtime.code);t.after(()=>b.stop());
 const snapshot={task:policy,executor:freezeTaskExecutorIdentity(b.runtime.authOptions.taskExecutorIdentity),valuationPolicy:freezeNftValuationPolicy(valuation),observationPolicy:{policy:{minimumConfirmations:'3'}},grantReference:'grant:synthetic',grantPolicyVersion:'1',child:null,operationStatus:null};
 b.runtime.connectAuthorization({assertIndependentStore(){},async inspect(){return snapshot;},async withAuthorization(binding,purpose,action){return action(snapshot,()=>snapshot);}});
 // Quote/request use real local mTLS. Native planning must fail at the deliberately
 // unavailable synthetic RPC, after the separate bridge journal was persisted.
 await assert.rejects(b.runtime.authOptions.taskListingExecution.plan(snapshot));
 await b.stop();await b.stop();
 const reopened=await openEncryptedStore(config.stores.bridge.path,key);await reopened.close();
 await assert.rejects(openEncryptedStore(config.stores.bridge.path,Buffer.alloc(32)),/authenticate|Unsupported state/);
 await assert.rejects(readFile(`${config.stores.bridge.path}.lock`),{code:'ENOENT'});
});

// Synthetic dependency-lifecycle regressions. Run through the authorized Linux CI;
// no production endpoint, credential, signature or transaction is used.

function dependencyOwnerFixture() {
  const scope = Object.freeze({ slug: 'synthetic-collection', chain: 'ethereum', contract: a('2'), standard: 'erc1155', label: 'Synthetic', charity: false });
  const configuration = { collections: [scope] }, now = () => 1800000000000;
  const state = { providers: [], builds: [], calls: [], handlers: {}, nextFactoryFailure: null };
  const sdk = {}, api = {};
  const modules = {
    validateServerListingConfig(input) { return structuredClone(input); },
    createServerListingDependencies(input, options) {
      state.builds.push({ input, options });
      if (state.nextFactoryFailure) { const failure = state.nextFactoryFailure; state.nextFactoryFailure = null; throw failure; }
      const selected = input.collections[0];
      const provider = {
        id: state.providers.length, destroyed: false, destroys: 0, requests: [], failDestroy: false,
        async send(method, params) {
          assert.equal(this.destroyed, false, `use after destroy: ${this.id}`);
          this.requests.push({ method, params });
          return { provider: this.id, method, params };
        },
        destroy() {
          this.destroys++;
          assert.equal(this.destroyed, false, `double destroy: ${this.id}`);
          this.destroyed = true;
          if (this.failDestroy) throw Error('SYNTHETIC_DESTROY_FAILURE');
        },
      };
      state.providers.push(provider);
      const reader = Object.freeze({ sourceId: 'synthetic-lifecycle-reader', request: ({ method, params = [] }) => provider.send(method, params) });
      return Object.freeze({
        nativeDependencies: Object.freeze({
          requireTrading() {},
          scope(slug) { assert.equal(slug, selected.slug); return selected; },
          provider(value) { if (JSON.stringify(value) !== JSON.stringify(selected)) throw Error('SYNTHETIC_SCOPE_REFUSED'); return provider; },
          sdk() { return sdk; }, api() { return api; }, journal: options.journal,
        }),
        observationDependencies: Object.freeze({ policyId: 'synthetic-policy', scanPolicy: { maxPagesPerRun: 2 }, allowedDeployments: [], readOnlyProvider: reader }),
        canonicalReader: reader,
      });
    },
    createNativeNftTaskPort(input) {
      return Object.freeze(Object.fromEntries(['prepareListing', 'reviewListing', 'publishListing', 'readPublication'].map(method => [method, async (...args) => {
        state.calls.push({ method, args, input });
        if (state.handlers[method]) return state.handlers[method](input, args);
        const provider = input.provider(scope);
        try { return await provider.send('eth_chainId', []); }
        finally { provider.destroy(); }
      }])));
    },
  };
  const owner = createTaskListingDependencyOwner({ modules, configuration, now });
  const port = owner.createNativeNftTaskPort(owner.nativeDependencies);
  const read = async () => {
    for (const reader of [owner.observationDependencies.readOnlyProvider, owner.canonicalReader]) {
      assert.equal(reader.sourceId, 'synthetic-lifecycle-reader');
      assert.equal((await reader.request({ method: 'eth_chainId', params: [] })).provider, 0);
    }
  };
  return { owner, port, state, scope, configuration, now, read, sdk, api };
}

function lifecycleBarrier() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('listing dependency owner gives all four port operations fresh providers while observation survives', async t => {
  const f = dependencyOwnerFixture(); t.after(() => f.owner.close());
  assert.equal(f.state.providers.length, 1);
  assert.strictEqual(f.owner.observationDependencies.readOnlyProvider, f.owner.canonicalReader);
  for (const method of ['prepareListing', 'reviewListing', 'publishListing', 'readPublication']) {
    const first = {}, second = {}, result = {};
    f.state.handlers[method] = async (input, args) => {
      assert.strictEqual(args[0], first); assert.strictEqual(args[1], second);
      // Review has two distinct vendor-owned acquisitions, including approval.
      for (let i = 0; i < (method === 'reviewListing' ? 2 : 1); i++) {
        const provider = input.provider(f.scope);
        try { await provider.send('eth_chainId', []); }
        finally { provider.destroy(); }
      }
      return result;
    };
    assert.strictEqual(await f.port[method](first, second), result);
    await f.read(); assert.equal(f.state.providers[0].destroys, 0);
  }
  assert.equal(f.state.providers.length, 6);
  assert.equal(new Set(f.state.providers).size, 6);
  assert.ok(f.state.providers.slice(1).every(p => p.destroyed && p.destroys === 1));
  assert.equal(f.owner.observationDependencies.policyId, 'synthetic-policy');
  assert.deepEqual(f.owner.observationDependencies.scanPolicy, { maxPagesPerRun: 2 });
  for (const build of f.state.builds) {
    assert.deepEqual(build.input, f.configuration);
    assert.strictEqual(build.options.now, f.now);
    assert.throws(() => build.options.journal(), /TASK_LISTING_JOURNAL_NOT_CONNECTED/);
  }
  await f.owner.close(); await f.owner.close();
  assert.ok(f.state.providers.every(p => p.destroys === 1));
});

test('listing call boundary cleans providers after errors before the native engine finally', async t => {
  const f = dependencyOwnerFixture(); t.after(() => f.owner.close());
  for (const method of ['prepareListing', 'reviewListing', 'publishListing', 'readPublication']) {
    const failure = Error(`SYNTHETIC_${method}_BEFORE_FINALLY`);
    f.state.handlers[method] = input => {
      input.provider(f.scope);
      input.provider(f.scope);
      // Deliberately no engine-style try/finally: the Wallet boundary owns fallback cleanup.
      throw failure;
    };
    await assert.rejects(f.port[method]({}), error => error === failure);
    assert.ok(f.state.providers.slice(1).every(p => p.destroyed && p.destroys === 1));
    await f.read();
    delete f.state.handlers[method];
    await f.port[method]({});
  }
  assert.equal(f.state.providers[0].destroys, 0);
});

test('concurrent listing calls keep separate provider cleanup domains', async t => {
  const f = dependencyOwnerFixture(); t.after(() => f.owner.close());
  const enteredA = lifecycleBarrier(), enteredB = lifecycleBarrier(), releaseA = lifecycleBarrier(), releaseB = lifecycleBarrier();
  let aProvider, bProvider; const failure = Error('SYNTHETIC_CONCURRENT_FAILURE');
  f.state.handlers.prepareListing = async input => {
    aProvider = input.provider(f.scope); enteredA.resolve(); await releaseA.promise;
    return aProvider.send('eth_chainId', []); // Wallet fallback finally closes A.
  };
  f.state.handlers.reviewListing = async input => {
    bProvider = input.provider(f.scope); enteredB.resolve(); await releaseB.promise;
    await bProvider.send('eth_chainId', []); throw failure;
  };
  const aResult = f.port.prepareListing({}), bResult = f.port.reviewListing({});
  const bRejected = assert.rejects(bResult, error => error === failure);
  await Promise.all([enteredA.promise, enteredB.promise]);
  assert.notStrictEqual(aProvider, bProvider);
  releaseA.resolve(); await aResult;
  assert.equal(aProvider.destroys, 1); assert.equal(bProvider.destroys, 0);
  await bProvider.send('eth_chainId', []); await f.read();
  releaseB.resolve(); await bRejected;
  assert.equal(bProvider.destroys, 1); await f.read();
});

test('scope and factory failures never fall back to the observer provider', async t => {
  const f = dependencyOwnerFixture(); t.after(() => f.owner.close());
  assert.throws(() => f.owner.nativeDependencies.provider(f.scope), /TASK_LISTING_PROVIDER_SCOPE_REQUIRED/);
  assert.equal(f.state.providers.length, 1);
  for (const scope of [{ ...f.scope, slug: 'other' }, { ...f.scope, contract: a('3') }, { ...f.scope, chain: 'base' }]) {
    const builds = f.state.builds.length;
    f.state.handlers.prepareListing = input => input.provider(scope);
    await assert.rejects(f.port.prepareListing({}), /SYNTHETIC_SCOPE_REFUSED/);
    assert.equal(f.state.builds.length, builds);
  }
  delete f.state.handlers.prepareListing;
  const failure = Error('SYNTHETIC_FACTORY_UNAVAILABLE'); f.state.nextFactoryFailure = failure;
  await assert.rejects(f.port.prepareListing({}), error => error === failure);
  assert.equal(f.state.providers.length, 1); await f.read();
  await f.port.prepareListing({});
  assert.equal(f.state.providers.length, 2); assert.equal(f.state.providers[1].destroys, 1);
});

test('close is permanent and idempotent without prematurely closing an in-flight lease', async () => {
  const f = dependencyOwnerFixture(), entered = lifecycleBarrier(), release = lifecycleBarrier(); let lease;
  f.state.handlers.prepareListing = async input => {
    lease = input.provider(f.scope); entered.resolve(); await release.promise;
    return lease.send('eth_chainId', []);
  };
  const operation = f.port.prepareListing({}); await entered.promise;
  await Promise.all([f.owner.close(), f.owner.close()]);
  assert.equal(f.state.providers[0].destroys, 1); assert.equal(lease.destroys, 0);
  const builds = f.state.builds.length;
  for (const method of ['prepareListing', 'reviewListing', 'publishListing', 'readPublication']) {
    await assert.rejects(f.port[method]({}), /TASK_LISTING_DEPENDENCIES_CLOSED/);
  }
  for (const reader of [f.owner.observationDependencies.readOnlyProvider, f.owner.canonicalReader]) {
    await assert.rejects(async () => reader.request({ method: 'eth_chainId', params: [] }), /TASK_LISTING_DEPENDENCIES_CLOSED/);
  }
  assert.equal(f.state.builds.length, builds);
  release.resolve(); await operation;
  assert.equal(lease.destroys, 1); await f.owner.close();
  assert.ok(f.state.providers.every(p => p.destroys === 1));
});

// Remaining authorized-server integration case: an actual bootstrap construction
// failure after owner registration must close its baseline observer provider.

test('one failed provider cleanup still cleans every other lease in that call', async t => {
  const f = dependencyOwnerFixture(); t.after(() => f.owner.close());
  f.state.handlers.prepareListing = input => {
    const first = input.provider(f.scope), second = input.provider(f.scope);
    first.failDestroy = true;
    assert.notStrictEqual(first, second);
    return {};
  };
  await assert.rejects(f.port.prepareListing({}), /TASK_LISTING_PROVIDER_CLEANUP_FAILED/);
  assert.equal(f.state.providers.length, 3);
  assert.ok(f.state.providers.slice(1).every(p => p.destroys === 1));
  await f.read();
});

test('failed observer destruction cannot reopen the dependency owner', async () => {
  const f = dependencyOwnerFixture(); f.state.providers[0].failDestroy = true;
  await assert.rejects(f.owner.close(), /SYNTHETIC_DESTROY_FAILURE/);
  await f.owner.close();
  assert.equal(f.state.providers[0].destroys, 1);
  const builds = f.state.builds.length;
  await assert.rejects(f.port.prepareListing({}), /TASK_LISTING_DEPENDENCIES_CLOSED/);
  for (const reader of [f.owner.observationDependencies.readOnlyProvider, f.owner.canonicalReader]) {
    await assert.rejects(async () => reader.request({ method: 'eth_chainId', params: [] }), /TASK_LISTING_DEPENDENCIES_CLOSED/);
  }
  assert.equal(f.state.builds.length, builds);
});

test('an async callback retained after its port call cannot acquire an untracked provider', async t => {
  const f = dependencyOwnerFixture(); t.after(() => f.owner.close());
  const later = lifecycleBarrier(); let escaped;
  f.state.handlers.prepareListing = input => {
    input.provider(f.scope);
    escaped = later.promise.then(() => input.provider(f.scope));
    return {};
  };
  await f.port.prepareListing({});
  const builds = f.state.builds.length;
  const refused = assert.rejects(escaped, /TASK_LISTING_PROVIDER_SCOPE_REQUIRED/);
  later.resolve(); await refused;
  assert.equal(f.state.builds.length, builds);
  assert.equal(f.state.providers[1].destroys, 1); await f.read();
});

test('nested native calls restore the outer provider ownership domain', async t => {
  const f = dependencyOwnerFixture(); t.after(() => f.owner.close());
  let outerBefore, outerAfter;
  f.state.handlers.prepareListing = async input => {
    outerBefore = input.provider(f.scope);
    const nested = await f.port.reviewListing({});
    assert.equal(f.state.providers[nested.provider].destroys, 1);
    assert.equal(outerBefore.destroys, 0);
    outerAfter = input.provider(f.scope);
    await outerBefore.send('eth_chainId', []);
    return {};
  };
  await f.port.prepareListing({});
  assert.notStrictEqual(outerBefore, outerAfter);
  assert.equal(f.state.providers.length, 4);
  assert.ok(f.state.providers.slice(1).every(p => p.destroys === 1));
  await f.read();
});
