/** Reused synthetic fixture only; V2-specific checks below. No network or real accounts. */
import test from 'node:test';


async function saveSignerOperationPolicy(f, mode) {
  const scope = { origin: 'https://wallet.example.invalid', tenant: 'synthetic-tenant', username: 'tester',
    account: f.actor, chainId: '11155111', agentId: 'synthetic:agent' };
  await f.store.transaction('synthetic-tenant:tester', credential => {
    const k = taskVerificationPolicyKey(scope), prior = credential.taskVerificationPolicies?.[k];
    const revision = String(BigInt(prior?.revision ?? '0') + 1n);
    return { ...credential, taskVerificationPolicies: { ...(credential.taskVerificationPolicies ?? {}), [k]: {
      schema: '8415-task-human-verification/2', scope, mode, revision, enforcedFromRevision: '1',
      changes: [...(prior?.changes ?? []), { revision, previousRevision: prior?.revision ?? '0', mode,
        changeId: 'A'.repeat(43), changeDigest: 'a'.repeat(64), scopeDigest: digest(JSON.stringify(scope)),
        credentialRevision: 1, verifiedFactors: ['password', 'verified-email'], changedAt: f.state.now }] } } };
  });
}

async function approveSignerOperation(f, reserved) {
  f.state.now += 30000;
  const proof = await f.call('prepare-operation-verification', f.body(reserved));
  await f.call('confirm-operation-verification', { challengeId: proof.request.challengeId,
    requestDigest: proof.requestDigest, code: hotp(secret, Math.floor(f.state.now / 30000)) });
}


// Synthetic owner-policy races at the actual sign/broadcast boundary. These
// fixtures never change a real wallet setting or authorize an on-chain asset.
async function saveSyntheticAssetAgentOFF(f) {
  const {readCredentialAssetControlPolicy,appendVerifiedAssetControlChange,assetControlPolicyKey} =
    await import('../server/task-asset-control-state.mjs');
  const selected={origin:f.task.policy.origin,tenant:f.task.policy.tenant,username:'tester',account:f.actor,
    chainId:f.task.policy.chainId,agentId:f.executor.identity.agentId};
  await f.store.transaction('synthetic-tenant:tester',credential=>{
    const state=readCredentialAssetControlPolicy(credential,selected);
    const request={schema:'8415-asset-control-change/1',scope:selected,expectedRevision:state.revision,
      patch:{target:{kind:'allow-agent'},value:false,expectedFieldRevision:'0'},credentialRevision:credential.revision,
      changeId:'F'.repeat(43),nonce:'G'.repeat(43),issuedAt:epoch-1000,expiresAt:epoch+1000};
    const next=appendVerifiedAssetControlChange(state,selected,request,['wallet','verified-email'],epoch);
    return {...credential,assetControlPolicies:{...(credential.assetControlPolicies??{}),[assetControlPolicyKey(selected)]:next}};
  });
}

import assert from 'node:assert/strict';

import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { Wallet, Transaction } from 'ethers';

import { createTaskExactSignerAdapter, TASK_EXACT_SIGNER_RUNTIME_FILES } from '../server/v2/task-exact-signer-adapter.mjs';

import { createTaskExactSignOnly } from '../server/task-exact-sign-only.mjs';

import { createTaskExactRuntime } from '../server/v2/task-exact-runtime.mjs';

import { encodeExactTaskOperation } from '../server/v2/task-operation-encoding.mjs';

import { createTaskAuthorizationService, freezeTaskExecutorIdentity } from '../server/task-authorization.mjs';

import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';

import { base32, digest, hotp, matchTotp } from '../server/crypto.mjs';

import { taskVerificationPolicyKey } from '../server/task-verification-state.mjs';

import { freezeTaskPolicy, freezeChildOperation } from '../src/agent/taskContract.ts';

import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';

import { hashControlBytes } from '../src/controls/authorization.ts';

import { encodeCall, encodeCallWithTail, encodeWords } from '../src/codec/abi.ts';


