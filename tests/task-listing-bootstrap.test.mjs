import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { bootstrapTaskListingRuntime } from '../server/task-listing-bootstrap.mjs';
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
