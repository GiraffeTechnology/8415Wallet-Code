import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Wallet, Transaction } from 'ethers';
import { createAuthService } from '../server/auth-service.mjs';
import { createTaskBackgroundRunner } from '../server/task-background-runner.mjs';
import { createTaskExactSignerAdapter } from '../server/task-exact-signer-adapter.mjs';
import { createTaskReceiptAdapter } from '../server/task-receipt-adapter.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { base32, hashPassword, hotp } from '../server/crypto.mjs';
import { freezeChildOperation } from '../src/agent/taskContract.ts';

// Synthetic integration evidence only: HTTP binds to loopback, the EIP-1193
// provider below is in-process, and the disconnected wallet is generated fresh
// per fixture. Its private key is never read, printed, serialized or persisted.
// No live account, RPC endpoint, genuine transaction, deployment or device proof.
const epoch = 1_800_000_000_000, chainId = '11155111';
const recipient = `0x${'2'.repeat(40)}`;
const secret = base32(Buffer.alloc(20, 0x49));
const observationPolicy = Object.freeze({ minimumConfirmations: '2' });
const signerIdentity = Object.freeze({ signerId: 'synthetic:ephemeral-sign-only', signerVersion: '1', implementationDigest: `0x${'5'.repeat(64)}` });
const feeRule = Object.freeze({ schema: '8415-task-exact-fee-rule/1', ruleId: 'synthetic:bounded-fees', ruleVersion: '1',
  sampleBlock: 'latest', simulationBlock: 'pending', gasPaddingBps: '12000', gasLimitCeiling: '100000',
  baseFeeMultiplierBps: '20000', maxPriorityFeePerGasWei: '1', maxFeePerGasWeiCeiling: '20', maxChildLifetimeSeconds: '600' });
const hex = value => `0x${BigInt(value).toString(16)}`;
const blockHash = number => `0x${BigInt(number).toString(16).padStart(64, '0')}`;
const operationKey = (actor, operationId) => `task-operation:${createHash('sha256').update(JSON.stringify([chainId, actor, operationId])).digest('hex')}`;
const accepted = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };

function queriedTransaction(tx) {
  return { hash: tx.hash, from: tx.from.toLowerCase(), to: tx.to.toLowerCase(), input: tx.data,
    type: hex(tx.type), chainId: hex(tx.chainId), nonce: hex(tx.nonce), value: hex(tx.value), gas: hex(tx.gasLimit),
    maxFeePerGas: hex(tx.maxFeePerGas), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas), accessList: [],
    r: tx.signature.r, s: tx.signature.s, yParity: hex(tx.signature.yParity), v: hex(tx.signature.yParity),
    blockHash: null, blockNumber: null, transactionIndex: null };
}

