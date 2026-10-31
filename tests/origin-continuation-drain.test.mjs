/** Synthetic encrypted state and interruption points. No live service/config. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createDecipheriv } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEncryptedStore } from '../server/store.mjs';
import { createOriginContinuation, originContinuationKey } from '../server/origin-continuation.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const records = () => ({ 'fixture:alice': {revision:12,taskVerificationPolicies:{old:{mode:'OFF',revision:'9',changes:[{scopeDigest:'unchanged'}]}}},
  'task-grant:original':{principal:'original-signed-principal',status:'outcome-unknown',task:{digest:'original-digest'}},
  'task-nonce:original':{permanent:true,nonce:'7',transactionHash:'unchanged'},'task-queue:original':{entries:['task-grant:original']} });
const mapping = state => createOriginContinuation({schema:'8415wallet-origin-continuation/1',tenant:'fixture',
  authorizationOrigin:'https://wallet.example:9446',transportOrigin:'https://wallet.example',revision:'1',
  priorStateSha256:hash(state),contractDigest:'b'.repeat(64),principals:[{username:'alice',account:'0x'+'1'.repeat(40),chainId:'560048'}]});
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'wallet-origin-drain-')),file=join(dir,'synthetic.enc'),key=Buffer.alloc(32,58),handles=new Set();
  t.after(async()=>{for(const h of handles)await h.close();await rm(dir,{recursive:true,force:true});});
  const f={file,key,async open(){const h=await openEncryptedStore(file,key);handles.add(h);return h;},async close(h){await h.close();handles.delete(h);}};
  f.store=await f.open();const state=records();await f.store.transactionMany(Object.keys(state),()=>state);return {...f,state};
}
function decoded(raw,key) {
  const e=JSON.parse(raw),d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAAD(Buffer.from('8415wallet-auth-store/'+e.version));d.setAuthTag(Buffer.from(e.tag,'base64'));
  const payload=JSON.parse(Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()]).toString());return {version:e.version,records:e.version===1?payload:payload.records};
}
test('drained continuation adds only its exact mapping and retains saved OFF, UNKNOWN and nonce state',async t=>{
  const f=await fixture(t),m=mapping(f.state),stages=[];
  const promise=f.store.withOriginContinuation(m,async(stage,proof)=>{stages.push(stage);assert.equal(Object.hasOwn(proof,'records'),false);});
  await assert.rejects(f.store.transaction('new',()=>({})),/AUTH_STORE_CLOSED/);
  const proof=await promise;await f.close(f.store);assert.deepEqual(stages,['prepared','committed']);
  const result=decoded(await readFile(f.file,'utf8'),f.key);assert.equal(result.version,5);
  assert.deepEqual(result.records[originContinuationKey(m)],m);delete result.records[originContinuationKey(m)];assert.deepEqual(result.records,f.state);
  assert.equal(proof.beforeStateSha256,hash(f.state));const next=await f.open();assert.deepEqual(await next.read('task-nonce:original'),f.state['task-nonce:original']);
});
test('failed durable-journal preparation leaves original ciphertext intact and admission closed',async t=>{
  const f=await fixture(t),before=await readFile(f.file);
  await assert.rejects(f.store.withOriginContinuation(mapping(f.state),async()=>{throw Error('SYNTHETIC_JOURNAL_FAILURE');}),/SYNTHETIC_JOURNAL_FAILURE/);
  assert.deepEqual(await readFile(f.file),before);await assert.rejects(f.store.read('fixture:alice'),/AUTH_STORE_CLOSED/);await f.close(f.store);
});
test('postcommit interruption recovers forward without another ciphertext write or changed original records',async t=>{
  const f=await fixture(t),m=mapping(f.state);
  await assert.rejects(f.store.withOriginContinuation(m,async stage=>{if(stage==='committed')throw Error('SYNTHETIC_INTERRUPTION');}),/SYNTHETIC_INTERRUPTION/);
  await f.close(f.store);const committed=await readFile(f.file),reopened=await f.open(),stages=[];
  await reopened.withOriginContinuation(m,async stage=>stages.push(stage));await f.close(reopened);
  assert.deepEqual(stages,['recovered']);assert.deepEqual(await readFile(f.file),committed);
});
test('admitted write changes the prestate before the drain; stale transition cannot overwrite it',async t=>{
  const f=await fixture(t),m=mapping(f.state);const admitted=f.store.transaction('fixture:alice',x=>({...x,revision:13}));
  const transition=f.store.withOriginContinuation(m,async()=>assert.fail('stale preparation must not run'));await admitted;
  await assert.rejects(transition,/AUTH_ORIGIN_CONTINUATION_STATE_CHANGED/);await f.close(f.store);
  const reopened=await f.open();assert.equal((await reopened.read('fixture:alice')).revision,13);assert.equal(await reopened.read(originContinuationKey(m)),null);
});
