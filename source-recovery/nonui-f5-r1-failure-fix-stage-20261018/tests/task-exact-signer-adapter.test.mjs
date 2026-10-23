import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet, Transaction } from 'ethers';
import { createTaskExactSignerAdapter } from '../server/task-exact-signer-adapter.mjs';
import { createTaskExactSignOnly } from '../server/task-exact-sign-only.mjs';
import { encodeExactTaskOperation } from '../server/task-operation-encoding.mjs';
import { createTaskAuthorizationService, freezeTaskExecutorIdentity } from '../server/task-authorization.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { base32, hotp, matchTotp } from '../server/crypto.mjs';
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
  const execution = createTaskExactSignerAdapter({ provider, externalSigner, signerIdentity, store,
    maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: options.agentVersion ?? '1', now: () => state.now });
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
      executorDigest: executor.digest, observationPolicyDigest: observationPolicy.digest, code: hotp(secret, Math.floor(state.now / 30000)) });
    return call('reserve', { taskDigest: task.digest, child: child.child, expectedBudgetRevision: authorized.budget.revision });
  }
  // Use exactly the existing service key, without reaching into an input cache.
  const { createHash } = await import('node:crypto');
  state.operationKey = `task-operation:${createHash('sha256').update(JSON.stringify(['11155111', actor, child.child.operationId])).digest('hex')}`;
  return { wallet, actor, store, state, provider, externalSigner, execution, executor, service, call, input, task, child, body, start,
    status: () => call('status', { taskDigest: task.digest }) };
}

