/** Real task-service composition with synthetic adapters. Sends below are fixture
 * counters, never RPC calls, real signatures, broadcasts or chain acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCredentialStore } from '../server/store.mjs';
import { createTaskAuthorizationService } from '../server/task-authorization.mjs';
import { base32, digest, hotp, matchTotp } from '../server/crypto.mjs';
import { createOriginContinuation, originContinuationKey } from '../server/origin-continuation.mjs';
import { createOriginRealmRouter } from '../server/origin-realm-router.mjs';
import { freezeChildOperation } from '../src/agent/taskContract.ts';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';
const tenant = 'fixture', origin = 'https://wallet.example', old = origin + ':9446';
const actor = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40), txHash = '0x' + 'a'.repeat(64);
const session = { username: 'alice', account: actor, chainId: '560048', revision: 1,
  id: 'synthetic:session', issuedAt: 1800000000000, expiresAt: 1800000900000 };
async function fixture({ failSend = false } = {}) {
  const state = { now: 1800000000000 }, secret = base32(Buffer.alloc(20,55));
  const store = new MemoryCredentialStore({ 'fixture:alice': { secret,lastStep: -1,revision: 1 } });
  const calls = { verify: 0,send: 0,recover: 0 }, executor = { schema: '8415-task-executor/1',agentId: 'synthetic:agent',agentVersion: '1',
    adapterId: 'synthetic:adapter',adapterVersion: '1',implementationDigest: '0x' + '9'.repeat(64) };
  const observationPolicy = freezeTaskObservationPolicy({minimumConfirmations: '2'});
  const identity = {verifierId: 'synthetic:receipt',verifierVersion: '1',verifierImplementationDigest: '0x' + '7'.repeat(64)};
  const binding = input => ({ taskDigest: input.task.digest,childDigest: input.child.digest,chainId: input.child.child.operation.chainId,
    actor: input.child.child.operation.actor,nonce: input.child.child.nonce,executorDigest: input.executor.digest,grantPolicyVersion: input.grantPolicyVersion });
  const execution = { async verify(input) {calls.verify++;return binding(input);},async send(input) {
    calls.send++;if(failSend)throw Error('Synthetic response lost');return {...binding(input),transactionHash:txHash};
  },async recover(input) {calls.recover++;return {...binding(input),state:'submitted',transactionHash:txHash};} };
  const receipt = {identity,observationPolicy,async assessChild(input) {return {taskDigest:input.task.digest,childDigest:input.child.digest,
    executorDigest:input.executor.digest,observationPolicyDigest:observationPolicy.digest,...identity,capability:'exact-operation-observable'};},
    async observe() {throw Error('Observation is outside this fixture');}};
  const assertSession = (s,c) => { assert.equal(s.username,session.username);if(c!==undefined)assert.equal(c.revision,1); };
  function createRealm(realmOrigin, assertPrincipal = () => {}) {
    return { taskService: createTaskAuthorizationService({origin:realmOrigin,tenant,store,now:()=>state.now,execution,executorIdentity:executor,
      observationPolicy:observationPolicy.policy,receipt,assertSession,assertPrincipal,
      async credentialFor(s) {const c=await store.read('fixture:'+s.username);assertSession(s,c);return c;},
      consumeTotp(s,c,code) {assertSession(s,c);const step=matchTotp(c.secret,code,state.now,c.lastStep);assert.notEqual(step,null);return {...c,lastStep:step};}
    }) };
  }
  const policy = {schema:'8415-agent-task/1',taskId:'synthetic:continuation',tenant,origin:old,chainId:session.chainId,actor,
    expiresAt:'1800007200',fees:{perOperationWei:'100000',totalWei:'200000'},
    intent:{kind:'exact-operation',operation:{kind:'native-transfer',chainId:session.chainId,actor,recipient,valueWei:'10'}}};
  const previous=createRealm(old).taskService;
  const prepared=await previous.handler('tasks/prepare',{policy},session);
  const approved=await previous.handler('tasks/authorize',{challengeId:prepared.challengeId,taskDigest:prepared.task.digest,
    executorDigest:prepared.executor.digest,observationPolicyDigest:prepared.observationPolicy.digest,
    code:prepared.approvalFactor==='totp'?hotp(secret,Math.floor(state.now/30000)):''},session);
  const key='task-grant:'+digest(JSON.stringify([old,tenant,session.username,actor,session.chainId,prepared.task.digest]));
  const before=await store.read(key);assert.ok(before);
  const m=createOriginContinuation({schema:'8415wallet-origin-continuation/1',tenant,authorizationOrigin:old,transportOrigin:origin,
    revision:'1',priorStateSha256:'a'.repeat(64),contractDigest:'b'.repeat(64),principals:[{username:session.username,account:actor,chainId:session.chainId}]});
  await store.transaction(originContinuationKey(m),()=>m);
  const router=createOriginRealmRouter({store,tenant,transportOrigin:origin,createRealm});await router.ready;
  const call=async(path,body)=>(await router.forSession(session)).taskService.handler('tasks/'+path,body,session);
  const child={schema:'8415-agent-child/1',operationId:'synthetic:operation',taskDigest:prepared.task.digest,operation:policy.intent.operation,
    nonce:'7',expiresAt:'1800000600',wire:{to:recipient,calldataHash:'0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',valueWei:'10'},
    fees:{gasLimit:'21000',maxFeePerGasWei:'2'},market:null};
  return {store,calls,call,child,key,before,state,approved,router,
    async reserve() {return call('reserve',{taskDigest:prepared.task.digest,child,expectedBudgetRevision:approved.budget.revision});},
    operationBody:g=>({taskDigest:prepared.task.digest,operationId:child.operationId,childDigest:freezeChildOperation(child).digest,expectedBudgetRevision:g.budget.revision})};
}
test('original approved grant executes through the continued realm without reapproval or rewritten signed authority', async () => {
  const f=await fixture();assert.deepEqual(await f.store.read(f.key),f.before);
  const reserved=await f.reserve(),result=await f.call('execute',f.operationBody(reserved));
  assert.equal(result.budget.reservations[0].status,'submitted');assert.equal(f.calls.send,1);
  const after=await f.store.read(f.key);assert.equal(after.principal,f.before.principal);
  assert.deepEqual(after.task,f.before.task);assert.equal(after.grantPolicyVersion,f.before.grantPolicyVersion);
});
test('UNKNOWN continuation reconciles the original attempt and never repeats its send', async () => {
  const f=await fixture({failSend:true}),reserved=await f.reserve();await f.call('execute',f.operationBody(reserved));
  assert.equal(f.calls.send,1);await f.call('resume',{taskDigest:f.child.taskDigest});
  assert.equal(f.calls.send,1);assert.equal(f.calls.recover,1);
});
test('revoked, expired and over-budget old authority still refuses after continuation', async () => {
  const revoked=await fixture();await revoked.call('revoke',{taskDigest:revoked.child.taskDigest,expectedGrantPolicyVersion:revoked.approved.authorization.grantPolicyVersion});
  await assert.rejects(revoked.reserve());assert.equal(revoked.calls.send,0);
  const expired=await fixture();expired.state.now=1800007300000;await assert.rejects(expired.reserve());assert.equal(expired.calls.send,0);
  const budget=await fixture();budget.child.fees.maxFeePerGasWei='999999';await assert.rejects(budget.reserve());assert.equal(budget.calls.send,0);
});
