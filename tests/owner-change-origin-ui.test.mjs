import {mkdtemp,writeFile,chmod,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
/** Loopback HTTP and synthetic factors on approved Linux. Never live custody. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer,request } from 'node:http';
import { once } from 'node:events';
import { webcrypto } from 'node:crypto';
import { Wallet } from 'ethers';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
import { createOriginContinuation,originContinuationKey } from '../server/origin-continuation.mjs';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';
import { createAssetControlWire } from '../web/asset-control-wire.mjs';
import { createAssetControlClient } from '../web/asset-control-client.mjs';
import { createAssetControlTransport } from '../web/asset-control-transport.mjs';
import { createNativeWalletLoginSigner,createNativeWalletLogin,createNativeWalletAuthClient,createNativeKeystoreWalletLogin,createNativeRawKeyWalletLogin,createNativeLoginCustodyBridge } from '../server/auth-service.mjs';
import { createNativeWalletLoginSigner as standaloneSigner,createNativeWalletLogin as standaloneLogin } from '../server/v2/auth-service.mjs';
import { AccountAuthClient } from '../web/account-auth.mjs';
import { createTaskVerificationPolicyWire } from '../web/task-verification-policy-wire.mjs';
import { createTaskVerificationPolicyClient } from '../web/task-verification-policy-client.mjs';
const wallet=new Wallet('0x'+'1'.repeat(64)),origin='https://wallet.example.invalid',old=origin+':9446',tenant='fixture';
const password='synthetic-owner-origin-password',passwordHash=await hashPassword(password),protocol='8415-task-policy-change-wire/2';
async function fixture(t,{loginEntry=null}={}){
 const tuple={username:'owner',account:wallet.address.toLowerCase(),chainId:'560048'};
 const mapping=createOriginContinuation({schema:'8415wallet-origin-continuation/1',tenant,transportOrigin:origin,authorizationOrigin:old,
  revision:'1',priorStateSha256:'a'.repeat(64),contractDigest:'b'.repeat(64),principals:[tuple]});
 const registration={version:1,email:'owner@example.invalid',verifiedAt:1};
 const store=new MemoryCredentialStore({[originContinuationKey(mapping)]:mapping,'fixture:owner':{registration},
  '@registration:fixture':{version:1,records:[{username:'owner',email:registration.email,verifiedAt:1}]}}),mails=[];
 const service=createAuthService({origin,tenant,store,taskVerificationPolicyEnabled:true,
  taskExecution:{verify(){throw Error('UNEXPECTED_EXECUTION');},send(){throw Error('UNEXPECTED_SIGN_OR_SEND');},recover(){throw Error('UNEXPECTED_RECOVERY');}},
  taskExecutorIdentity:{schema:'8415-task-executor/1',agentId:'synthetic:agent',agentVersion:'1',adapterId:'synthetic:adapter',adapterVersion:'1',implementationDigest:'0x'+'d'.repeat(64)},
  taskObservationPolicy:freezeTaskObservationPolicy({minimumConfirmations:'2'}).policy,
  accounts:[{username:'owner',walletName:'owner-wallet',passwordHash,wallets:[{account:wallet.address,chainId:'560048'}]}],sendOtp:async d=>mails.push(d)});
 const server=createServer(service);server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const jar=new Map(),calls=[];
 const client=new AccountAuthClient({origin,tenant,loginEntry,fetcher:async(url,input)=>{
  calls.push(url.pathname);const headers={...input.headers,Host:new URL(origin).host,Origin:origin,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')};
  return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:url.pathname,method:input.method,headers},res=>{
   const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const h=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)h.append(res.rawHeaders[i],res.rawHeaders[i+1]);
    for(const line of res.headers['set-cookie']??[]){const [k,v]=line.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}
    resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:h}));});});req.on('error',reject);if(input.body)req.write(input.body);req.end();});
 }});
 const rawSession=await client.adapter('password',{username:'owner',password}).authenticate({account:wallet.address,chainId:'560048'},null);
 const session={...rawSession,serverId:rawSession.id},account=await client.account(),context=await client.authorizationContext(),wire=createTaskVerificationPolicyWire({crypto:webcrypto});
 const nativeFetcher=(target,input)=>new Promise((resolve,reject)=>{
  calls.push(target.pathname);
  const req=request({hostname:'127.0.0.1',port:server.address().port,path:target.pathname,method:input.method,
   headers:{...Object.fromEntries(new Headers(input.headers)),Host:new URL(origin).host}},res=>{
    const data=[];res.on('data',b=>data.push(b));res.on('end',()=>{const h=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)h.append(res.rawHeaders[i],res.rawHeaders[i+1]);
     resolve(new Response(Buffer.concat(data),{status:res.statusCode,headers:h}));});});req.on('error',reject);if(input.body)req.write(input.body);req.end();});
 return {client,session,account,context,wire,mails,store,mapping,calls,nativeFetcher};
}
test('actual client and strict wire consume independent authority context then save old-realm owner policy',async t=>{
 const f=await fixture(t),raw=await f.client.taskVerification('status',{protocol});
 const status=await f.wire.status(raw,f.session,f.account,null,f.context);
 assert.equal(status.scope.origin,old);assert.equal(status.view.context.origin,origin);assert.ok(status.view.scopeLabel.includes(old));
 const response=await f.client.taskVerification('prepare',{protocol,mode:'OFF',expectedRevision:'0',identityMethod:'password'});
 const p=await f.wire.prepared(response,{session:f.session,account:f.account,reviewed:status.view,mode:'OFF',identityMethod:'password',now:Date.now(),authorizationContext:f.context});
 const v=await f.client.taskVerification('verify',{changeId:p.changeId,changeDigest:p.changeDigest,password});f.wire.verified(v,p,Date.now());
 const result=await f.client.taskVerification('confirm',{changeId:p.changeId,changeDigest:p.changeDigest,code:f.mails.at(-1).code});await f.wire.committed(result,p);
 assert.equal(result.scope.origin,old);assert.equal(result.mode,'OFF');assert.equal(result.revision,'1');assert.equal(f.session.origin,origin);
 assert.equal(result.lastChange.changeDigest,p.changeDigest);
});
test('actual UI bridge reads mapped authority without mutating login identity or default settings',async t=>{
 const f=await fixture(t),values=new Map(),binding={};
 const bridge=createTaskVerificationPolicyClient({client:f.client,walletLogin:{assert:b=>{assert.equal(b,binding);return f.session;}},document:{},
  window:{crypto:webcrypto,sessionStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}}});
 const view=await bridge.read({binding,signal:new AbortController().signal});assert.equal(view.mode,'ON');assert.equal(view.revision,'0');assert.equal(view.canChange,true);
 assert.equal(view.context.origin,origin);assert.ok(view.scopeLabel.includes(old));assert.equal(f.mails.length,0);
 assert.equal((await f.store.read('fixture:owner')).taskVerificationPolicies,undefined);assert.ok(f.calls.includes('/auth/authorization-context'));
});
test('strict decoder refuses a response-selected realm or substituted mapping before factors',async t=>{
 const f=await fixture(t),raw=await f.client.taskVerification('status',{protocol});
 await assert.rejects(f.wire.status(raw,f.session,f.account));
 const review=(await f.wire.status(raw,f.session,f.account,null,f.context)).view;
 const p=await f.client.taskVerification('prepare',{protocol,mode:'ON',expectedRevision:'0',identityMethod:'password'});
 const forged=structuredClone(p);forged.request.originBinding.continuation.digest='c'.repeat(64);
 await assert.rejects(f.wire.prepared(forged,{session:f.session,account:f.account,reviewed:review,mode:'ON',identityMethod:'password',now:Date.now(),authorizationContext:f.context}));
 assert.equal(f.mails.length,0);
});

test('asset control UI transport and exact decoder save mapped field through actual HTTP without changing authority realm',async t=>{
 const f=await fixture(t),binding={},walletLogin={assert:b=>{assert.equal(b,binding);return f.session;}},wire=createAssetControlWire({crypto:webcrypto});
 const transport=createAssetControlTransport({client:f.client,walletLogin}),signal=new AbortController().signal;
 const raw=await transport.request('status',{}, {binding,signal}),reviewed=await wire.status(raw,f.session,f.account,f.context);
 assert.equal(reviewed.scope.origin,old);assert.equal(reviewed.canSave,true);
 const patch={target:{kind:'allow-agent'},value:false,expectedFieldRevision:'0'};
 const response=await transport.request('prepare',{protocol:'8415-asset-control-change-wire/2',expectedRevision:'0',identityMethod:'password',patch},{binding,signal});
 const p=await wire.prepared(response,{session:f.session,account:f.account,reviewed,patch,identityMethod:'password',authorizationContext:f.context});
 wire.verified(await transport.request('verify',{changeId:p.request.changeId,changeDigest:p.changeDigest,password},{binding,signal}),p);
 const saved=await transport.request('confirm',{changeId:p.request.changeId,changeDigest:p.changeDigest,code:f.mails.at(-1).code},{binding,signal});
 const view=await wire.status(saved,f.session,f.account,f.context);assert.equal(view.revision,'1');assert.equal(view.entries[0].value,false);
 const result=await wire.reconciliation(await transport.request('reconcile',{changeId:p.request.changeId,changeDigest:p.changeDigest,expectedRevision:'0'},{binding,signal}),
  {changeId:p.request.changeId,changeDigest:p.changeDigest,expectedRevision:'0'},view);
 assert.equal(result.state,'committed');assert.equal(result.committedChange.request.originBinding.continuation.digest,f.mapping.digest);
 assert.equal(f.session.origin,origin);await assert.rejects(wire.status(saved,f.session,f.account));
});
test('asset control presentation independently reads mapped context and preserves ON defaults',async t=>{
 const f=await fixture(t),values=new Map(),binding={},walletLogin={assert:b=>{assert.equal(b,binding);return f.session;}};
 const client=createAssetControlClient({client:f.client,walletLogin,document:{},window:{crypto:webcrypto,sessionStorage:{
  getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}}});
 const read=await client.read({binding,signal:new AbortController().signal});assert.equal(read.view.scope.origin,old);
 assert.equal(read.view.revision,'0');assert.equal(read.canChange,true);assert.equal(read.catalog.inventoryComplete,false);
 assert.equal(read.authorizationContext.continuation.digest,f.mapping.digest);assert.equal(f.mails.length,0);
});

test('native existing-custody signer completes bootstrap challenge proof session with no Web or capability probe',async t=>{
 const f=await fixture(t);await f.client.logout();f.calls.length=0;let signatures=0;
 const signer=createNativeWalletLoginSigner({origin,tenant,account:wallet.address,chainId:'560048',
  custodyAccount:{address:wallet.address,async signMessage(message){signatures++;return wallet.signMessage(message);}}});
 const login=createNativeWalletLogin({client:f.client,signer}),session=await login.authenticate();
 assert.equal(session.account,wallet.address);assert.equal(session.chainId,'560048');assert.equal(session.origin,origin);
 assert.equal(signatures,1);assert.deepEqual(f.calls,['/auth/bootstrap','/auth/challenge','/auth/proof']);
 assert.equal((await f.client.account()).username,'owner');await login.logout();
 await assert.rejects(f.client.account(),/LOGIN_REQUIRED/);
 assert.deepEqual(Object.keys(signer).sort(),['account','chainId','schema','signLoginChallenge'].sort());
});
test('native signer refuses modified purpose, account, chain, origin, expiry and repeats without custody calls',async t=>{
 const f=await fixture(t);let calls=0,challenge;
 // Capture a real challenge from this authenticated source without exposing any
 // production identity, key, cookie or CSRF in test output.
 const original=f.client.request.bind(f.client);f.client.request=async(...args)=>{const r=await original(...args);if(args[0]==='challenge')challenge=r;return r;};
 const custody={address:wallet.address,async signMessage(message){calls++;return wallet.signMessage(message);}};
 const signer=createNativeWalletLoginSigner({origin,tenant,account:wallet.address,chainId:'560048',custodyAccount:custody});
 await f.client.logout();await f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer});assert.equal(calls,1);
 await assert.rejects(signer.signLoginChallenge(challenge),/ALREADY_ATTEMPTED/);
 for(const update of [{message:challenge.message+' transaction approval'},{origin:old},{chainId:'1'},
  {account:'0x'+'2'.repeat(40)},{tenant:'other'},{method:'ca'},{expiresAt:challenge.issuedAt+120001},{extra:true}])
  await assert.rejects(signer.signLoginChallenge({...challenge,...update}));
 assert.equal(calls,1);
});
test('native signer never submits proof after cancellation during custody signing',async t=>{
 const f=await fixture(t);await f.client.logout();f.calls.length=0;const abort=new AbortController();let calls=0;
 const signer=createNativeWalletLoginSigner({origin,tenant,account:wallet.address,chainId:'560048',custodyAccount:{address:wallet.address,
  async signMessage(message){calls++;abort.abort();return wallet.signMessage(message);}}});
 await assert.rejects(f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer,signal:abort.signal}),/CANCELLED/);
 assert.equal(calls,1);assert.deepEqual(f.calls,['/auth/bootstrap','/auth/challenge']);await assert.rejects(f.client.account(),/LOGIN_REQUIRED/);
});

test('linked and standalone public compositions expose the same bounded native login API',()=>{assert.equal(standaloneSigner,createNativeWalletLoginSigner);assert.equal(standaloneLogin,createNativeWalletLogin);});

test('product native cookie transport completes actual login with its own jar and original custody signer',async t=>{
 const f=await fixture(t),client=createNativeWalletAuthClient({origin,tenant,fetcher:f.nativeFetcher});f.calls.length=0;
 const signer=createNativeWalletLoginSigner({origin,tenant,account:wallet.address,chainId:'560048',custodyAccount:wallet});
 const login=createNativeWalletLogin({client,signer}),session=await login.authenticate();assert.equal(session.account,wallet.address);
 assert.deepEqual(f.calls,['/auth/bootstrap','/auth/challenge','/auth/proof']);assert.equal((await client.account()).username,'owner');await login.logout();
});
test('concrete native custody opens original encrypted keystore locally and completes API proof without an injected signMessage',async t=>{
 const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'native-original-custody-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));
 const keystoreFile=join(dir,'existing-wallet.json'),unlockCredentialFile=join(dir,'existing-unlock');
 await writeFile(keystoreFile,await wallet.encrypt('synthetic-existing-unlock'),{mode:0o600});
 await writeFile(unlockCredentialFile,'synthetic-existing-unlock',{mode:0o600});
 const login=await createNativeKeystoreWalletLogin({origin,tenant,account:wallet.address,chainId:'560048',keystoreFile,unlockCredentialFile,fetcher:f.nativeFetcher});
 const session=await login.authenticate();assert.equal(session.account,wallet.address);assert.equal((await login.client.account()).username,'owner');
 assert.equal(Object.hasOwn(login,'signMessage'),false);assert.equal(Object.hasOwn(login,'privateKey'),false);await login.logout();
 await chmod(unlockCredentialFile,0o644);await assert.rejects(createNativeKeystoreWalletLogin({origin,tenant,account:wallet.address,chainId:'560048',keystoreFile,unlockCredentialFile,fetcher:f.nativeFetcher}),/CUSTODY_FILE_REFUSED/);
});
test('native requested-wallet entry binds exact context suffix and verifies returned wallet route',async t=>{
 const loginEntry={identifier:'owner-wallet',requestedWalletPath:'/owner-wallet'},f=await fixture(t,{loginEntry});await f.client.logout();
 const signer=createNativeWalletLoginSigner({origin,tenant,account:wallet.address,chainId:'560048',custodyAccount:wallet,loginEntry});
 const session=await f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer});
 assert.deepEqual(session.walletRoute,{walletName:'owner-wallet',walletPath:'/owner-wallet'});
 await f.client.logout();const unqualified=createNativeWalletLoginSigner({origin,tenant,account:wallet.address,chainId:'560048',custodyAccount:wallet});
 await assert.rejects(f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer:unqualified}),/REQUESTED_CONTEXT_REFUSED/);
});

test('a cancelled native replacement login clears the earlier local session without dispatching proof',async t=>{
 const f=await fixture(t);f.calls.length=0;
 const signer={async signLoginChallenge(){throw Error('NATIVE_LOGIN_CANCELLED');}};
 await assert.rejects(f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer}),/CANCELLED/);
 await assert.rejects(f.client.account(),/LOGIN_REQUIRED/);assert.deepEqual(f.calls,['/auth/bootstrap','/auth/challenge']);
});

test('original raw-key custody format signs locally without creating a replacement keystore',async t=>{
 const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'native-existing-raw-custody-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));
 const keyFile=join(dir,'existing-key');await writeFile(keyFile,'0x'+'1'.repeat(64)+'\n',{mode:0o600});
 const login=await createNativeRawKeyWalletLogin({origin,tenant,account:wallet.address,chainId:'560048',keyFile,fetcher:f.nativeFetcher});
 const session=await login.authenticate();assert.equal(session.account,wallet.address);assert.equal((await login.client.account()).username,'owner');await login.logout();
 await assert.rejects(createNativeRawKeyWalletLogin({origin,tenant,account:'0x'+'2'.repeat(40),chainId:'560048',keyFile,fetcher:f.nativeFetcher}),/ACCOUNT_CHANGED/);
 await chmod(keyFile,0o644);await assert.rejects(createNativeRawKeyWalletLogin({origin,tenant,account:wallet.address,chainId:'560048',keyFile,fetcher:f.nativeFetcher}),/CUSTODY_FILE_REFUSED/);
});

test('original custody wire consumes complete real challenge and returns only bounded proof without exposing paths or account objects',async t=>{
 const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'native-login-custody-wire-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));
 const keyFile=join(dir,'original-key');await writeFile(keyFile,'0x'+'1'.repeat(64),{mode:0o600});
 const bridge=await createNativeLoginCustodyBridge({origin,tenant,account:wallet.address,chainId:'560048',keyFile});
 let captured;const original=f.client.request.bind(f.client);f.client.request=async(...args)=>{const result=await original(...args);if(args[0]==='challenge')captured=result;return result;};
 await f.client.logout();const signer={async signLoginChallenge(challenge){const result=await bridge.handle({schema:'8415wallet-native-login-request/1',challenge});
  assert.equal(result.requestId,challenge.id);assert.deepEqual(Object.keys(result),['schema','requestId','signature']);return {signature:result.signature};}};
 assert.equal((await f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer})).account,wallet.address);
 await assert.rejects(bridge.handle({schema:'8415wallet-native-login-request/1',challenge:captured,keyFile}),/CHALLENGE_REFUSED/);
 await assert.rejects(bridge.handle({schema:'8415wallet-native-login-request/1',challenge:captured}),/ALREADY_ATTEMPTED/);
 assert.deepEqual(Object.keys(bridge),['schema','handle']);
});

test('original bounded directory custody locates the existing account privately and refuses duplicate references',async t=>{
 const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'native-original-directory-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'original'),{mode:0o700});const keyFile=join(dir,'original','original-account');
 await writeFile(keyFile,'1'.repeat(64),{mode:0o600});await writeFile(join(dir,'readme'),'not a key',{mode:0o600});
 const bridge=await createNativeLoginCustodyBridge({origin,tenant,account:wallet.address,chainId:'560048',keyDirectory:dir});
 await f.client.logout();const signer={async signLoginChallenge(challenge){const p=await bridge.handle({schema:'8415wallet-native-login-request/1',challenge});return {signature:p.signature};}};
 assert.equal((await f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer})).account,wallet.address);
 await writeFile(join(dir,'duplicate-account'),'1'.repeat(64),{mode:0o600});
 await assert.rejects(createNativeLoginCustodyBridge({origin,tenant,account:wallet.address,chainId:'560048',keyDirectory:dir}),/DUPLICATE_ACCOUNT_REFUSED/);
});


test('encrypted existing custody wire produces only a login proof and rejects mixed installation formats',async t=>{
 const f=await fixture(t),dir=await mkdtemp(join(tmpdir(),'native-keystore-proof-wire-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));
 const keystoreFile=join(dir,'existing-wallet.json'),unlockCredentialFile=join(dir,'existing-unlock');
 await writeFile(keystoreFile,await wallet.encrypt('synthetic-proof-only-unlock'),{mode:0o600});
 await writeFile(unlockCredentialFile,'synthetic-proof-only-unlock',{mode:0o600});
 const binding={origin,tenant,account:wallet.address,chainId:'560048',keystoreFile,unlockCredentialFile};
 for(const invalid of [{...binding,keyFile:'/not-read'},{...binding,keyDirectory:'/not-read'},{...binding,unlockCredentialFile:undefined}])
  await assert.rejects(createNativeLoginCustodyBridge(invalid),/CUSTODY_BINDING_REFUSED/);
 const bridge=await createNativeLoginCustodyBridge(binding);assert.deepEqual(Object.keys(bridge),['schema','handle']);
 let challenge;await f.client.logout();const signer={async signLoginChallenge(value){challenge=value;const proof=await bridge.handle({schema:'8415wallet-native-login-request/1',challenge:value});
  assert.deepEqual(Object.keys(proof),['schema','requestId','signature']);assert.equal(proof.requestId,value.id);return {signature:proof.signature};}};
 assert.equal((await f.client.authenticateWallet({account:wallet.address,chainId:'560048',signer})).account,wallet.address);
 await assert.rejects(bridge.handle({schema:'8415wallet-native-login-request/1',challenge}),/ALREADY_ATTEMPTED/);
 await assert.rejects(createNativeLoginCustodyBridge({...binding,account:'0x'+'2'.repeat(40)}),/ACCOUNT_CHANGED/);
 await chmod(unlockCredentialFile,0o644);await assert.rejects(createNativeLoginCustodyBridge(binding),/CUSTODY_FILE_REFUSED/);
});