async function fixture(t, options = {}) {
  const wallet = Wallet.createRandom(), actor = wallet.address.toLowerCase();
  assert.equal(wallet.provider, null);
  const store = new MemoryCredentialStore({ 'synthetic-tenant:tester': { secret, lastStep: -1, revision: 1, sentinel: 'preserve-existing-credential' } });
  const state = { now: epoch, chain: hex(chainId), nonce: '0x7', head: 100n, actorCode: '0x', recipientCode: '0x',
    visible: null, receipt: null, hideTransaction: false, signCalls: 0, broadcasts: 0, methods: [], readRequests: [],
    operationKey: null, plans: [], planInputs: [], signedHashes: [] };
  const provider = Object.freeze({ async request({ method, params = [] }) {
    state.methods.push(method);
    if (method !== 'eth_sendRawTransaction') state.readRequests.push(structuredClone({ method, params }));
    if (method === 'eth_chainId') return state.chain;
    if (method === 'eth_getBalance') return state.balance ?? '0xffffffffffffffff';
    if (method === 'eth_getTransactionCount') { assert.equal(params[0], actor); assert.equal(params[1], 'pending'); return state.nonce; }
    if (method === 'eth_getCode') {
      const address = params[0].toLowerCase();
      assert.ok(address === actor || address === recipient, 'only the synthetic task addresses are read');
      return address === actor ? state.actorCode : state.recipientCode;
    }
    if (method === 'eth_getBlockByNumber') {
      assert.equal(params[1], false);
      const number = ['latest', 'safe', 'finalized'].includes(params[0]) ? state.head : BigInt(params[0]);
      assert.ok(number === 100n || number === state.head);
      return { number: hex(number), hash: blockHash(number), gasLimit: hex(30_000_000), baseFeePerGas: '0x2' };
    }
    if (method === 'eth_estimateGas' || method === 'eth_call') {
      const tx = params[0];
      assert.equal(tx.from, actor); assert.equal(tx.to.toLowerCase(), recipient); assert.equal(tx.data, '0x');
      assert.equal(tx.value, '0xa'); assert.equal(tx.chainId, hex(chainId)); assert.equal(tx.nonce, '0x7');
      assert.equal(params[1], 'pending');
      return method === 'eth_estimateGas' ? hex(21000) : '0x';
    }
    if (method === 'eth_getTransactionByHash') {
      assert.ok(state.signedHashes.includes(params[0]), 'recovery queries only the persisted synthetic transaction hash');
      return state.hideTransaction ? null : structuredClone(state.visible);
    }
    if (method === 'eth_getTransactionReceipt') {
      assert.equal(params[0], state.visible?.hash);
      return structuredClone(state.receipt);
    }
    if (method === 'eth_blockNumber') return hex(state.head);
    if (method === 'eth_sendRawTransaction') {
      state.broadcasts++;
      const tx = Transaction.from(params[0]);
      assert.equal(tx.from.toLowerCase(), actor); assert.equal(tx.chainId, BigInt(chainId));
      assert.equal(tx.to.toLowerCase(), recipient); assert.equal(tx.value, 10n); assert.equal(tx.data, '0x');
      const persisted = await store.read(state.operationKey), nonce = await store.read(persisted.nonceKey);
      assert.equal(persisted.status, 'outcome-unknown'); assert.equal(persisted.exactSignature.state, 'signed');
      assert.equal(persisted.exactSignature.transactionHash, tx.hash); assert.equal(nonce.permanent, true);
      assert.equal(JSON.stringify(persisted).includes(params[0]), false, 'raw signed bytes are never persisted');
      state.visible = queriedTransaction(tx);
      if (options.lostResponse) throw Error('Synthetic lost broadcast response');
      return tx.hash;
    }
    throw Error(`Unexpected in-process provider method: ${method}`);
  } });
  const externalSigner = Object.freeze({ async signExactTransaction(request, execution) {
    state.signCalls++;
    assert.deepEqual(Object.keys(request), ['requestId', 'unsignedSerialized', 'unsignedDigest', 'binding']);
    assert.ok(Object.isFrozen(request) && Object.isFrozen(request.binding));
    const tx = Transaction.from(request.unsignedSerialized);
    assert.equal(tx.isSigned(), false); assert.equal(tx.unsignedHash, request.unsignedDigest);
    assert.equal(request.binding.actor, actor); assert.equal(request.binding.chainId, chainId);
    assert.equal(request.binding.childDigest, freezeChildOperation(state.plans.at(-1)).digest);
    await options.onSign?.({ state, request, store });
    assert.ok(Object.isFrozen(execution) && typeof execution.withSigningFence === 'function');
    const serialized = await execution.withSigningFence(() => wallet.signTransaction(tx));
    state.signedHashes.push(Transaction.from(serialized).hash);
    return serialized;
  } });
  const password = 'synthetic-planner-background-password', passwordHash = await hashPassword(password);
  let handler, execution, exact, receipt, counters, rule;
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await Promise.all(runners.map(runner => runner.stop())); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`, runners = [];
  function configure(nextRule = feeRule) {
    rule = nextRule;
    exact = createTaskExactSignerAdapter({ provider, externalSigner, signerIdentity, store,
      maxPriorityFeePerGasWei: nextRule.maxPriorityFeePerGasWei, plannerFeeRule: nextRule,
      agentId: 'synthetic:background-agent', agentVersion: '1', now: () => state.now });
    counters = { plan: 0, verify: 0, send: 0, recover: 0, assess: 0, observe: 0 };
    const adapter = exact, counted = counters;
    // These transparent test hooks count and pause real runtime methods. They
    // never construct a child, approve a grant, sign bytes or invent a receipt.
    execution = Object.freeze({ identity: adapter.identity,
      async plan(input) {
        counted.plan++; state.planInputs.push(input);
        const child = await adapter.plan(input);
        if (child !== null) { state.plans.push(child); state.operationKey = operationKey(actor, child.operationId); }
        return child;
      },
      async verify(input) { counted.verify++; await options.beforeVerify?.({ state, input, store }); return adapter.verify(input); },
      async send(input) { counted.send++; return adapter.send(input); },
      async recover(input) { counted.recover++; return adapter.recover(input); },
    });
    const actualReceipt = createTaskReceiptAdapter({ provider, observationPolicy, now: () => state.now });
    receipt = Object.freeze({ identity: actualReceipt.identity, observationPolicy: actualReceipt.observationPolicy,
      async assessChild(input) { counted.assess++; return actualReceipt.assessChild(input); },
      async observe(input) { counted.observe++; return actualReceipt.observe(input); },
    });
    handler = createAuthService({ origin, tenant: 'synthetic-tenant', accounts: [{ username: 'tester', passwordHash,
      wallets: [{ account: actor, chainId }] }], store, now: () => state.now,
      taskExecution: execution, taskExecutorIdentity: exact.identity, taskObservationPolicy: observationPolicy, taskReceipt: receipt });
    return exact;
  }
  configure();
  let csrf = ''; const cookies = new Map();
  async function call(path, body) {
    const response = await fetch(`${origin}/auth/${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'X-Wallet-Tenant': 'synthetic-tenant', 'X-Wallet-CSRF': csrf,
        Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const cookie of response.headers.getSetCookie()) {
      const [key, value] = cookie.split(';')[0].split('=');
      if (value) cookies.set(key, value); else cookies.delete(key);
    }
    const data = await response.json(); if (data.csrf) csrf = data.csrf;
    return { status: response.status, data };
  }
  async function login() {
    accepted(await call('bootstrap'));
    return accepted(await call('password', { username: 'tester', password, account: actor, chainId }));
  }
  const policy = taskId => ({ schema: '8415-agent-task/1', taskId: taskId ?? 'synthetic:planner-background', tenant: 'synthetic-tenant', origin,
    chainId, actor, expiresAt: String(epoch / 1000 + 7200), fees: { perOperationWei: '1000000', totalWei: '1000000' },
    intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId, actor, recipient, valueWei: '10' } } });
  async function prepare(taskId) { return accepted(await call('tasks/prepare', { policy: policy(taskId) })); }
  async function approve(prepared) {
    return accepted(await call('tasks/authorize', { challengeId: prepared.challengeId, taskDigest: prepared.task.digest,
      executorDigest: prepared.executor.digest, observationPolicyDigest: prepared.observationPolicy.digest,
      code: prepared.approvalFactor === 'totp' ? hotp(secret, Math.floor(state.now / 30000)) : '' }));
  }
  function runner() {
    const result = createTaskBackgroundRunner({ store, continuation: handler.taskBackground, now: () => state.now });
    runners.push(result); return result;
  }
  async function grantRecord(digest) {
    const queue = await handler.taskBackground.list({ cursor: '0', limit: 50 });
    for (const entry of queue.entries) { const grant = await store.read(entry); if (grant.task.digest === digest) return grant; }
    assert.fail('Expected a durably authorized grant');
  }
  function mine(confirmations = 2) {
    assert.ok(state.visible); state.head = 100n + BigInt(confirmations) - 1n; state.nonce = '0x8';
    Object.assign(state.visible, { blockNumber: '0x64', blockHash: blockHash(100), transactionIndex: '0x0' });
    state.receipt = { transactionHash: state.visible.hash, from: actor, to: recipient, blockNumber: '0x64',
      blockHash: blockHash(100), transactionIndex: '0x0', status: '0x1', logs: [] };
  }
  return { state, actor, store, call, login, prepare, approve, runner, grantRecord, mine, configure,
    get counters() { return counters; }, get exact() { return exact; }, get handler() { return handler; }, get rule() { return rule; } };
}

