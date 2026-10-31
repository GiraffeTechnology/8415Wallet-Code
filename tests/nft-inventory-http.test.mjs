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
import { validateNftInventory, safeNftMediaUrl } from '../web/nft-inventory-client.mjs';
const account = '0x0000000000000000000000000000000000000001', other = '0x0000000000000000000000000000000000000002';
const password = 'synthetic-funds-fixture-only', passwordHash = await hashPassword(password);
const blockHash = '0x'+'1'.repeat(64);
const contract='0x0000000000000000000000000000000000000010';
function source(context) {
 return {schema:'8415-authoritative-nft-inventory/1',scope:{...context.principal},readId:context.readId,observedAt:Date.now()-100,validUntil:Date.now()+60000,inventoryState:'complete',records:[{
 chainId:context.principal.chainId,contract,tokenId:'9007199254740993',standard:'ERC-721',balanceRaw:'1',blockNumber:'0x10',blockHash,
 metadata:{state:'unavailable',name:null,description:null,imageUrl:null},native:{state:'unavailable'},escrow:{state:'unavailable'},pending:{state:'unavailable'}}]};
}
async function fixture(t, options={}) {
 let handler; const state = {reads:0, transform:s=>s, contexts:[], fail:false, wait:null};
 const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const origin='http://127.0.0.1:'+server.address().port;
 const registration={version:1,email:'owner@example.invalid',verifiedAt:1};
 const store=new MemoryCredentialStore({'fixture:owner':{registration},'@registration:fixture':{version:1,records:[{username:'owner',email:registration.email,verifiedAt:1}]}});
 handler=createAuthService({origin,tenant:'fixture',store,accounts:[{username:'owner',passwordHash,wallets:[{account,chainId:'1'},{account:other,chainId:'1'},{account,chainId:'560048'}]}],
 nftInventoryReader:options.disabled?null:options.reader??{async readForPrincipal(context){state.reads++;state.contexts.push(context);if(state.wait)await state.wait;if(state.fail)throw Error('private source endpoint and counterparty');return state.transform(source(context));}}});
 const jar=new Map();
 const transport=async(url,input)=>{const response=await fetch(url,{...input,headers:{...input.headers,Origin:origin,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});for(const cookie of response.headers.getSetCookie()){const [k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}return response;};
 const client=new AccountAuthClient({origin,tenant:'fixture',fetcher:transport});
 const login=async(selected={account,chainId:'1'})=>client.adapter('password',{username:'owner',password}).authenticate(selected,null);
 await login();return {state,client,login,scope:{tenant:'fixture',origin,account,chainId:'1'}};
}
test('actual authenticated HTTP reads scoped lossless NFT holdings with no neighboring identities',async t=>{
 const f=await fixture(t);assert.equal((await f.client.account()).nftInventoryAvailable,true);
 const v=await f.client.readNftInventory();assert.equal(v.state,'ready');assert.equal(v.records[0].tokenId,'9007199254740993');assert.equal(v.records[0].native.state,'unavailable');
 assert.equal(f.state.reads,1);assert.equal(f.state.contexts[0].principal.account,account);assert.doesNotMatch(JSON.stringify(v),/username|owner|holder|private|counterparty/);
});
test('missing reader or failure never becomes complete empty',async t=>{
 const f=await fixture(t,{disabled:true});assert.equal((await f.client.account()).nftInventoryAvailable,false);await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_NOT_ENABLED/);assert.equal(f.state.reads,0);
 const on=await fixture(t);on.state.fail=true;await assert.rejects(on.client.readNftInventory(),/NFT_INVENTORY_SOURCE_UNAVAILABLE/);
});
test('unauthenticated and missing CSRF source access denied',async t=>{
 const f=await fixture(t);const r=await fetch(f.scope.origin+'/auth/assets/nft-inventory',{method:'POST',headers:{Origin:f.scope.origin,'X-Wallet-Tenant':'fixture','Content-Type':'application/json'},body:JSON.stringify({readId:'a'.repeat(32)})});assert.equal(r.status,401);assert.equal(f.state.reads,0);
});
test('caller cannot inject principal chain data discovery or source',async t=>{
 const f=await fixture(t);for(const extra of [{account:other},{chainId:'560048'},{records:[]},{reader:'https://example.com'},{inventoryState:'complete'}])await assert.rejects(f.client.request('assets/nft-inventory',{readId:'a'.repeat(32),...extra}),/NFT_INVENTORY_REQUEST_REFUSED/);assert.equal(f.state.reads,0);
});
test('source scope read nonce and record chain must match actual session',async t=>{
 const f=await fixture(t);for(const [key,value]of [['account',other],['chainId','560048'],['tenant','other'],['origin','https://example.com'],['username','other']]){f.state.transform=s=>({...s,scope:{...s.scope,[key]:value}});await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);}
 f.state.transform=s=>({...s,readId:'a'.repeat(32)});await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);
 f.state.transform=s=>{s.records[0].chainId='560048';return s;};await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);
});
test('partial stays partial; expired or unavailable snapshots suppress holdings; empty complete is explicit',async t=>{
 const f=await fixture(t);f.state.transform=s=>({...s,inventoryState:'partial'});let v=await f.client.readNftInventory();assert.equal(v.state,'partial');assert.equal(v.records.length,1);
 for(const status of ['stale','unavailable']){f.state.transform=s=>({...s,inventoryState:status});v=await f.client.readNftInventory();assert.equal(v.state,status);assert.deepEqual(v.records,[]);}
 f.state.transform=s=>({...s,validUntil:Date.now()-1});assert.equal((await f.client.readNftInventory()).state,'stale');
 f.state.transform=s=>({...s,records:[]});assert.equal((await f.client.readNftInventory()).state,'ready');
});
test('malformed uint, zero holdings, duplicate tokens, private fields and invented native data fail closed',async t=>{
 const f=await fixture(t);const transforms=[s=>({...s,records:[...s.records,...s.records]}),s=>({...s,privateEndpoint:'secret'}),s=>{s.records[0].owner=other;return s;},s=>{s.records[0].native={state:'ready',holder:other};return s;}];
 for(const tokenId of ['-1','01','1e3',9007199254740993,(1n<<256n).toString()])transforms.push(s=>{s.records[0].tokenId=tokenId;return s;});
 transforms.push(s=>{s.records[0].balanceRaw='0';return s;});
 for(const transform of transforms){f.state.transform=transform;await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);}
});
test('metadata is bounded text, never fetched; unsafe URL forms refused',async t=>{
 const f=await fixture(t);f.state.transform=s=>{s.records[0].metadata={state:'available',name:'Synthetic NFT',description:'Plain text only',imageUrl:'https://media.example.com/image.png'};return s;};assert.equal((await f.client.readNftInventory()).records[0].metadata.name,'Synthetic NFT');
 for(const url of ['javascript:alert(1)','data:image/svg+xml,a','http://example.com/a','https://127.0.0.1/a','https://localhost/a','https://a.internal/a','https://u:p@example.com/a','https://example.com/a?token=secret','https://example.com/a#secret','https://[::1]/a']){assert.equal(safeNftMediaUrl(url),false);f.state.transform=s=>{s.records[0].metadata={state:'available',name:null,description:null,imageUrl:url};return s;};await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);}
});
test('client refuses replay, privacy extras, duplicates and expired fresh projection',async t=>{
 const f=await fixture(t),v=await f.client.readNftInventory(),binding={scope:f.scope,readId:v.readId};
 for(const altered of [{...v,readId:'0'.repeat(32)},{...v,scope:{...v.scope,account:other}},{...v,neighbor:other},{...v,records:[...v.records,...v.records]}])assert.throws(()=>validateNftInventory(altered,binding),/NFT_INVENTORY_RESPONSE_REFUSED/);
 assert.throws(()=>validateNftInventory(v,binding,v.validUntil),/NFT_INVENTORY_RESPONSE_REFUSED/);
});
test('logout while reader awaits revokes response; each next account chain is independently scoped',async t=>{
 const f=await fixture(t);let release;f.state.wait=new Promise(r=>release=r);const pending=f.client.readNftInventory();while(f.state.reads===0)await new Promise(r=>setTimeout(r,5));await f.client.logout();release();await assert.rejects(pending,/AUTH_REFUSED|LOGIN_CANCELLED/);
 f.state.wait=null;await f.login({account:other,chainId:'1'});assert.equal((await f.client.readNftInventory()).scope.account,other);await f.login({account,chainId:'560048'});assert.equal((await f.client.readNftInventory()).records[0].chainId,'560048');
});
function readyDetails(row){
 const word='0x'+'2'.repeat(64),zero='0x'+'0'.repeat(64);
 const track=position=>({state:'observed',position,changedThrough:position,unchangedThrough:'2',untradedThrough:'3',ratio:{numerator:position,denominator:'3'}});
 return {...row,native:{state:'ready',registerId:word,verificationProfile:word,entry:{version:'1',effectiveAt:'100',supersededAt:'0',recordCommitment:word,previousCommitment:zero,registryReference:zero},instant:'200',finality:false,gap:{state:'none'},settlement:{state:'none',settlementId:null}},
 escrow:{state:'ready',inventoryState:'complete',records:[{reservationId:'synthetic-reservation',currency:{chainId:row.chainId,kind:'native',contract:null,decimals:18},amountBaseUnits:'9007199254740993',state:'held',blockHash:row.blockHash}]},
 pending:{state:'ready',progress:{schema:'8415-forward-progress/1',asset:{chainId:row.chainId,contract:row.contract,tokenId:row.tokenId},sequenceId:word,userPosition:'1',sourceRevision:'1',blockNumber:BigInt(row.blockNumber).toString(),blockHash:row.blockHash,knownEnd:'2',scaleEnd:'3',state:'DONE',owner:track('2'),holder:track('1'),funds:{state:'not-evaluated'},rollback:{state:'not-evaluated'},protocolFinality:false,commercialExecution:'not-evaluated',canExecute:false,recordRevision:'1',frozen:true}}};
}
test('ready native parameters, original principal and existing frozen Pending projection survive HTTP without identities',async t=>{
 const f=await fixture(t);f.state.transform=s=>({...s,records:s.records.map(readyDetails)});const v=await f.client.readNftInventory();
 assert.equal(v.records[0].native.finality,false);assert.equal(v.records[0].native.entry.version,'1');assert.equal(v.records[0].escrow.records[0].amountBaseUnits,'9007199254740993');assert.equal(v.records[0].pending.progress.state,'DONE');
 assert.equal(v.records[0].pending.progress.frozen,true);assert.doesNotMatch(JSON.stringify(v),/username|counterparty|"holder":"0x/);
});
test('ready details reject cross-NFT Pending, wrong currency chain, source block, duplicates, nested private fields and malformed native ints',async t=>{
 const f=await fixture(t);for(const mutate of [r=>r.pending.progress.asset.tokenId='42',r=>r.escrow.records[0].currency.chainId='560048',r=>r.escrow.records[0].blockHash='0x'+'3'.repeat(64),r=>r.escrow.records.push({...r.escrow.records[0]}),r=>r.native.entry.holder=other,r=>r.native.entry.version='18446744073709551616',r=>r.pending.progress.owner.address=other]){
 f.state.transform=s=>{s.records=s.records.map(readyDetails);mutate(s.records[0]);return s;};await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);}
});
test('unknown principal is explicit, partial detail enumeration is not zero or complete',async t=>{
 const f=await fixture(t);f.state.transform=s=>{s.records=s.records.map(readyDetails);s.records[0].escrow.inventoryState='partial';s.records[0].escrow.records[0].state='unknown';return s;};const v=await f.client.readNftInventory();assert.equal(v.records[0].escrow.inventoryState,'partial');assert.equal(v.records[0].escrow.records[0].state,'unknown');
});
test('service captures configured source function rather than a replaceable object method',async()=>{
 const {createNftInventoryService}=await import('../server/nft-inventory-service.mjs');let reads=0;
 const reader={async readForPrincipal(c){reads++;return source(c);}};
 const service=createNftInventoryService({reader,origin:'https://wallet.example.com',tenant:'fixture',validateSession:async()=>{}});
 reader.readForPrincipal=async()=>{throw Error('replacement');};const v=await service.read({readId:'a'.repeat(32)},{username:'owner',account,chainId:'1'});assert.equal(v.state,'ready');assert.equal(reads,1);
});
test('HTTP client traverses server discovery and actual pinned read-only RPC adapter',async t=>{
 const {createRpcNftInventoryReader}=await import('../server/nft-inventory-reader.mjs');const {encodeCall}=await import('../src/codec/abi.ts');const calls=[];
 const reader=createRpcNftInventoryReader({discovery:{async listForPrincipal(c){return {scope:{...c.principal},readId:c.readId,observedAt:Date.now()-1,validUntil:Date.now()+60000,inventoryState:'complete',blockNumber:'0x10',blockHash,tokens:[{contract,tokenId:'9007199254740993',standard:'ERC-721',metadata:{state:'unavailable',name:null,description:null,imageUrl:null}}]};}},rpcForPrincipal:async principal=>({async request({method,params}){
  calls.push(method);if(method==='eth_chainId')return '0x1';if(method==='eth_getBlockByNumber')return {number:'0x10',hash:blockHash};if(method==='eth_getCode')return '0x6000';assert.equal(method,'eth_call');assert.equal(params[1],'0x10');
  for(const iid of ['0x01ffc9a7','0xffffffff','0x80ac58cd','0x6309e170'])if(params[0].data===encodeCall('supportsInterface(bytes4)',['bytes4'],[iid]))return '0x'+'0'.repeat(63)+(['0xffffffff','0x6309e170'].includes(iid)?'0':'1');
  assert.equal(params[0].data,encodeCall('ownerOf(uint256)',['uint256'],[9007199254740993n]));return '0x'+'0'.repeat(24)+principal.account.slice(2);
 }})});
 const f=await fixture(t,{reader});const value=await f.client.readNftInventory();assert.equal(value.state,'ready');assert.equal(value.records[0].balanceRaw,'1');assert.equal(value.records[0].native.state,'not-applicable');assert.equal(calls.filter(m=>m==='eth_getBlockByNumber').length,2);assert.ok(!calls.some(m=>/send|sign|accounts/i.test(m)));
});
test('replayed source nonce and future-dated observation are refused',async t=>{
 const f=await fixture(t);let prior;f.state.transform=s=>{prior=s;return s;};await f.client.readNftInventory();f.state.transform=()=>prior;await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);
 f.state.transform=s=>({...s,observedAt:Date.now()+60000,validUntil:Date.now()+120000});await assert.rejects(f.client.readNftInventory(),/NFT_INVENTORY_SOURCE_REFUSED/);
});