test('exact sign-only injection persists hash before sole raw broadcast; preserves credentials and schema', async () => {
  const f = await fixture(), reserved = await f.start(), result = await f.call('execute', f.body(reserved));
  assert.equal(result.outcome, 'submitted'); assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  assert.equal(result.budget.reservations[0].transactionHash, f.state.visible.hash);
  const op = await f.store.read(f.state.operationKey);
  assert.equal(op.exactSignature.state, 'signed'); assert.equal(op.status, 'submitted');
  assert.ok(!JSON.stringify(op).includes('serialized')); assert.ok(!JSON.stringify(op).includes(f.state.requests[0].unsignedSerialized));
  assert.equal((await f.store.read('synthetic-tenant:tester')).sentinel, 'existing-credential');
  assert.ok(!f.state.methods.some(method => ['eth_accounts', 'eth_sendTransaction', 'eth_signTransaction', 'personal_sign'].includes(method)));
});
const mutations = {
  chain: tx => { tx.chainId = 1n; }, to: tx => { tx.to = other; }, data: tx => { tx.data = '0x1234'; }, value: tx => { tx.value = 11n; },
  nonce: tx => { tx.nonce = 8; }, gas: tx => { tx.gasLimit = 22000n; }, maxFee: tx => { tx.maxFeePerGas = 4n; },
  priorityFee: tx => { tx.maxPriorityFeePerGas = 2n; },
  type: tx => { tx.type = 1; tx.maxFeePerGas = null; tx.maxPriorityFeePerGas = null; tx.gasPrice = 3n; },
  accessList: tx => { tx.accessList = [{ address: recipient, storageKeys: [] }]; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`signed ${name} mutation fails closed before raw broadcast`, async () => {
  const f = await fixture({ mutate }), g = await f.start(), result = await f.call('execute', f.body(g));
  assert.equal(result.outcome, 'outcome-unknown'); assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 0);
  assert.equal((await f.store.read(f.state.operationKey)).exactSignature.transactionHash, null);
});
for (const [name, options] of [['wrong actor', { wrongActor: true }], ['invalid bytes', { invalid: '0x1234' }],
  ['unsigned instead of signed', { onSign({ request }) { this.invalid = request.unsignedSerialized; }, invalid: '0x' }]]) {
  test(`${name} is never broadcast`, async () => { const f = await fixture(options), g = await f.start();
    assert.equal((await f.call('execute', f.body(g))).outcome, 'outcome-unknown'); assert.equal(f.state.broadcasts, 0); });
}
test('live chain, pending nonce and actor code must match before claiming/signing', async () => {
  for (const [field, value] of [['chainId', '0x1'], ['nonce', '0x8'], ['actorCode', '0x6001']]) {
    const f = await fixture(), g = await f.start(); f.state[field] = value;
    await assert.rejects(f.call('execute', f.body(g)), /TASK_EXACT_/); assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
    assert.equal((await f.status()).budget.reservations[0].status, 'reserved');
  }
});
test('simultaneous execute and direct send replay make one signer and broadcast call', async () => {
  const f = await fixture(), g = await f.start();
  const results = await Promise.allSettled([f.call('execute', f.body(g)), f.call('execute', f.body(g))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  await assert.rejects(f.execution.send(f.input), /TASK_EXACT_GRANT_NOT_ACTIVE|TASK_EXACT_SIGN_ALREADY_CLAIMED/);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
});
test('a lost broadcast response recovers from full queried signed transaction without signing or broadcasting', async () => {
  const f = await fixture({ lostResponse: true }), g = await f.start();
  const unknown = await f.call('execute', f.body(g)); assert.equal(unknown.outcome, 'outcome-unknown');
  const before = [f.state.signCalls, f.state.broadcasts];
  const recovered = await f.call('recover', f.body(unknown)); assert.equal(recovered.outcome, 'submitted');
  assert.deepEqual([f.state.signCalls, f.state.broadcasts], before);
});
test('executor version upgrade reconciles original UNKNOWN without signing or replaying', async () => {
  const f = await fixture({ lostResponse: true }), reserved = await f.start();
  const unknown = await f.call('execute', f.body(reserved));
  const before = await f.store.read(f.state.operationKey);
  const upgraded = await fixture({ wallet: f.wallet, store: f.store, restart: true, agentVersion: '2' });
  upgraded.state.visible = structuredClone(f.state.visible);
  assert.notEqual(upgraded.executor.digest, f.executor.digest);
  const result = await upgraded.call('recover', upgraded.body(unknown));
  assert.equal(result.outcome, 'submitted');
  assert.equal(result.budget.reservations[0].transactionHash, f.state.visible.hash);
  const after = await f.store.read(f.state.operationKey);
  assert.deepEqual(after.attemptExecutor, before.attemptExecutor);
  assert.deepEqual(after.exactSignature, before.exactSignature);
  assert.equal(upgraded.state.signCalls, 0); assert.equal(upgraded.state.broadcasts, 0);
  assert.ok(!upgraded.state.methods.includes('eth_sendRawTransaction'));
  await assert.rejects(upgraded.execution.send(f.input), /TASK_EXACT_BINDING_REFUSED/);
});

test('upgraded recovery rejects forged historical identity and leaves UNKNOWN quota reserved', async () => {
  const f = await fixture({ lostResponse: true }), reserved = await f.start();
  const unknown = await f.call('execute', f.body(reserved));
  const upgraded = await fixture({ wallet: f.wallet, store: f.store, restart: true, agentVersion: '2' });
  upgraded.state.visible = structuredClone(f.state.visible);
  const forged = structuredClone(f.input); forged.executor.identity.agentVersion = 'forged';
  await assert.rejects(upgraded.execution.recover(forged), /TASK_EXACT_BINDING_REFUSED/);
  assert.equal((await f.store.read(f.state.operationKey)).status, 'outcome-unknown');
  assert.equal((await f.status()).budget.revision, unknown.budget.revision);
  assert.equal(upgraded.state.signCalls, 0); assert.equal(upgraded.state.broadcasts, 0);
});

test('persisted signed hash with no observed transaction stays unknown; read-only retries never resend', async () => {
  const f = await fixture({ onSign({ state }) { state.nonce = '0x8'; } }), g = await f.start();
  const unknown = await f.call('execute', f.body(g)); assert.equal(unknown.outcome, 'outcome-unknown');
  assert.equal((await f.store.read(f.state.operationKey)).exactSignature.state, 'signed'); assert.equal(f.state.broadcasts, 0);
  for (let i = 0; i < 3; i++) await assert.rejects(f.call('recover', f.body(unknown)), /TASK_EXACT_RECOVERY_NOT_ESTABLISHED/);
  await assert.rejects(f.execution.send(f.input), /TASK_EXACT_NONCE_MISMATCH/);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 0);
});
test('recovery rejects hash-only, wrong field, wrong signature and wrong chain observations', async () => {
  const f = await fixture({ lostResponse: true }), g = await f.start(), unknown = await f.call('execute', f.body(g));
  const original = structuredClone(f.state.visible);
  for (const changed of [{ hash: original.hash }, { ...original, value: '0xb' }, { ...original, nonce: '0x8' },
    { ...original, from: other }, { ...original, chainId: '0x1' }, { ...original, r: `0x${'0'.repeat(64)}` },
    { ...original, maxPriorityFeePerGas: '0x2' }, { ...original, accessList: [{ address: other, storageKeys: [] }] }]) {
    f.state.visible = changed; await assert.rejects(f.call('recover', f.body(unknown)), /TASK_EXACT_/);
  }
  f.state.visible = original; f.state.chainId = '0x1'; await assert.rejects(f.call('recover', f.body(unknown)), /TASK_EXACT_CHAIN_MISMATCH/);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
});
for (const failState of ['claimed', 'signed']) test(`${failState} durable write failure leaves zero broadcasts and no signer retry`, async () => {
  class FailingStore extends MemoryCredentialStore {
    durable = null;
    async persist(value) {
      if (Object.values(value).some(v => v?.exactSignature?.state === failState)) throw Error('Synthetic disk failure');
      this.durable = structuredClone(value);
    }
  }
  const store = new FailingStore(), f = await fixture({ store }), g = await f.start();
  assert.equal((await f.call('execute', f.body(g))).outcome, 'outcome-unknown');
  assert.equal(f.state.broadcasts, 0); assert.equal(f.state.signCalls, failState === 'claimed' ? 0 : 1);
  await assert.rejects(f.execution.send(f.input), /AUTH_STORE_UNHEALTHY/);
  assert.equal(store.durable[f.state.operationKey].status, 'outcome-unknown');
  assert.equal(store.durable['synthetic-tenant:tester'].sentinel, 'existing-credential');
});
test('revocation while external signer is pending prevents hash persistence and broadcast', async () => {
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ async onSign() { entered(); await new Promise(resolve => { release = resolve; }); } });
  const g = await f.start(), sending = f.call('execute', f.body(g)); await started;
  const revoked = await f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
  release(); assert.equal((await sending).outcome, 'outcome-unknown'); assert.equal(revoked.effectiveStatus, 'revoked');
  assert.equal((await f.status()).effectiveStatus, 'revoked'); assert.equal(f.state.broadcasts, 0);
  assert.equal((await f.store.read(f.state.operationKey)).exactSignature.transactionHash, null);
});
test('factor change while signing blocks broadcast and preserves unrelated concurrent operation fields', async () => {
  const f = await fixture({ async onSign({ store, state }) {
    await store.transaction('synthetic-tenant:tester', c => ({ ...c, revision: 2 }));
    await store.transaction(state.operationKey, op => ({ ...op, syntheticConcurrentMetadata: 'preserve-me' }));
  } });
  const g = await f.start(); assert.equal((await f.call('execute', f.body(g))).outcome, 'outcome-unknown');
  assert.equal(f.state.broadcasts, 0); assert.equal((await f.store.read(f.state.operationKey)).syntheticConcurrentMetadata, 'preserve-me');
});
test('hash journal preserves concurrent metadata; revoked submitted attempt still has read-only recovery', async () => {
  const f = await fixture({ lostResponse: true, async onSign({ store, state }) {
    await store.transaction(state.operationKey, op => ({ ...op, syntheticConcurrentMetadata: 'preserve-me' }));
  } }), g = await f.start(), unknown = await f.call('execute', f.body(g));
  await f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
  assert.equal((await f.store.read(f.state.operationKey)).syntheticConcurrentMetadata, 'preserve-me');
  assert.equal((await f.call('recover', f.body(unknown))).outcome, 'submitted');
  assert.equal((await f.status()).effectiveStatus, 'revoked'); assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
});
test('revocation after durable hash and before broadcast is preserved and refuses send', async () => {
  let f, revoked = false;
  f = await fixture({ async rpc({ method, state }) {
    if (method === 'eth_getCode' && state.signCalls === 1 && !revoked) {
      revoked = true;
      assert.equal((await f.store.read(state.operationKey)).exactSignature.state, 'signed');
      await f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
    }
  } });
  const g = await f.start(), unknown = await f.call('execute', f.body(g));
  assert.equal(unknown.outcome, 'outcome-unknown'); assert.equal(f.state.broadcasts, 0);
  assert.equal((await f.status()).effectiveStatus, 'revoked');
  await assert.rejects(f.call('recover', f.body(unknown)), /TASK_EXACT_RECOVERY_NOT_ESTABLISHED/);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 0);
});
test('expired child while signing and arbitrary calldata before verification cannot broadcast', async () => {
  const expired = await fixture({ onSign({ state }) { state.now += 601000; } }), g = await expired.start();
  assert.equal((await expired.call('execute', expired.body(g))).outcome, 'outcome-unknown'); assert.equal(expired.state.broadcasts, 0);
  const f = await fixture(), malicious = freezeChildOperation({ ...f.child.child,
    wire: { ...f.child.child.wire, calldataHash: hashControlBytes('0x1234') } });
  await assert.rejects(f.execution.verify({ ...f.input, child: malicious }), /TASK_RECEIPT_ENCODING_MISMATCH/);
  assert.equal(f.state.signCalls, 0);
});
test('direct adapter send before service attempt CAS is refused; wrong broadcast hash stays unknown', async () => {
  const f = await fixture(), g = await f.start();
  await assert.rejects(f.execution.send(f.input), /TASK_EXACT_ATTEMPT_REQUIRED/);
  assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
  const wrong = await fixture({ returnedHash: `0x${'9'.repeat(64)}` }), reserved = await wrong.start();
  const unknown = await wrong.call('execute', wrong.body(reserved)); assert.equal(unknown.outcome, 'outcome-unknown');
  assert.equal((await wrong.call('recover', wrong.body(unknown))).outcome, 'submitted');
  assert.equal(wrong.state.signCalls, 1); assert.equal(wrong.state.broadcasts, 1);
});
test('encrypted restart retains original store key/credential and recovers without persisting raw signatures', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'exact-signer-')), path = join(directory, 'state.enc'), encryptionKey = Buffer.alloc(32, 0x26);
  let store = await openEncryptedStore(path, encryptionKey);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const f = await fixture({ store, lostResponse: true }), g = await f.start(), unknown = await f.call('execute', f.body(g));
  const bytes = await readFile(path, 'utf8'); assert.ok(!bytes.includes(secret)); assert.ok(!bytes.includes(f.state.visible.hash));
  const saved = structuredClone(f.state.visible); await store.close(); store = await openEncryptedStore(path, encryptionKey);
  const restart = await fixture({ store, wallet: f.wallet, restart: true }); restart.state.visible = saved;
  assert.equal((await restart.call('recover', restart.body(unknown))).outcome, 'submitted');
  assert.equal(restart.state.signCalls, 0); assert.equal(restart.state.broadcasts, 0);
  assert.equal((await store.read('synthetic-tenant:tester')).sentinel, 'existing-credential');
});
test('configuration methods are captured; fee/signer changes bind another executor identity', async () => {
  const f = await fixture(), g = await f.start();
  f.provider.request = () => { throw Error('Replaced provider must not run'); };
  f.externalSigner.signExactTransaction = () => { throw Error('Replaced signer must not run'); };
  assert.equal((await f.call('execute', f.body(g))).outcome, 'submitted');
  const config = { provider: { async request() {} }, externalSigner: { async signExactTransaction() {} }, signerIdentity,
    store: f.store, agentId: 'synthetic:agent', agentVersion: '1' };
  const one = createTaskExactSignerAdapter({ ...config, maxPriorityFeePerGasWei: '1' });
  const two = createTaskExactSignerAdapter({ ...config, maxPriorityFeePerGasWei: '2' });
  assert.notEqual(one.identity.implementationDigest, two.identity.implementationDigest);
  assert.throws(() => createTaskExactSignerAdapter({ ...config, externalSigner: null, maxPriorityFeePerGasWei: '1' }), /TASK_EXACT_CONFIG_REQUIRED/);
});