for (const end of ['logout', 'session expiry']) test(`HTTP task approval survives ${end}: real planner, exact signer and receipt verifier finish once`, async t => {
  const f = await fixture(t), session = await f.login(), prepared = await f.prepare();
  const runner = f.runner();
  assert.deepEqual((await runner.tick()).results, [], 'login and task preparation grant no execution authority');
  const approved = await f.approve(prepared);
  assert.equal(approved.budget.reservations.length, 0);
  assert.equal(Object.keys(f.handler).includes('taskBackground'), false);
  if (end === 'logout') accepted(await f.call('logout', {}));
  else f.state.now = session.expiresAt + 1;
  assert.equal((await f.call('tasks/resume', { taskDigest: prepared.task.digest })).status, 401);
  assert.ok((await f.call('tasks/background/resume', { entry: 'forged', internal: true })).status >= 400);
  assert.equal((await runner.tick()).results[0].state, 'submitted');
  assert.deepEqual(f.counters, { plan: 1, verify: 1, send: 1, recover: 0, assess: 1, observe: 0 });
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  const child = f.state.plans[0], grant = await f.grantRecord(prepared.task.digest);
  assert.match(child.operationId, /^plan:[0-9a-f]{64}$/);
  assert.deepEqual(child.operation, prepared.task.policy.intent.operation);
  assert.deepEqual(child.fees, { gasLimit: '25200', maxFeePerGasWei: '5' });
  assert.equal(child.nonce, '7'); assert.equal(child.expiresAt, String(Math.floor(f.state.now / 1000) + 600));
  assert.equal(grant.budget.reservations[0].feeWei, '126000');
  assert.equal(grant.budget.reservations[0].childDigest, freezeChildOperation(child).digest);
  assert.equal(grant.executor.digest, prepared.executor.digest);
  assert.equal(grant.budget.reservations[0].transactionHash, f.state.visible.hash);
  const op = await f.store.read(f.state.operationKey);
  assert.equal(op.exactSignature.binding.taskDigest, prepared.task.digest);
  assert.equal(op.exactSignature.binding.childDigest, grant.budget.reservations[0].childDigest);
  assert.equal(op.exactSignature.binding.executorDigest, prepared.executor.digest);
  assert.equal(op.exactSignature.binding.grantPolicyVersion, '1');
  assert.equal(op.exactSignature.state, 'signed');
  assert.ok(!JSON.stringify(op).includes('unsignedSerialized') && !JSON.stringify(op).includes('signedSerialized'));
  assert.equal(f.state.methods.filter(method => method === 'eth_estimateGas').length, 2);
  assert.ok(f.state.readRequests.some(r => r.method === 'eth_getCode' && r.params[1] === '0x64'));
  assert.ok(!f.state.methods.some(method => ['eth_accounts', 'eth_sendTransaction', 'eth_signTransaction', 'personal_sign'].includes(method)));
  f.mine(1); f.state.now += 5000;
  assert.equal((await runner.tick()).results[0].state, 'awaiting-evidence');
  const confirming = await f.grantRecord(prepared.task.digest);
  assert.equal(confirming.observations[0].observation.state, 'confirming');
  assert.equal(confirming.observations[0].observation.effect, 'not-established');
  f.mine(2); f.state.now += 5000;
  assert.equal((await runner.tick()).results[0].state, 'completed-at-observation-depth');
  const complete = await f.grantRecord(prepared.task.digest), observation = complete.observations[0].observation;
  assert.equal(observation.state, 'confirmed-at-depth'); assert.equal(observation.effect, 'exact-operation-observed');
  assert.equal(observation.protocolFinality, 'not-evaluated'); assert.equal(observation.economicFinality, 'not-evaluated');
  assert.equal(observation.verifierId, '8415wallet:task-receipt'); assert.equal(observation.confirmations, '2');
  assert.equal(observation.originalTransactionHash, f.state.visible.hash);
  assert.deepEqual(complete.budget, grant.budget, 'receipt completion never refunds the consumed one-operation budget');
  assert.equal((await f.store.read('synthetic-tenant:tester')).sentinel, 'preserve-existing-credential');
  f.state.now += 600000;
  assert.deepEqual((await runner.tick()).results, []);
  assert.equal((await f.runner().tick()).results[0].state, 'completed-at-observation-depth', 'new runner reads terminal durable evidence');
  assert.equal(f.counters.plan, 1); assert.equal(f.counters.observe, 2);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  assert.equal((await f.call('tasks/status', { taskDigest: prepared.task.digest })).status, 401, 'continuation does not restore a user session');
});