// Every account/factor here is ephemeral or explicitly synthetic. No network,
// real account, existing credential file, secret output or genuine transaction.
const epoch = 1_800_000_000_000, secret = base32(Buffer.alloc(20, 0x35));

const recipient = `0x${'2'.repeat(40)}`, other = `0x${'3'.repeat(40)}`;

const observationPolicy = freezeTaskObservationPolicy({ minimumConfirmations: '2' });

const verifier = { verifierId: 'synthetic:receipt', verifierVersion: '1', verifierImplementationDigest: `0x${'4'.repeat(64)}` };

const signerIdentity = { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: `0x${'5'.repeat(64)}` };

const h = value => `0x${BigInt(value).toString(16)}`;

function observed(tx) {
  return { hash: tx.hash, from: tx.from.toLowerCase(), type: h(tx.type), chainId: h(tx.chainId), nonce: h(tx.nonce),
    to: tx.to, input: tx.data, value: h(tx.value), gas: h(tx.gasLimit), maxFeePerGas: h(tx.maxFeePerGas),
    maxPriorityFeePerGas: h(tx.maxPriorityFeePerGas), accessList: [], r: tx.signature.r, s: tx.signature.s,
    yParity: h(tx.signature.yParity), v: h(tx.signature.yParity), blockHash: null, blockNumber: null };
}