test('serialized read boundary sees queued revocation, cannot mutate data and never writes', async () => {
  class Store extends MemoryCredentialStore { writes = 0; async persist() { this.writes++; } }
  const store = new Store({ grant: { status: 'authorized' } });
  const revoke = store.transaction('grant', g => ({ ...g, status: 'revoked' }));
  const result = store.withReadSnapshot(['grant'], values => { assert.equal(values.grant.status, 'revoked'); values.grant.status = 'changed'; return 'observed'; });
  await revoke; assert.equal(await result, 'observed'); assert.equal(store.writes, 1);
  assert.equal((await store.read('grant')).status, 'revoked');
  let callbackRan = false;
  await assert.rejects(store.withReadSnapshot(['grant'], async () => { callbackRan = true; }), /AUTH_STORE_ASYNC_SNAPSHOT_REFUSED/);
  // Contract enforcement reports misuse, not rollback of a callback's effects.
  assert.equal(callbackRan, true); assert.equal(store.writes, 1);
});
test('unhealthy store refuses serialized boundary without invoking any external effect', async () => {
  class Store extends MemoryCredentialStore { async persist() { throw Error('Synthetic failed persistence'); } }
  const store = new Store(); await assert.rejects(store.transaction('grant', () => ({ status: 'authorized' })), /Synthetic failed persistence/);
  let invoked = false;
  await assert.rejects(store.withReadSnapshot(['grant'], () => { invoked = true; }), /AUTH_STORE_UNHEALTHY/);
  assert.equal(invoked, false);
});
test('revocation queued ahead of final serialized boundary refuses a stale send continuation', async () => {
  class Store extends MemoryCredentialStore {
    before = null; operationKey = null; injected = null;
    async withReadSnapshot(keys, inspect) {
      // Inspect the durable milestone outside the held callback. Adding an
      // earlier service fence must not move this test's revocation to signing.
      const op = this.before && this.operationKey && keys.includes(this.operationKey) ? await this.read(this.operationKey) : null;
      if (this.before && op?.exactSignature?.state === 'signed') {
        assert.match(op.exactSignature.transactionHash, /^0x[0-9a-f]{64}$/);
        this.injected = structuredClone(op.exactSignature);
        const fn = this.before; this.before = null; await fn();
      }
      return super.withReadSnapshot(keys, inspect);
    }
  }
  const store = new Store(), f = await fixture({ store }), g = await f.start();
  store.operationKey = f.state.operationKey;
  store.before = () => f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
  assert.equal((await f.call('execute', f.body(g))).outcome, 'outcome-unknown');
  assert.equal((await f.status()).effectiveStatus, 'revoked'); assert.equal(f.state.broadcasts, 0); assert.equal(f.state.signCalls, 1);
  assert.equal(store.injected.state, 'signed');
  const operation = await store.read(f.state.operationKey);
  assert.equal(operation.status, 'outcome-unknown');
  assert.equal(operation.exactSignature.transactionHash, store.injected.transactionHash);
  assert.equal((await f.status()).budget.reservations[0].status, 'outcome-unknown');
});
test('revocation queued after durable claim but before signer invocation produces zero signatures', async () => {
  class Store extends MemoryCredentialStore {
    before = null; operationKey = null; injected = null;
    async withReadSnapshot(keys, inspect) {
      const op = this.before && this.operationKey && keys.includes(this.operationKey) ? await this.read(this.operationKey) : null;
      if (this.before && op?.exactSignature?.state === 'claimed') {
        assert.equal(op.exactSignature.transactionHash, null);
        this.injected = structuredClone(op.exactSignature);
        const fn = this.before; this.before = null; await fn();
      }
      return super.withReadSnapshot(keys, inspect);
    }
  }
  const store = new Store(), f = await fixture({ store }), g = await f.start();
  store.operationKey = f.state.operationKey;
  store.before = () => f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
  assert.equal((await f.call('execute', f.body(g))).outcome, 'outcome-unknown');
  assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
  assert.equal((await f.store.read(f.state.operationKey)).exactSignature.state, 'claimed');
  assert.equal(store.injected.state, 'claimed');
  assert.equal((await f.store.read(f.state.operationKey)).exactSignature.transactionHash, null);
  assert.equal((await f.status()).effectiveStatus, 'revoked');
  assert.equal((await f.status()).budget.reservations[0].status, 'outcome-unknown');
});
test('revocation ordered after RPC invocation does not await network or undo already initiated send', async () => {
  let entered, release; const invoked = new Promise(resolve => { entered = resolve; });
  const f = await fixture({ async onBroadcast() { entered(); await new Promise(resolve => { release = resolve; }); } });
  const g = await f.start(), pending = f.call('execute', f.body(g)); await invoked;
  const revoked = await f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
  assert.equal(revoked.effectiveStatus, 'revoked'); release();
  const submitted = await pending; assert.equal(submitted.outcome, 'submitted'); assert.equal(submitted.effectiveStatus, 'revoked');
  assert.equal(f.state.broadcasts, 1); assert.equal(f.state.signCalls, 1);
});