test('concurrent background runners share the real planner/send fence and make one synthetic signer call', { timeout: 15000 }, async t => {
  let entered, release;
  const arrival = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, { async onSign() { entered(); await gate; } });
  await f.login(); await f.approve(await f.prepare()); accepted(await f.call('logout', {}));
  const first = f.runner(), second = f.runner(), pending = first.tick();
  await Promise.race([arrival, pending.then(result => assert.fail(`Background stopped before synthetic signing: ${JSON.stringify(result)}`))]);
  try {
    assert.equal((await first.tick()).state, 'busy'); assert.equal((await second.tick()).state, 'busy');
    const op = await f.store.read(f.state.operationKey);
    assert.equal(op.status, 'outcome-unknown'); assert.equal(op.exactSignature.state, 'claimed');
    assert.equal(f.state.broadcasts, 0); assert.equal(f.state.signCalls, 1); assert.equal(f.counters.plan, 1);
  } finally { release(); }
  assert.equal((await pending).results[0].state, 'submitted');
  f.mine(); assert.equal((await second.tick()).results[0].state, 'completed-at-observation-depth');
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1); assert.equal(f.counters.plan, 1);
});

test('changed planner fee rule suspends an old HTTP grant before planning and needs fresh explicit approval', async t => {
  const f = await fixture(t); await f.login(); const old = await f.prepare(); await f.approve(old);
  accepted(await f.call('logout', {}));
  const changed = { ...feeRule, gasPaddingBps: '15000', ruleVersion: '2' };
  f.configure(changed);
  assert.notEqual(f.exact.identity.implementationDigest, old.executor.identity.implementationDigest);
  const blocked = await f.runner().tick();
  assert.equal(blocked.results[0].state, 'blocked'); assert.equal(blocked.results[0].code, 'TASK_EXECUTOR_REVALIDATION_REQUIRED');
  assert.equal(f.counters.plan, 0); assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
  assert.equal((await f.grantRecord(old.task.digest)).executor.digest, old.executor.digest);
  f.state.now += 30000; await f.login();
  const status = accepted(await f.call('tasks/status', { taskDigest: old.task.digest }));
  assert.equal(status.effectiveStatus, 'suspended'); assert.equal(status.capabilities.executorRevalidationRequired, true);
  // Existing task versions are immutable. A fresh named task is separately
  // bound to its server-selected approval factor; it does not renew the old grant.
  const fresh = await f.prepare('synthetic:planner-background:rule-v2');
  assert.notEqual(fresh.executor.digest, old.executor.digest);
  assert.notEqual((await f.call('tasks/authorize', { challengeId: fresh.challengeId, taskDigest: fresh.task.digest,
    executorDigest: old.executor.digest, observationPolicyDigest: fresh.observationPolicy.digest,
    code: fresh.approvalFactor === 'totp' ? hotp(secret, Math.floor(f.state.now / 30000)) : '' })).status, 200);
  await f.approve(fresh); accepted(await f.call('logout', {}));
  const changedRunner = f.runner(), resumed = await changedRunner.tick();
  assert.equal(resumed.results.filter(result => result.state === 'submitted').length, 1);
  assert.equal(resumed.results.filter(result => result.code === 'TASK_EXECUTOR_REVALIDATION_REQUIRED').length, 1);
  assert.equal(f.state.plans.length, 1); assert.equal(f.state.plans[0].fees.gasLimit, '31500');
  assert.equal(f.state.plans[0].taskDigest, fresh.task.digest);
  assert.equal((await f.grantRecord(old.task.digest)).budget.reservations.length, 0);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  f.mine(); f.state.now += 5000;
  assert.equal((await changedRunner.tick()).results[0].state, 'completed-at-observation-depth');
});

