/** Synthetic trusted reader + actual authenticated loopback HTTP. No live RPC or writes. */
import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {once} from 'node:events';
import {createAuthService} from '../server/auth-service.mjs';import {MemoryCredentialStore} from '../server/store.mjs';
import {hashPassword} from '../server/crypto.mjs';import {AccountAuthClient} from '../web/account-auth.mjs';
import {projectCoordination} from '../server/coordination-projection.mjs';import {validateForwardProgress} from '../web/forward-progress-client.mjs';
const h=n=>'0x'+n.toString(16).padStart(64,'0'),a=n=>'0x'+n.toString(16).padStart(40,'0');
const password='synthetic-coordination-only',passwordHash=await hashPassword(password);
function source({owner=2,holder=1,outcomes=['active','active'],states=['funded','funded'],block=10}={}){
 const asset={chainId:1n,contract:a(99),tokenId:7n},sequenceId=h(1),revision=BigInt(block),blockNumber=BigInt(block),blockHash=h(block);
 const snapshot={asset,sequenceId,revision,blockNumber,blockHash,initialHolder:a(10),initialOccurrenceId:h(100),legs:outcomes.map((outcome,i)=>({id:h(200+i),predecessorId:i?h(199+i):null,buyerOccurrenceId:h(101+i),seller:a(10+i),buyer:a(11+i),termsHash:h(300+i),control:{controlId:h(400+i),acceptanceHash:h(500+i)},outcome}))};
 const evidence={kind:'bound',asset,sequenceId,revision,blockNumber,blockHash,owner:{occurrenceId:h(100+owner),account:a(10+owner)},admittedHolder:{occurrenceId:h(100+holder),account:a(10+holder)},protocolFinality:false};
 const payments=states.map((state,i)=>({sequenceId,legId:h(200+i),amount:state==='unfunded'?0n:100n,state,payer:a(30+i),payee:a(29+i)}));
 return {snapshot,evidence,payments,ownOccurrenceId:h(101),historical:[]};
}
async function fixture(t){
 let handler;const server=createServer((req,res)=>handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const origin='http://127.0.0.1:'+server.address().port,registration={version:1,email:'synthetic@example.invalid',verifiedAt:1};
 const store=new MemoryCredentialStore({'fixture:owner':{registration},'@registration:fixture':{version:1,records:[{username:'owner',email:registration.email,verifiedAt:1}]}});
 const state={source:source(),mutate:x=>x,wait:null,started:0,reads:0,history:new Map()};
 handler=createAuthService({origin,tenant:'fixture',store,accounts:[{username:'owner',passwordHash,wallets:[{account:a(11),chainId:'1'}]}],forwardProgressReader:{async readForPrincipal(){return state.source;},async validateMilestone(){return true;},async readCoordination(q){state.reads++;state.started++;if(state.wait)await state.wait;const s=state.history.get(q.anchor.blockHash)??state.source;const view=projectCoordination(s);return state.mutate({...q,view});}}});
 const jar=new Map(),client=new AccountAuthClient({origin,tenant:'fixture',fetcher:async(url,input)=>{const res=await fetch(url,{...input,headers:{...input.headers,Origin:origin,Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});for(const c of res.headers.getSetCookie()){const[k,v]=c.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}return res;}});
 await client.adapter('password',{username:'owner',password}).authenticate({account:a(11),chainId:'1'},null);
 const input={asset:{chainId:'1',contract:a(99),tokenId:'7'},sequenceId:h(1)};
 return {client,state,input,read:()=>client.readForwardProgress(input)};
}
test('same-block own-leg funds /2 via actual HTTP preserves frozen forward but updates finance',async t=>{
 const f=await fixture(t),first=await f.read();assert.equal(first.schema,'8415-forward-progress/2');assert.equal(first.frozen,true);assert.equal(first.funds.legs.length,2);
 f.state.source=source({holder:2,outcomes:['completed','completed'],states:['settled','settlement-due'],block:11});
 const next=await f.read();assert.equal(next.blockNumber,'10');assert.equal(next.coordination.blockNumber,'11');assert.equal(next.funds.legs[0].state,'settled');assert.equal(next.funds.legs[1].locationPosition,null);assert.equal(next.canExecute,false);
 for(const address of [a(10),a(11),a(12),a(29),a(30),a(31)])assert.equal(JSON.stringify(next).includes(address),false);
});
test('token return and refund due remain separate; coordinated DONE freezes canonical observation',async t=>{
 const f=await fixture(t);f.state.source=source({owner:0,holder:0,outcomes:['returned','returned'],states:['refunded','refund-due']});
 const pending=await f.read();assert.equal(pending.rollback.tokenState,'returned');assert.equal(pending.rollback.fundsState,'pending');assert.equal(pending.rollback.state,'PENDING');
 f.state.source=source({owner:0,holder:0,outcomes:['returned','returned'],states:['refunded','refunded'],block:11});
 const done=await f.read();assert.equal(done.rollback.state,'DONE');assert.equal(done.rollback.frozen,true);assert.equal(done.funds.legs[0].locationPosition,'1');assert.equal(done.rollback.fundsPosition,null);
 f.state.history.set(h(11),f.state.source);f.state.source=source({owner:0,holder:2,outcomes:['returned','returned'],states:['refunded','refunded'],block:12});
 const later=await f.read();assert.deepEqual(later.rollback,done.rollback);assert.deepEqual(later.coordination,done.coordination);
 f.state.history.delete(h(11));await assert.rejects(f.read(),/COORDINATION_BLOCK_REFUSED/);
});
test('missing payment binding explicit unknown and empty payment is not callback evidence',()=>{
 const s=source();assert.equal(projectCoordination({...s,payments:null}).funds.state,'unknown');assert.equal(projectCoordination({...s,payments:null}).rollback.state,'unknown');
 const empty=source({states:['unfunded','unfunded']});assert.equal(projectCoordination(empty).rollback.state,'not-applicable');
 const returned=source({owner:0,holder:1,outcomes:['returned','returned'],states:['unfunded','unfunded']});const p=projectCoordination(returned);assert.equal(p.rollback.tokenState,'returned');assert.equal(p.rollback.state,'PENDING');assert.equal(p.rollback.fundsState,'not-required');
});
test('cross principal chain occurrence block revision and privacy fields rejected through HTTP',async t=>{
 const f=await fixture(t);for(const change of [r=>{r.principal={...r.principal,account:a(88)};},r=>{r.asset={...r.asset,chainId:'2'};},r=>{r.ownOccurrenceId=h(999);},r=>{r.view.coordination.blockHash=h(99);},r=>{r.view.coordination.sourceRevision='999';},r=>{r.view.funds.legs[0].payer=a(31);}]){
 f.state.mutate=r=>{change(r);return r;};await assert.rejects(f.read(),/COORDINATION_/);
 }
});
test('client refuses forged DONE or unsupported /2 fields while /1 is strictly retained',async t=>{
 const f=await fixture(t),v=await f.read();assert.equal(validateForwardProgress(v,f.input),v);
 const bad=structuredClone(v);bad.rollback.state='DONE';assert.throws(()=>validateForwardProgress(bad,f.input),/COORDINATION_RESPONSE_REFUSED/);
 const legacy={...v,schema:'8415-forward-progress/1',funds:{state:'not-evaluated'},rollback:{state:'not-evaluated'}};delete legacy.coordination;assert.equal(validateForwardProgress(legacy,f.input),legacy);
 assert.throws(()=>validateForwardProgress({...legacy,coordination:v.coordination},f.input),/RESPONSE_REFUSED/);
});
test('logout during coordination await rejects late response',async t=>{
 const f=await fixture(t);let release;f.state.wait=new Promise(r=>release=r);const read=f.read();while(!f.state.started)await new Promise(r=>setTimeout(r,1));await f.client.logout();release();await assert.rejects(read,/AUTH_REFUSED|LOGIN_CANCELLED/);
});
test('concurrent coordinate updates cannot overwrite a committed snapshot',async t=>{
 const f=await fixture(t);await f.read();f.state.source=source({holder:2,block:11});let release;f.state.wait=new Promise(r=>release=r);const first=f.read(),second=f.read();while(f.state.reads<3)await new Promise(r=>setTimeout(r,1));release();const results=await Promise.allSettled([first,second]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/REVISION_CHANGED/);
});
test('known contract state fixtures refuse refunded active leg and settlement after return',()=>{
 for(const s of [source({states:['refunded','funded']}),source({outcomes:['returned','returned'],states:['settled','refunded']})])assert.throws(()=>projectCoordination(s),/COORDINATION_SOURCE_REFUSED/);
});