for (const kind of ['erc20-transfer', 'erc721-transfer', 'erc1155-transfer', 'create-account', 'deposit', 'standalone-withdraw', 'complete', 'return-hop']) {
  test(`${kind}: shared exact encoding reaches a single synthetic sign and raw submission`, async () => {
    const controller = `0x${'a'.repeat(40)}`, token = other, account = `0x${'b'.repeat(40)}`, code = '0x6000', runtimeCodeHash = hashControlBytes(code);
    const sequenceId = `0x${'6'.repeat(64)}`, legId = `0x${'7'.repeat(64)}`;
    const controllerPin = { contract: controller, runtimeCodeHash }, tokenPin = { contract: token, runtimeCodeHash };
    const operations = actor => ({
      'erc20-transfer': { contract: token, recipient, amount: '7' }, 'erc721-transfer': { contract: token, recipient, tokenId: '7' },
      'erc1155-transfer': { contract: token, recipient, tokenId: '7', amount: '3' }, 'create-account': { controller: controllerPin },
      deposit: { controller: controllerPin, token: tokenPin, tokenId: '7' },
      'standalone-withdraw': { controller: controllerPin, token: tokenPin, tokenId: '7', destination: recipient },
      complete: { controller: controllerPin, token: tokenPin, sequenceId, legId, expectedRevision: '3' },
      'return-hop': { controller: controllerPin, token: tokenPin, sequenceId, legId, expectedRevision: '3' },
    })[kind];
    const wire = actor => {
      let to, data;
      if (kind === 'erc20-transfer') { to = token; data = encodeCall('transfer(address,uint256)', ['address','uint256'], [recipient,7n]); }
      else if (kind === 'erc721-transfer' || kind === 'deposit') { to = token; data = encodeCall('safeTransferFrom(address,address,uint256)', ['address','address','uint256'], [actor, kind === 'deposit' ? account : recipient,7n]); }
      else if (kind === 'erc1155-transfer') { to = token; data = encodeCallWithTail('safeTransferFrom(address,address,uint256,uint256,bytes)', ['address','address','uint256','uint256','bytes'], [actor,recipient,7n,3n,'0x']); }
      else if (kind === 'standalone-withdraw') { to = account; data = encodeCall('withdrawStandalone(address,uint256,address)', ['address','uint256','address'], [token,7n,recipient]); }
      else { to = controller; data = kind === 'create-account' ? encodeCall('createAccount()',[],[]) : encodeCall(kind === 'complete' ? 'completeThrough(bytes32,bytes32,uint256)' : 'returnHop(bytes32,bytes32,uint256)', ['bytes32','bytes32','uint256'], [sequenceId,legId,3n]); }
      return { to, calldataHash: hashControlBytes(data), valueWei: '0' };
    };
    const f = await fixture({ operation: actor => ({ kind, actor, chainId: '11155111', ...operations(actor) }), wire,
      async rpc({ method, params, state }) {
        if (method === 'eth_getCode') return [state.actor, recipient].includes(params[0].toLowerCase()) ? '0x' : code;
        if (method === 'eth_call' && !params[0].from) {
          const data = params[0].data;
          if (data === encodeCall('accountOf(address)', ['address'], [state.actor])) return encodeWords(['address'], [account]);
          if (data === encodeCall('registeredAccount(address)', ['address'], [account])) return encodeWords(['bool'], [true]);
          if (data === encodeCall('owner()', [], [])) return encodeWords(['address'], [state.actor]);
          if (data === encodeCall('controller()', [], [])) return encodeWords(['address'], [controller]);
          if (data === encodeCall('sequence(bytes32)', ['bytes32'], [sequenceId])) return encodeWords(
            ['address','uint256','address','address','address','bytes32','bytes32','bytes32','uint256','uint256','uint256','uint256','uint256','bytes32','bool'],
            [token,7n,state.actor,account,recipient,sequenceId,legId,runtimeCodeHash,3n,1n,1n,0n,1n,sequenceId,false]);
        }
      } });
    const g = await f.start(); assert.equal((await f.call('execute', f.body(g))).outcome, 'submitted');
    assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
    assert.equal(hashControlBytes(f.state.visible.input), f.child.child.wire.calldataHash);
  });
}

