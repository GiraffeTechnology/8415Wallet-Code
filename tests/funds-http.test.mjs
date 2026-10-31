/** Synthetic authoritative-reader fixture through actual authenticated loopback HTTP.
 * No external RPC, credentials, financial data, signing, deployments or transactions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
import { AccountAuthClient } from '../web/account-auth.mjs';
import { validateFunds } from '../web/funds-client.mjs';
const account = '0x0000000000000000000000000000000000000001', other = '0x0000000000000000000000000000000000000002';
const password = 'synthetic-funds-fixture-only', passwordHash = await hashPassword(password);
const blockHash = '0x'+'1'.repeat(64);
const currency = { chainId:'1', kind:'native', contract:null, decimals:18 };
function source(context) {
 const line = {kind:'financial-principal',reservationId:'reservation-one',nftId:'nft-reference-one',currency,amountBaseUnits:'30',state:'held',blockHash};
 return {schema:'8415-authoritative-funds/1',scope:{...context.principal},readId:context.readId,observedAt:Date.now()-100,validUntil:Date.now()+60000,inventoryState:'complete',currencies:[{
 currency,state:'ready',balanceBasis:'wallet-liquid',balanceBaseUnits:'70',blockHash,escrowState:'complete',escrows:[line,{...line}]}]};
}
async function fixture(t, options={}) {
 let handler; const state = {reads:0, transform:s=>s, contexts:[], fail:false, wait:null};
 const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const origin='http://127.0.0.1:'+server.address().port;
 const registration={version:1,email:'owner@example.invalid',verifiedAt:1};
 const store=new MemoryCredentialStore({'fixture:owner':{registration},'@registration:fixture':{version:1,records:[{username:'owner',email:registration.email,verifiedAt:1}]}});
 handler=createAuthService({origin,tenant:'fixture',store,accounts:[{username:'owner',passwordHash,wallets:[{account,chainId:'1'},{account:other,chainId:'1'},{account,chainId:'560048'}]}],
 fundsReader:options.disabled?null:{async readForPrincipal(context){state.reads++;state.contexts.push(context);if(state.wait)await state.wait;if(state.fail)throw Error('private source endpoint and counterparty');return state.transform(source(context));}}});
 const jar=new Map();
 const transport=async(url,input)=>{const response=await fetch(url,{...input,headers:{...input.headers,Origin:origin,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});for(const cookie of response.headers.getSetCookie()){const [k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}return response;};
 const client=new AccountAuthClient({origin,tenant:'fixture',fetcher:transport});
 const login=async(selected={account,chainId:'1'})=>client.adapter('password',{username:'owner',password}).authenticate(selected,null);
 await login();return {state,client,login,scope:{tenant:'fixture',origin,account,chainId:'1'}};
}
test('authenticated HTTP reads authoritative principal once, deduplicates escrow, emits only owner projection',async t=>{
 const f=await fixture(t);assert.equal((await f.client.account()).fundsAvailable,true);
 const v=await f.client.readFunds();assert.equal(v.state,'ready');assert.equal(v.currencies[0].totalBaseUnits,'100');assert.equal(v.currencies[0].unreleasedBaseUnits,'30');assert.equal(v.currencies[0].availableBaseUnits,'70');
 assert.equal(v.currencies[0].principalRecords.length,1);assert.equal(f.state.reads,1);assert.equal(f.state.contexts[0].principal.account,account);assert.equal(f.state.contexts[0].principal.username,'owner');
 assert.doesNotMatch(JSON.stringify(v),/username|financial-principal|payer|payee/);
});
test('unknown principal and incomplete escrow never imply zero available',async t=>{
 const f=await fixture(t);f.state.transform=s=>{s.currencies[0].escrows.forEach(x=>x.state='unknown');return s;};
 let v=await f.client.readFunds();assert.equal(v.state,'partial');assert.equal(v.currencies[0].reason,'PRINCIPAL_OUTCOME_UNKNOWN');assert.equal(v.currencies[0].availableBaseUnits,null);
 f.state.transform=s=>{s.currencies[0].escrowState='unavailable';s.currencies[0].escrows=[];return s;};
 v=await f.client.readFunds();assert.equal(v.currencies[0].totalBaseUnits,null);
});
test('partial, unavailable, expired inventories cannot claim a complete empty wallet',async t=>{
 const f=await fixture(t);
 for(const status of ['partial','unavailable','stale']){f.state.transform=s=>({...s,inventoryState:status,currencies:[]});const v=await f.client.readFunds();assert.equal(v.state,status);}
 f.state.transform=s=>({...s,validUntil:Date.now()-1});const v=await f.client.readFunds();assert.equal(v.state,'stale');assert.equal(v.currencies[0].totalBaseUnits,null);
});
test('unconfigured/source failures are explicit, sanitized and never ready empty',async t=>{
 const off=await fixture(t,{disabled:true});assert.equal((await off.client.account()).fundsAvailable,false);await assert.rejects(off.client.readFunds(),/FUNDS_NOT_ENABLED/);assert.equal(off.state.reads,0);
 const f=await fixture(t);f.state.fail=true;await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_UNAVAILABLE$/);
});
test('caller cannot select account, chain, source, data or completeness',async t=>{
 const f=await fixture(t);
 for(const extra of [{account:other},{chainId:'560048'},{reader:'https://untrusted.invalid'},{currencies:[]},{inventoryState:'complete'}])
 await assert.rejects(f.client.request('assets/funds',{readId:'a'.repeat(32),...extra}),/FUNDS_REQUEST_REFUSED/);
 assert.equal(f.state.reads,0);
});
test('authoritative reader must independently echo exact account chain tenant origin user and read context',async t=>{
 const f=await fixture(t);
 for(const [key,value] of [['account',other],['chainId','560048'],['tenant','elsewhere'],['origin','https://other.invalid'],['username','other']]){
 f.state.transform=s=>({...s,scope:{...s.scope,[key]:value}});await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_REFUSED/);}
 f.state.transform=s=>({...s,readId:'f'.repeat(32)});await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_REFUSED/);
 f.state.transform=s=>{s.currencies[0].currency={...currency,chainId:'560048'};return s;};await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_REFUSED/);
});
test('conflicting duplicate escrow refuses rather than double counts or picks one',async t=>{
 const f=await fixture(t);f.state.transform=s=>{s.currencies[0].escrows[1].amountBaseUnits='31';return s;};await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_REFUSED/);
});
test('fresh complete explicit empty source is distinguished from unavailable',async t=>{
 const f=await fixture(t);f.state.transform=s=>({...s,currencies:[]});const v=await f.client.readFunds();assert.equal(v.state,'ready');assert.equal(v.inventoryState,'complete');assert.deepEqual(v.currencies,[]);
});
test('decoder refuses replay, wrong scope, additional private keys and arithmetic manipulation',async t=>{
 const f=await fixture(t),v=await f.client.readFunds();const binding={scope:f.scope,readId:v.readId};
 for(const altered of [{...v,readId:'0'.repeat(32)},{...v,scope:{...v.scope,account:other}},{...v,counterparty:other},{...v,currencies:[{...v.currencies[0],availableBaseUnits:'99'}]}])assert.throws(()=>validateFunds(altered,binding),/FUNDS_RESPONSE_REFUSED/);
 assert.throws(()=>validateFunds(v,binding,v.validUntil),/FUNDS_RESPONSE_REFUSED/);
});
test('logout during source await revokes server read before response',async t=>{
 const f=await fixture(t);let release;f.state.wait=new Promise(r=>release=r);const pending=f.client.readFunds();
 while(f.state.reads===0)await new Promise(r=>setTimeout(r,5));await f.client.logout();release();await assert.rejects(pending,/AUTH_REFUSED|LOGIN_CANCELLED/);
});
test('selected authenticated account and chain are derived independently on each new session',async t=>{
 const f=await fixture(t);
 await f.login({account:other,chainId:'1'});const otherView=await f.client.readFunds();assert.equal(otherView.scope.account,other);assert.equal(f.state.contexts.at(-1).principal.account,other);
 await f.login({account,chainId:'560048'});f.state.transform=s=>({...s,currencies:[]});const chainView=await f.client.readFunds();assert.equal(chainView.scope.chainId,'560048');assert.equal(f.state.contexts.at(-1).principal.chainId,'560048');
});
test('unauthenticated and missing-CSRF HTTP reads cannot reach the source',async t=>{
 const f=await fixture(t);const response=await fetch(f.scope.origin+'/auth/assets/funds',{method:'POST',headers:{Origin:f.scope.origin,'X-Wallet-Tenant':'fixture','Content-Type':'application/json'},body:JSON.stringify({readId:'a'.repeat(32)})});assert.equal(response.status,401);assert.equal(f.state.reads,0);
});
test('a prior source response and future-dated snapshot are refused on a fresh read',async t=>{
 const f=await fixture(t);let previous;f.state.transform=s=>{previous=s;return s;};await f.client.readFunds();f.state.transform=()=>previous;await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_REFUSED/);
 f.state.transform=s=>({...s,observedAt:Date.now()+60000,validUntil:Date.now()+120000});await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_REFUSED/);
});
test('original held/released/refunded/unknown details are read-only, per-NFT, deduplicated and not invented events',async t=>{
 const f=await fixture(t);f.state.transform=s=>{const row=s.currencies[0];row.escrows.push(...['released','refunded'].map(state=>({...row.escrows[0],reservationId:'reservation-'+state,state,amountBaseUnits:'12'})));return s;};
 const v=await f.client.readFunds(),row=v.currencies[0];assert.deepEqual(row.principalRecords.map(x=>x.state),['held','released','refunded']);assert.equal(row.totalBaseUnits,'100');assert.equal(row.unreleasedBaseUnits,'30');assert.equal(row.availableBaseUnits,'70');assert.equal(row.canExecute,false);
 assert.deepEqual(Object.keys(row.principalRecords[0]).sort(),['amountBaseUnits','blockHash','nftId','reservationId','state']);
 f.state.transform=s=>{s.currencies[0].escrows[0].state='unknown';s.currencies[0].escrows[1].state='unknown';return s;};const unknown=await f.client.readFunds();assert.equal(unknown.currencies[0].principalRecords[0].state,'unknown');assert.equal(unknown.currencies[0].totalBaseUnits,null);
});
test('records after an unknown outcome are still fully checked, rather than skipped by aggregate early return',async t=>{
 const f=await fixture(t);f.state.transform=s=>{s.currencies[0].escrows[0].state='unknown';s.currencies[0].escrows[1].state='unknown';s.currencies[0].escrows[1].amountBaseUnits='31';return s;};await assert.rejects(f.client.readFunds(),/FUNDS_SOURCE_REFUSED/);
});