async function fixture(options = {}) {
  const wallet = options.wallet ?? Wallet.createRandom(), actor = wallet.address.toLowerCase();
  const store = options.store ?? new MemoryCredentialStore();
  if (!options.restart) await store.transaction('synthetic-tenant:tester', () => ({ secret, lastStep: -1, revision: 1, sentinel: 'existing-credential' }));
  const state = { actor, now: epoch, nonce: '0x7', chainId: '0xaa36a7', actorCode: '0x', visible: null, signCalls: 0, broadcasts: 0, methods: [], requests: [] };
  const provider = { async request({ method, params }) {
    state.methods.push(method);
    if (options.rpc) { const override = await options.rpc({ method, params, state }); if (override !== undefined) return override; }
    if (method === 'eth_chainId') return state.chainId;
    if (method === 'eth_getBalance') return state.balance ?? '0xffffffffffffffff';
    if (method === 'eth_getCode') return params[0].toLowerCase() === actor ? state.actorCode : '0x';
    if (method === 'eth_getTransactionCount') return state.nonce;
    if (method === 'eth_call') return '0x';
    if (method === 'eth_getTransactionByHash') return state.visible;
    if (method === 'eth_sendRawTransaction') {
      state.broadcasts++; const tx = Transaction.from(params[0]);
      const persisted = await store.readMany([state.operationKey]);
      assert.equal(persisted[state.operationKey].exactSignature.transactionHash, tx.hash, 'hash must persist before any broadcast');
      assert.equal(persisted[state.operationKey].status, 'outcome-unknown');
      state.visible = observed(tx);
      if (options.onBroadcast) await options.onBroadcast({ state, tx });
      if (options.lostResponse) throw Error('Synthetic lost response');
      return options.returnedHash ?? tx.hash;
    }
    throw Error(`Unexpected synthetic RPC: ${method}`);
  } };
  const syntheticSigner = { async signExactTransaction(request, execution) {
    if (options.captureFence) options.captureFence(execution?.withSigningFence);
    // Test-only legacy fallback permits a true before/after comparison with
    // the old adapter. Product code never supplies this fallback.
    const invokeFenced = execution?.withSigningFence ?? (invoke => invoke());
    state.signCalls++; state.requests.push(request);
    assert.deepEqual(Object.keys(request), ['requestId', 'unsignedSerialized', 'unsignedDigest', 'binding']);
    assert.ok(Object.isFrozen(request) && Object.isFrozen(request.binding));
    assert.equal(Transaction.from(request.unsignedSerialized).unsignedHash, request.unsignedDigest);
    if (options.onSign) await options.onSign({ request, state, store });
    if (options.invalid !== undefined) return options.invalid;
    const tx = Transaction.from(request.unsignedSerialized); options.mutate?.(tx);
    const invoke = () => (options.wrongActor ? Wallet.createRandom() : wallet).signTransaction(tx);
    if (options.ignoreFence) return invoke();
    const signed = await invokeFenced(invoke);
    if (options.repeatFence) await invokeFenced(invoke);
    return signed;
  } };
  const walletProvider = { async request({ method, params }) {
    if (method === 'eth_signTransaction') state.signCalls++;
    if (options.walletRPC) await options.walletRPC({ method, params, state, store });
    if (method === 'eth_chainId') return state.chainId;
    if (method === 'eth_accounts') return [wallet.address];
    if (method === 'eth_signTransaction') {
      const p = params[0];
      return wallet.signTransaction({ type: 2, chainId: BigInt(p.chainId), nonce: Number(BigInt(p.nonce)),
        to: p.to, data: p.data, value: BigInt(p.value), gasLimit: BigInt(p.gas),
        maxFeePerGas: BigInt(p.maxFeePerGas), maxPriorityFeePerGas: BigInt(p.maxPriorityFeePerGas), accessList: [] });
    }
    assert.fail('Unexpected synthetic wallet RPC ' + method);
  } };
  const externalSigner = options.bridge ? createTaskExactSignOnly({ walletProvider }) : syntheticSigner;
  const exactOptions = { provider, externalSigner, signerIdentity, store,
    maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: options.agentVersion ?? '1', now: () => state.now,
    testAuthorization: options.testAuthorization ?? null };
  const execution = options.composeRuntime ? createTaskExactRuntime({ store, now: () => state.now,
    testAuthorization: options.testAuthorization ?? null, serverConfiguration: { provider, externalSigner, signerIdentity,
      maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: options.agentVersion ?? '1',
      observationPolicy: observationPolicy.policy } }).authOptions.taskExecution : createTaskExactSignerAdapter(exactOptions);
  const executor = freezeTaskExecutorIdentity(execution.identity);
  const session = { username: 'tester', account: actor, chainId: '11155111', id: 'synthetic:session', revision: 1,
    issuedAt: epoch, expiresAt: epoch + 900_000 };
  function assertSession(s, credential) { assert.equal(s, session); assert.ok(state.now < session.expiresAt);
    if (credential !== undefined) assert.equal(credential.revision, session.revision); }
  const receipt = { identity: verifier, observationPolicy,
    async assessChild(input) { return { taskDigest: input.task.digest, childDigest: input.child.digest, executorDigest: input.executor.digest,
      observationPolicyDigest: observationPolicy.digest, ...verifier, capability: 'exact-operation-observable' }; },
    async observe() { throw Error('Synthetic observation not needed'); } };
  const service = createTaskAuthorizationService({ origin: 'https://wallet.example.invalid', tenant: 'synthetic-tenant', store, now: () => state.now,
    operationVerificationEnabled: options.operationVerificationEnabled ?? false,
    testAuthorization: options.testAuthorization ?? null,
    assertSession, async credentialFor(s) { const c = await store.read('synthetic-tenant:tester'); assertSession(s, c); return c; },
    consumeTotp(s, c, code) { assertSession(s, c); const step = matchTotp(c.secret, code, state.now, c.lastStep);
      assert.notEqual(step, null); return { ...c, lastStep: step }; }, execution, executorIdentity: execution.identity,
    observationPolicy: observationPolicy.policy, receipt });
  const call = (path, body) => service.handler(`tasks/${path}`, body, session);
  const policy = { schema: '8415-agent-task/1', taskId: 'synthetic:task', tenant: 'synthetic-tenant', origin: 'https://wallet.example.invalid',
    chainId: '11155111', actor, expiresAt: String(epoch / 1000 + 7200), fees: { perOperationWei: '1000000', totalWei: '1000000' },
    intent: { kind: 'exact-operation', operation: options.operation ? options.operation(actor) : { kind: 'native-transfer', chainId: '11155111', actor, recipient, valueWei: '10' } } };
  const task = freezeTaskPolicy(policy), child = freezeChildOperation({ schema: '8415-agent-child/1', operationId: 'synthetic:operation',
    taskDigest: task.digest, operation: task.policy.intent.operation, nonce: '7', expiresAt: String(epoch / 1000 + 600),
    wire: options.wire ? options.wire(actor) : { to: recipient, calldataHash: hashControlBytes('0x'), valueWei: '10' }, fees: { gasLimit: '21000', maxFeePerGasWei: '3' }, market: null });
  const input = { task, child, executor, grantPolicyVersion: '1' };
  const body = status => ({ taskDigest: task.digest, operationId: child.child.operationId, childDigest: child.digest, expectedBudgetRevision: status.budget.revision });
  async function start() {
    const prepared = await call('prepare', { policy });
    const authorized = await call('authorize', { challengeId: prepared.challengeId, taskDigest: task.digest,
      executorDigest: executor.digest, observationPolicyDigest: observationPolicy.digest, code: '' });
    return call('reserve', { taskDigest: task.digest, child: child.child, expectedBudgetRevision: authorized.budget.revision });
  }
  // Use exactly the existing service key, without reaching into an input cache.
  const { createHash } = await import('node:crypto');
  state.operationKey = `task-operation:${createHash('sha256').update(JSON.stringify(['11155111', actor, child.child.operationId])).digest('hex')}`;
  return { wallet, actor, store, state, provider, externalSigner, execution, executor, service, call, input, task, child, body, start,
    status: () => call('status', { taskDigest: task.digest }) };
}