test('definitely-unsent cancellation keeps its tombstone while background plans a fresh operation ID and sends once', async t => {
  const f = await fixture(t); await f.login(); const prepared = await f.prepare(), approved = await f.approve(prepared);
  const first = await f.exact.plan({ task: approved.task, budget: approved.budget, executor: approved.executor,
    grantPolicyVersion: approved.authorization.grantPolicyVersion });
  assert.ok(first); assert.match(first.operationId, /^plan:[0-9a-f]{64}$/);
  const frozen = freezeChildOperation(first), firstKey = operationKey(f.actor, first.operationId);
  const reserved = accepted(await f.call('tasks/reserve', { taskDigest: prepared.task.digest, child: first,
    expectedBudgetRevision: approved.budget.revision }));
  const before = await f.store.read(firstKey);
  assert.equal(before.status, 'reserved'); assert.equal(before.exactSignature, undefined);
  assert.equal((await f.store.read(before.nonceKey)).permanent, false);
  assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
  const cancelled = accepted(await f.call('tasks/cancel-reservation', { taskDigest: prepared.task.digest,
    operationId: first.operationId, childDigest: frozen.digest, expectedBudgetRevision: reserved.budget.revision }));
  assert.equal(cancelled.budget.revision, String(BigInt(reserved.budget.revision) + 1n));
  assert.equal(cancelled.budget.reservations[0].status, 'cancelled');
  assert.equal((await f.store.read(firstKey)).status, 'cancelled'); assert.equal(await f.store.read(before.nonceKey), null);
  const replay = await f.call('tasks/reserve', { taskDigest: prepared.task.digest, child: first,
    expectedBudgetRevision: cancelled.budget.revision });
  assert.equal(replay.status, 409); assert.equal(replay.data.error, 'TASK_DUPLICATE_OPERATION_REFUSED');
  accepted(await f.call('logout', {}));
  const runner = f.runner(); assert.equal((await runner.tick()).results[0].state, 'submitted');
  const replacement = f.state.plans[0], grant = await f.grantRecord(prepared.task.digest);
  assert.notEqual(replacement.operationId, first.operationId);
  assert.deepEqual({ ...replacement, operationId: first.operationId }, first, 'only the revised operation identity changes at the same clock and chain snapshot');
  assert.equal(f.state.planInputs[0].budget.revision, cancelled.budget.revision);
  assert.deepEqual(grant.budget.reservations.map(r => r.status), ['cancelled', 'submitted']);
  assert.equal(grant.budget.reservations[0].operationId, first.operationId);
  assert.equal(grant.budget.reservations[1].operationId, replacement.operationId);
  assert.equal((await f.store.read(firstKey)).exactSignature, undefined);
  const nonce = await f.store.read(before.nonceKey);
  assert.equal(nonce.permanent, true); assert.equal(nonce.operationKey, f.state.operationKey);
  assert.equal(f.counters.plan, 1); assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  f.mine(); f.state.now += 5000;
  assert.equal((await runner.tick()).results[0].state, 'completed-at-observation-depth');
  assert.equal((await f.store.read(firstKey)).status, 'cancelled');
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
});

