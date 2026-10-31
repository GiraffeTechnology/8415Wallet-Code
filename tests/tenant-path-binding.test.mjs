import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { tenantBasePath, authOperation, authRequestPath, tenantClientOptions, requireLegacyJournalLocation } from '../web/tenant-path.mjs';
import { AccountAuthClient } from '../web/account-auth.mjs';
import { resolveReleaseProfile, verifyReleaseLocation } from '../web/release-profile.mjs';
import { renderTenantPathCandidate } from '../deploy/auth-runtime/tenant-path-candidate.mjs';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
const origin = 'https://8415wallet.com:8443';
const tenant = 'example-one';
const profile = { schema:'8415wallet-release/1', product:'8415wallet', platform:'8415wallet.com', profile:'v3', tenant:{id:tenant,label:'Example'}, deployment:{environment:'other',url:origin+'/'+tenant,reservedPorts:[443]} };
async function call(handler, path, {body, cookie='', csrf='', target=tenant, headers={}}={}) {
  const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
  Object.assign(req,{method:body===undefined?'GET':'POST',url:path,socket:{remoteAddress:'synthetic'},headers:{host:'8415wallet.com:8443',origin,'x-wallet-tenant':target,'x-wallet-csrf':csrf,cookie,'content-type':'application/json',...headers}});
  const response={statusCode:0,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(value){this.body=JSON.parse(value);}};
  await handler(req,response); return response;
}
test('exact path binding refuses traversal, normalization, reserved and cross tenant paths',()=>{
  assert.equal(authRequestPath(tenant,'/'+tenant,'tasks/status'),'/example-one/auth/tasks/status');
  for (const path of ['/auth/bootstrap','/example-two/auth/bootstrap','/example-one/auth/../bootstrap','/example-one/auth/%62ootstrap','/example-one/auth/%252e','/example-one/auth//bootstrap','/Example-one/auth/bootstrap','/example-one/auth/bootstrap?x=1','/example-one/auth/bootstrap#x','/example-one/auth/bootstrap\\x']) assert.throws(()=>authOperation(tenant,'/'+tenant,path));
  for(const name of ['default','auth','v2','v3','Example','a/b','%61','a..b']) assert.throws(()=>tenantBasePath(name,'/'+name));
  assert.throws(()=>tenantBasePath(tenant,'/example-two'));
});
test('frontend deployment and transport bind exact tenant path without changing port',async()=>{
  const resolved=resolveReleaseProfile(profile), location=new URL(profile.deployment.url);
  verifyReleaseLocation(resolved,location);
  assert.deepEqual(tenantClientOptions(resolved,location),{basePath:'/example-one',origin});
  assert.throws(()=>resolveReleaseProfile({...profile,tenant:{id:'example-two',label:'Other'}}));
  assert.throws(()=>verifyReleaseLocation(resolved,new URL(origin+'/example-two')));
  assert.throws(()=>verifyReleaseLocation(resolved,new URL('https://8415wallet.com/example-one')));
  let requested;
  const client=new AccountAuthClient({tenant,...tenantClientOptions(resolved,location),fetcher:async(url,options)=>{requested={url:String(url),options};return new Response(JSON.stringify({csrf:'synthetic'}));}});
  await client.request('bootstrap');
  assert.equal(requested.url,origin+'/example-one/auth/bootstrap');
  assert.equal(requested.options.headers['X-Wallet-Tenant'],tenant);
  await assert.rejects(client.request('../example-two/auth/bootstrap'));
});
test('two services retain separate cookies, CSRF, sessions and credential tenant keys',async()=>{
  const password='synthetic-only-password', passwordHash=await hashPassword(password), account='0x1111111111111111111111111111111111111111';
  const stores={},services={};
  for(const name of [tenant,'example-two']){
    const registration={version:1,email:name+'@example.invalid',verifiedAt:1};
    stores[name]=new MemoryCredentialStore({[name+':tester']:{registration},['@registration:'+name]:{version:1,records:[{username:'tester',email:registration.email,verifiedAt:1}]}});
    services[name]=createAuthService({origin,tenant:name,basePath:'/'+name,accounts:[{username:'tester',passwordHash,wallets:[{account,chainId:'1'}]}],store:stores[name]});
  }
  const boot=await call(services[tenant],'/example-one/auth/bootstrap');
  assert.equal(boot.statusCode,200);
  assert.match(boot.headers['set-cookie'],/^__Host-8415preauth-example-one=/);
  assert.match(boot.headers['set-cookie'],/Path=\/; HttpOnly; SameSite=Strict;.*; Secure$/);
  const pre=boot.headers['set-cookie'].split(';')[0];
  const body={username:'tester',password,account,chainId:'1'};
  const signed=await call(services[tenant],'/example-one/auth/password',{body,cookie:pre,csrf:boot.body.csrf});
  assert.equal(signed.statusCode,200); assert.equal(signed.body.tenant,tenant);
  const session=signed.headers['set-cookie'].split(';')[0];
  const own=await call(services[tenant],'/example-one/auth/session',{cookie:session,csrf:signed.body.csrf});
  assert.equal(own.statusCode,200);
  const other=await call(services['example-two'],'/example-two/auth/session',{cookie:session,csrf:signed.body.csrf,target:'example-two'});
  assert.equal(other.statusCode,401);
  const wrong=await call(services[tenant],'/example-two/auth/bootstrap',{target:'example-two'}); assert.equal(wrong.statusCode,403);
  const rewritten=await call(services[tenant],'/auth/bootstrap',{headers:{'x-forwarded-prefix':'/example-one'}}); assert.equal(rewritten.statusCode,404);
  const duplicate=await call(services[tenant],'/example-one/auth/session',{cookie:session+'; '+session,csrf:signed.body.csrf});assert.equal(duplicate.statusCode,403);
  const foreignPre=await call(services['example-two'],'/example-two/auth/password',{body,cookie:pre,csrf:boot.body.csrf,target:'example-two'});assert.equal(foreignPre.statusCode,403);
});
test('renderer requires explicit collision-free private registry, preserves asset closure and original listener',async()=>{
 const html=await readFile(new URL('../web/index-v3.html',import.meta.url),'utf8');
 const input={tenant,origin,html,socketPath:'/run/example-auth/auth.sock',staticRoot:'/opt/example-static',registry:{schema:'8415wallet-private-route-registry/1',origin,authoritativeAccountSnapshotSha256:'a'.repeat(64),defaultWalletNames:['platform-account'],routes:[{owner:'isolated-tenant',tenant,path:'/example-one'}]}};
 const out=renderTenantPathCandidate(input);
 assert.equal(out.entryUrl,origin+'/example-one');assert.match(out.entryHtml,/src="\/example-one\/web\/wallet-auth.mjs"/);assert.match(out.entryHtml,/base-uri 'none'/);
 assert.doesNotMatch(out.entryHtml,/<base\b/);assert.match(out.nginx,/proxy_pass http:\/\/unix:\/run\/example-auth\/auth.sock:;/);
 assert.doesNotMatch(out.nginx,/^\s*(?:listen|ssl_certificate|rewrite|proxy_set_header X-Forwarded-Prefix)\b/m);
 assert.throws(()=>renderTenantPathCandidate({...input,registry:undefined}));
 assert.throws(()=>renderTenantPathCandidate({...input,origin:'https://8415wallet.com'}));
 assert.throws(()=>renderTenantPathCandidate({...input,registry:{...input.registry,defaultWalletNames:[tenant]}}));
 assert.throws(()=>renderTenantPathCandidate({...input,registry:{...input.registry,routes:[...input.registry.routes,...input.registry.routes]}}));
});
test('new path journals remain fail-closed, never create empty or import old authority',()=>{
 assert.throws(()=>requireLegacyJournalLocation(origin+'/example-one/web/browser-journal-store.mjs',{pathname:'/example-one'}),/MIGRATION_REQUIRED/);
 assert.throws(()=>requireLegacyJournalLocation(origin+'/example-one/web/browser-journal-store.mjs',{pathname:'/example-one/web/index-v3.html'}),/MIGRATION_REQUIRED/);
 assert.throws(()=>requireLegacyJournalLocation(origin+'/example-one/web/browser-journal-store.mjs',{pathname:'/other'}),/MIGRATION_REQUIRED/);
 assert.doesNotThrow(()=>requireLegacyJournalLocation(origin+'/v3/web/browser-journal-store.mjs',{pathname:'/platform-account'}));
 assert.doesNotThrow(()=>requireLegacyJournalLocation(origin+'/web/browser-journal-store.mjs',{pathname:'/platform-account'}));
});
test('headless agent login stays API-only and uses the same fixed path/cookie contract',async()=>{
 const {Wallet}=await import('ethers');
 const {createAgentApiSession}=await import('../server/agent-api-session.mjs');
 const wallet=Wallet.createRandom(), paths=[];
 const service=createAuthService({origin,tenant,basePath:'/example-one',store:new MemoryCredentialStore(),accounts:[{username:'tester',wallets:[{account:wallet.address,chainId:'1'}]}]});
 const transport={async request({path,body,headers}){
   paths.push(path);
   const response=await call(service,path,{body,cookie:headers.Cookie??'',csrf:headers['X-Wallet-CSRF']??''});
   return {status:response.statusCode,data:response.body,headers:{...response.headers,'set-cookie':response.headers['set-cookie']?[response.headers['set-cookie']].flat():[]}};
 }};
 const session=createAgentApiSession({origin,tenant,basePath:'/example-one',account:wallet.address,chainId:'1',transport,loginSigner:{signLoginMessage:({message})=>wallet.signMessage(message)}});
 const result=await session.authenticate();assert.equal(result.tenant,tenant);
 await session.checkSession();await session.logout();
 assert.deepEqual(paths,['bootstrap','challenge','proof','session','logout'].map(path=>'/example-one/auth/'+path));
});
test('runtime config requires an exact explicit path; null never downgrades to legacy',async()=>{
 const {validateAuthConfig}=await import('../server/config-validation.mjs');
 const config={origin,tenant,basePath:'/example-one',port:18000,statePath:'/tmp/synthetic-state.enc',accounts:[]};
 assert.doesNotThrow(()=>validateAuthConfig(config));
 for(const basePath of [null,false,'/example-two','/example-one/']) assert.throws(()=>validateAuthConfig({...config,basePath}));
 const {basePath,...legacy}=config;assert.doesNotThrow(()=>validateAuthConfig(legacy));
});