test('all nine operation encodings remain closed and exact, including dynamic controlled account target', () => {
  const actor = `0x${'1'.repeat(40)}`, contract = `0x${'a'.repeat(40)}`, account = `0x${'b'.repeat(40)}`;
  const controller = { contract, runtimeCodeHash: `0x${'6'.repeat(64)}` }, token = { contract: other, runtimeCodeHash: `0x${'7'.repeat(64)}` };
  const sequenceId = `0x${'8'.repeat(64)}`, legId = `0x${'9'.repeat(64)}`, chainId = '11155111';
  const vectors = [
    [{ kind: 'native-transfer', recipient, valueWei: '10' }, recipient, '0x', '10'],
    [{ kind: 'erc20-transfer', contract, recipient, amount: '4' }, contract, encodeCall('transfer(address,uint256)', ['address','uint256'], [recipient,4n]), '0'],
    [{ kind: 'erc721-transfer', contract, recipient, tokenId: '2' }, contract, encodeCall('safeTransferFrom(address,address,uint256)', ['address','address','uint256'], [actor,recipient,2n]), '0'],
    [{ kind: 'erc1155-transfer', contract, recipient, tokenId: '2', amount: '4' }, contract, encodeCallWithTail('safeTransferFrom(address,address,uint256,uint256,bytes)', ['address','address','uint256','uint256','bytes'], [actor,recipient,2n,4n,'0x']), '0'],
    [{ kind: 'create-account', controller }, contract, encodeCall('createAccount()', [], []), '0'],
    [{ kind: 'deposit', controller, token, tokenId: '2' }, other, encodeCall('safeTransferFrom(address,address,uint256)', ['address','address','uint256'], [actor,account,2n]), '0'],
    [{ kind: 'standalone-withdraw', controller, token, tokenId: '2', destination: recipient }, account, encodeCall('withdrawStandalone(address,uint256,address)', ['address','uint256','address'], [other,2n,recipient]), '0'],
    [{ kind: 'complete', controller, token, sequenceId, legId, expectedRevision: '3' }, contract, encodeCall('completeThrough(bytes32,bytes32,uint256)', ['bytes32','bytes32','uint256'], [sequenceId,legId,3n]), '0'],
    [{ kind: 'return-hop', controller, token, sequenceId, legId, expectedRevision: '3' }, contract, encodeCall('returnHop(bytes32,bytes32,uint256)', ['bytes32','bytes32','uint256'], [sequenceId,legId,3n]), '0'],
  ];
  for (const [operation, to, data, value] of vectors) {
    const child = freezeChildOperation({ schema: '8415-agent-child/1', operationId: 'synthetic:encode', taskDigest: `0x${'f'.repeat(64)}`,
      operation: { ...operation, actor, chainId }, nonce: '7', expiresAt: '1800000600',
      wire: { to, calldataHash: hashControlBytes(data), valueWei: value }, fees: { gasLimit: '21000', maxFeePerGasWei: '3' }, market: null });
    assert.deepEqual(encodeExactTaskOperation(child, account), { to, data, value });
    const tampered = freezeChildOperation({ ...child.child, wire: { ...child.child.wire, calldataHash: hashControlBytes('0x1234') } });
    assert.throws(() => encodeExactTaskOperation(tampered, account), /TASK_RECEIPT_ENCODING_MISMATCH/);
    if (['deposit','standalone-withdraw'].includes(operation.kind)) assert.throws(() => encodeExactTaskOperation(child), /TASK_OPERATION_ACCOUNT_REQUIRED/);
  }
});