test('lost synthetic broadcast stays unknown across service recreation and cannot replan, resign or rebroadcast', async t => {
  const f = await fixture(t, { lostResponse: true }); await f.login(); const prepared = await f.prepare(); await f.approve(prepared);
  accepted(await f.call('logout', {}));
  const runner = f.runner();
  assert.equal((await runner.tick()).results[0].state, 'outcome-unknown');
  const grant = await f.grantRecord(prepared.task.digest), op = await f.store.read(f.state.operationKey);
  assert.equal(grant.budget.reservations.length, 1); assert.equal(grant.budget.reservations[0].status, 'outcome-unknown');
  assert.equal(grant.budget.reservations[0].transactionHash, null); assert.equal(op.exactSignature.state, 'signed');
  assert.equal((await f.store.read(op.nonceKey)).permanent, true);
  f.state.hideTransaction = true;
  const planInput = { task: grant.task, budget: grant.budget, executor: grant.executor, grantPolicyVersion: grant.grantPolicyVersion };
  const reads = f.state.methods.length;
  assert.equal(await f.exact.plan(planInput), null, 'the genuine planner itself refuses an unknown consumed operation');
  assert.equal(f.state.methods.length, reads, 'unknown refusal happens before provider reads');
  await assert.rejects(f.exact.send({ task: grant.task, child: op.child, executor: grant.executor, grantPolicyVersion: grant.grantPolicyVersion }),
    /TASK_EXACT_SIGN_ALREADY_CLAIMED/);
  for (let i = 0; i < 2; i++) {
    f.state.now += 300000; const blocked = await runner.tick();
    assert.equal(blocked.results[0].state, 'blocked'); assert.equal(blocked.results[0].code, 'TASK_EXACT_RECOVERY_NOT_ESTABLISHED');
  }
  assert.equal(f.counters.plan, 1); assert.equal(f.counters.send, 1); assert.equal(f.counters.recover, 2);
  await runner.stop(); f.configure();
  const restarted = f.runner();
  assert.equal((await restarted.tick()).results[0].code, 'TASK_EXACT_RECOVERY_NOT_ESTABLISHED');
  assert.equal(f.counters.plan, 0); assert.equal(f.counters.verify, 0); assert.equal(f.counters.send, 0);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
  assert.deepEqual((await f.grantRecord(prepared.task.digest)).budget, grant.budget);
  // Independent full-transaction evidence may recover the known signed hash.
  // It never supplies authority to sign or broadcast the attempt a second time.
  f.state.hideTransaction = false; f.state.now += 30000;
  assert.equal((await restarted.tick()).results[0].state, 'submitted');
  f.mine(); f.state.now += 5000;
  assert.equal((await restarted.tick()).results[0].state, 'completed-at-observation-depth');
  assert.equal(f.counters.plan, 0); assert.equal(f.counters.send, 0);
  assert.equal(f.state.signCalls, 1); assert.equal(f.state.broadcasts, 1);
});