const mutations = {
  chain: tx => { tx.chainId = 1n; }, to: tx => { tx.to = other; }, data: tx => { tx.data = '0x1234'; }, value: tx => { tx.value = 11n; },
  nonce: tx => { tx.nonce = 8; }, gas: tx => { tx.gasLimit = 22000n; }, maxFee: tx => { tx.maxFeePerGas = 4n; },
  priorityFee: tx => { tx.maxPriorityFeePerGas = 2n; },
  type: tx => { tx.type = 1; tx.maxFeePerGas = null; tx.maxPriorityFeePerGas = null; tx.gasPrice = 3n; },
  accessList: tx => { tx.accessList = [{ address: recipient, storageKeys: [] }]; },
};
test('V2 exact signer preserves durable hash before one synthetic raw broadcast',async()=>{
 const f=await fixture(),reserved=await f.start(),r=await f.call('execute',f.body(reserved));assert.equal(r.outcome,'submitted');assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,1);
 const op=await f.store.read(f.state.operationKey);assert.equal(op.exactSignature.state,'signed');assert.equal(op.status,'submitted');assert.ok(!JSON.stringify(op).includes('serialized'));
 assert.equal((await f.store.read('synthetic-tenant:tester')).sentinel,'existing-credential');
});
test('V2 exact signer lost response retains UNKNOWN claim and never repeats signature/broadcast',async()=>{
 const f=await fixture({lostResponse:true}),reserved=await f.start(),r=await f.call('execute',f.body(reserved));assert.equal(r.outcome,'outcome-unknown');assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,1);
 await assert.rejects(f.call('execute',f.body(r)));assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,1);
});
test('V2 exact signer refuses altered chain before raw broadcast',async()=>{
 const f=await fixture({mutate:tx=>{tx.chainId=1n;}}),reserved=await f.start();const r=await f.call('execute',f.body(reserved));assert.equal(r.outcome,'outcome-unknown');assert.equal(f.state.broadcasts,0);
});
test('V2 signer refuses linked operation at immutable context before RPC or signature',async()=>{
 for(const kind of ['complete','return-hop']){
  const f=await fixture({operation:actor=>({kind,actor,chainId:'11155111',controller:{contract:other,runtimeCodeHash:'0x'+'6'.repeat(64)},token:{contract:recipient,runtimeCodeHash:'0x'+'7'.repeat(64)},sequenceId:'0x'+'8'.repeat(64),legId:'0x'+'9'.repeat(64),expectedRevision:'1'})});
  await assert.rejects(f.execution.verify(f.input),/TASK_V2_OPERATION_NOT_SUPPORTED/);assert.deepEqual(f.state.methods,[]);assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
 }
});