test('insufficient pending maximum-cost balance refuses before signer and preserves reservation',async()=>{
  const f=await fixture(), reserved=await f.start();f.state.balance='0x0';
  await assert.rejects(f.call('execute',f.body(reserved)),/TASK_EXACT_BALANCE_INSUFFICIENT/);
  assert.equal(f.state.signCalls,0);assert.equal(f.state.broadcasts,0);
  assert.equal((await f.status()).budget.reservations[0].status,'reserved');
});
test('balance lost while signer is active preserves signed UNKNOWN and never broadcasts or resends',async()=>{
  const f=await fixture({onSign({state}){state.balance='0x0';}}),reserved=await f.start();
  const result=await f.call('execute',f.body(reserved));assert.equal(result.outcome,'outcome-unknown');
  assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,0);
  // Nothing was broadcast, so eth_getTransactionByHash has nothing to return
  // and recovery cannot be established. Refusing is the required outcome: it
  // keeps the signed attempt UNKNOWN instead of concluding "not mined", which
  // is the only reading that would license a resend.
  await assert.rejects(f.call('recover',f.body(result)),/TASK_EXACT_RECOVERY_NOT_ESTABLISHED/);
  assert.equal(f.state.signCalls,1);assert.equal(f.state.broadcasts,0);
  assert.equal((await f.status()).budget.reservations[0].status,'outcome-unknown');
});