for (const [field, value, code] of [
  ['nonce', '0x8', 'TASK_EXACT_NONCE_MISMATCH'], ['chain', '0x1', 'TASK_EXACT_CHAIN_MISMATCH'],
  ['actorCode', '0x6000', 'TASK_EXACT_EOA_ACTOR_REQUIRED'], ['recipientCode', '0x6000', 'TASK_EXACT_NATIVE_EOA_REQUIRED'],
]) test(`drift in ${field} after genuine planning is refused by live exact verification before signing`, async t => {
  const f = await fixture(t, { beforeVerify({ state }) { state[field] = value; } });
  await f.login(); const prepared = await f.prepare(); await f.approve(prepared); accepted(await f.call('logout', {}));
  const runner = f.runner(), blocked = await runner.tick();
  assert.equal(blocked.results[0].state, 'blocked'); assert.equal(blocked.results[0].code, code);
  assert.equal(f.counters.plan, 1); assert.equal(f.counters.assess, 1); assert.equal(f.counters.verify, 1); assert.equal(f.counters.send, 0);
  assert.equal(f.state.plans.length, 1); assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
  const grant = await f.grantRecord(prepared.task.digest), op = await f.store.read(f.state.operationKey);
  assert.equal(grant.budget.reservations.length, 1); assert.equal(grant.budget.reservations[0].status, 'reserved');
  assert.equal(op.status, 'reserved'); assert.equal(op.exactSignature, undefined);
  assert.equal((await f.store.read(op.nonceKey)).permanent, false);
  // Let the real receipt capability check pass again, then reproduce the same
  // post-assessment drift exactly at the real signer's verification boundary.
  f.state[field] = { nonce: '0x7', chain: hex(chainId), actorCode: '0x', recipientCode: '0x' }[field];
  f.state.now += 30000;
  assert.equal((await runner.tick()).results[0].code, code);
  assert.equal(f.counters.plan, 1, 'the existing reservation is retried, never replaced by a new proposal');
  assert.equal(f.state.signCalls, 0); assert.equal(f.state.broadcasts, 0);
});