test('real shipped bridge refuses signing RPC when grant revoked during awaited wallet checks', async () => {
  let f, revoked = false;
  f = await fixture({ bridge: true, async walletRPC({ method }) {
    if (method === 'eth_accounts' && !revoked) {
      revoked = true; await f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
    }
  } });
  const g = await f.start(), outcome = await f.call('execute', f.body(g));
  assert.equal(outcome.outcome, 'outcome-unknown');
  assert.equal(f.state.signCalls, 0, 'actual eth_signTransaction must not be invoked');
  assert.equal(f.state.broadcasts, 0);
  const op = await f.store.read(f.state.operationKey);
  assert.equal(op.exactSignature.state, 'claimed');
  assert.equal(op.exactSignature.transactionHash, null);
});
test('real shipped bridge refuses signing after credential revision changes during selection', async () => {
  let checks = 0;
  const f = await fixture({ bridge: true, async walletRPC({ method, store }) {
    if (method === 'eth_chainId' && ++checks === 2)
      await store.transaction('synthetic-tenant:tester', credential => ({ ...credential, revision: 2 }));
  } });
  const g = await f.start(), outcome = await f.call('execute', f.body(g));
  assert.equal(outcome.outcome, 'outcome-unknown');
  assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
});
test('revocation after signing RPC invocation does not deadlock or allow broadcast', async () => {
  let f, revoked = false;
  f = await fixture({ bridge: true, async walletRPC({ method }) {
    if (method === 'eth_signTransaction' && !revoked) {
      revoked = true; await f.call('revoke', { taskDigest: f.task.digest, expectedGrantPolicyVersion: '1' });
    }
  } });
  const g = await f.start(), outcome = await f.call('execute', f.body(g));
  assert.equal(outcome.outcome, 'outcome-unknown');
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 0);
  assert.equal((await f.status()).effectiveStatus, 'revoked');
});
test('signer without fence contract is refused; late captured fence cannot invoke a side effect', async () => {
  let saved;
  const f = await fixture({ ignoreFence: true, captureFence(fence) { saved = fence; } }), g = await f.start();
  assert.equal((await f.call('execute', f.body(g))).outcome, 'outcome-unknown');
  assert.equal(f.state.broadcasts, 0);
  let effects = 0;
  await assert.rejects(saved(() => { effects++; }), /SIGNING_FENCE_REFUSED/);
  assert.equal(effects, 0);
});
test('signing fence is one use per durable claim', async () => {
  const f = await fixture({ repeatFence: true }), g = await f.start();
  assert.equal((await f.call('execute', f.body(g))).outcome, 'outcome-unknown');
  assert.equal(f.state.broadcasts, 0);
  assert.equal((await f.store.read(f.state.operationKey)).exactSignature.transactionHash, null);
});
test('shipped bridge signs once and sole journal-bound raw send remains separate', async () => {
  const f = await fixture({ bridge: true }), g = await f.start();
  const result = await f.call('execute', f.body(g));
  assert.equal(result.outcome, 'submitted'); assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  assert.equal((await f.store.read(f.state.operationKey)).exactSignature.state, 'signed');
});

