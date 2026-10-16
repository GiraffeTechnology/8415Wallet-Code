/** All RPC responses are synthetic in-process fixtures. No network or keys. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskExactOperationPlanner, createTaskPlannerReadProvider, normalizeTaskExactFeeRule } from '../server/task-exact-operation-planner.mjs';
import { createTaskExactSignerAdapter } from '../server/task-exact-signer-adapter.mjs';
import { encodeTaskOperationCall, encodeExactTaskOperation } from '../server/task-operation-encoding.mjs';
import { freezeTaskExecutorIdentity } from '../server/task-authorization.mjs';
import { freezeTaskPolicy, freezeChildOperation, emptyTaskBudget, reserveTaskBudget, cancelUnattemptedReservation, assessChildScope } from '../src/agent/taskContract.ts';
import { hashControlBytes } from '../src/controls/authorization.ts';
import { encodeCall, encodeWords } from '../src/codec/abi.ts';

const actor = `0x${'1'.repeat(40)}`, recipient = `0x${'2'.repeat(40)}`, controllerAddress = `0x${'3'.repeat(40)}`,
  tokenAddress = `0x${'4'.repeat(40)}`, account = `0x${'5'.repeat(40)}`, code = '0x60016001', runtimeCodeHash = hashControlBytes(code),
  sequenceId = `0x${'6'.repeat(64)}`, legId = `0x${'7'.repeat(64)}`, blockHash = `0x${'8'.repeat(64)}`, epoch = 1_800_000_000_000;
const rule = { schema: '8415-task-exact-fee-rule/1', ruleId: 'synthetic:fee', ruleVersion: '20261010', sampleBlock: 'latest',
  simulationBlock: 'pending', gasPaddingBps: '12000', gasLimitCeiling: '1000000', baseFeeMultiplierBps: '20000',
  maxPriorityFeePerGasWei: '1', maxFeePerGasWeiCeiling: '100', maxChildLifetimeSeconds: '600' };
const executor = freezeTaskExecutorIdentity({ schema: '8415-task-executor/1', agentId: 'synthetic:agent', agentVersion: '1',
  adapterId: 'synthetic:executor', adapterVersion: '1', implementationDigest: `0x${'9'.repeat(64)}` });
const controller = { contract: controllerAddress, runtimeCodeHash }, token = { contract: tokenAddress, runtimeCodeHash };
const operations = [
  { kind: 'native-transfer', recipient, valueWei: '10' },
  { kind: 'erc20-transfer', contract: tokenAddress, recipient, amount: '7' },
  { kind: 'erc721-transfer', contract: tokenAddress, recipient, tokenId: '7' },
  { kind: 'erc1155-transfer', contract: tokenAddress, recipient, tokenId: '7', amount: '3' },
  { kind: 'create-account', controller }, { kind: 'deposit', controller, token, tokenId: '7' },
  { kind: 'standalone-withdraw', controller, token, tokenId: '7', destination: recipient },
  { kind: 'complete', controller, token, sequenceId, legId, expectedRevision: '3' },
  { kind: 'return-hop', controller, token, sequenceId, legId, expectedRevision: '3' },
];
const h = value => `0x${BigInt(value).toString(16)}`;
function fixture(options = {}) {
  const state = { now: epoch, requests: [], estimates: 0, nonces: 0, chains: 0, ...(options.state ?? {}) };
  const task = freezeTaskPolicy({ schema: '8415-agent-task/1', taskId: 'synthetic:task', tenant: 'xiongan', origin: 'https://wallet.example.invalid',
    actor, chainId: '11155111', expiresAt: String(epoch / 1000 + 7200), fees: { perOperationWei: '10000000', totalWei: '20000000' },
    intent: { kind: 'exact-operation', operation: { actor, chainId: '11155111', ...(options.operation ?? operations[0]) } }, ...(options.policy ?? {}) });
  const provider = { async request(request) {
    const { method, params } = request; state.requests.push(structuredClone(request));
    if (method === 'eth_estimateGas') state.estimates++;
    if (method === 'eth_chainId') state.chains++;
    if (method === 'eth_getTransactionCount') state.nonces++;
    if (options.rpc) { const result = await options.rpc({ ...request, state }); if (result !== undefined) return result; }
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_getBalance') return '0xffffffffffffffff';
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_getBlockByNumber') return { number: '0x2a', hash: blockHash, baseFeePerGas: '0x2', gasLimit: '0x1c9c380', timestamp: h(epoch / 1000) };
    if (method === 'eth_getCode') return [actor, recipient].includes(params[0]) ? '0x' : code;
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_call') {
      const tx = params[0];
      if (tx.from) return '0x';
      if (tx.data === encodeCall('accountOf(address)', ['address'], [actor])) return encodeWords(['address'], [account]);
      if (tx.data === encodeCall('registeredAccount(address)', ['address'], [account])) return encodeWords(['bool'], [true]);
      if (tx.data === encodeCall('owner()', [], [])) return encodeWords(['address'], [actor]);
      if (tx.data === encodeCall('controller()', [], [])) return encodeWords(['address'], [controllerAddress]);
      if (tx.data === encodeCall('sequence(bytes32)', ['bytes32'], [sequenceId])) return encodeWords(
        ['address','uint256','address','address','address','bytes32','bytes32','bytes32','uint256','uint256','uint256','uint256','uint256','bytes32','bool'],
        [tokenAddress,7n,actor,account,recipient,sequenceId,legId,runtimeCodeHash,3n,1n,1n,0n,1n,sequenceId,false]);
    }
    throw Error(`UNEXPECTED_SYNTHETIC_RPC:${method}`);
  } };
  const feeRule = { ...rule, ...(options.feeRule ?? {}) };
  const planner = createTaskExactOperationPlanner({ provider, feeRule, now: () => state.now });
  const input = { task, budget: emptyTaskBudget(task), executor, grantPolicyVersion: '1' };
  return { state, task, provider, planner, input, feeRule };
}
for (const operation of operations) test(`${operation.kind}: planner generates exact closed-list operation with real simulation fields`, async () => {
  const f = fixture({ operation }), proposed = await f.planner.plan(f.input), frozen = freezeChildOperation(proposed);
  const call = encodeTaskOperationCall(f.task.policy.intent.operation, account);
  assert.deepEqual(encodeExactTaskOperation(frozen, account), call);
  assert.equal(proposed.nonce, '7'); assert.deepEqual(proposed.fees, { gasLimit: '25200', maxFeePerGasWei: '5' });
  assert.equal(proposed.expiresAt, String(epoch / 1000 + 600)); assert.equal(proposed.market, null);
  assert.equal(assessChildScope(f.task, frozen, BigInt(epoch / 1000)).state, 'requires-trusted-verification');
  assert.ok(Object.isFrozen(proposed) && Object.isFrozen(proposed.operation) && Object.isFrozen(proposed.fees));
  const estimates = f.state.requests.filter(r => r.method === 'eth_estimateGas');
  assert.equal(estimates.length, 2);
  const simulation = f.state.requests.find(r => r.method === 'eth_call' && r.params[0].from);
  assert.deepEqual(simulation.params, estimates[1].params);
  assert.deepEqual(simulation.params, [{ from: actor, to: call.to, data: call.data, value: h(call.value), chainId: '0xaa36a7', nonce: '0x7',
    type: '0x2', gas: h(25200), maxFeePerGas: '0x5', maxPriorityFeePerGas: '0x1', accessList: [] }, 'pending']);
  assert.ok(f.state.requests.filter(r => r.method === 'eth_getCode' || r.method === 'eth_call' && !r.params[0].from).every(r => r.params[1] === '0x2a'));
  assert.ok(f.state.requests.filter(r => r.method === 'eth_getTransactionCount').every(r => r.params[1] === 'pending'));
  assert.deepEqual(Object.keys(f.planner), ['identity', 'plan']);
});

test('canonical proposal and operation ID are stable across repeated/concurrent plans without mutation', async () => {
  const f = fixture(), before = JSON.stringify(f.input);
  const proposals = await Promise.all(Array.from({ length: 12 }, () => f.planner.plan(f.input)));
  assert.ok(proposals.every(p => JSON.stringify(p) === JSON.stringify(proposals[0]))); assert.equal(JSON.stringify(f.input), before);
  assert.match(proposals[0].operationId, /^plan:[0-9a-f]{64}$/);
  const changed = await f.planner.plan({ ...f.input, budget: { ...f.input.budget, revision: '1' } });
  assert.notEqual(changed.operationId, proposals[0].operationId);
});

for (const status of ['reserved', 'submitted', 'outcome-unknown']) test(`${status} consumes the one exact-operation quota without any planner RPC`, async () => {
  const f = fixture(); f.input.budget = { ...f.input.budget, revision: '3', reservations: [{ operationId: 'existing', childDigest: legId,
    feeWei: f.task.policy.fees.totalWei, units: '1', status, transactionHash: status === 'submitted' ? sequenceId : null }] };
  assert.equal(await f.planner.plan(f.input), null); assert.equal(f.state.requests.length, 0);
});

test('cancelled definitely-unsent history remains tombstoned and a new revision gets a new ID', async () => {
  const f = fixture(), first = freezeChildOperation(await f.planner.plan(f.input));
  const reserved = reserveTaskBudget(f.task, first, f.input.budget, '0', BigInt(epoch / 1000));
  const cancelled = cancelUnattemptedReservation(reserved, first.child.operationId, first.digest, '1');
  const next = await f.planner.plan({ ...f.input, budget: cancelled });
  assert.notEqual(next.operationId, first.child.operationId); assert.equal(cancelled.reservations[0].operationId, first.child.operationId);
  assert.equal(cancelled.reservations[0].status, 'cancelled');
  const forgedSameRevision = { ...f.input.budget, reservations: cancelled.reservations };
  await assert.rejects(f.planner.plan({ ...f.input, budget: forgedSameRevision }), /TASK_PLAN_OPERATION_TOMBSTONED/);
});

test('concurrent proposals are untrusted until one durable budget CAS succeeds', async () => {
  const f = fixture(); const a = await f.planner.plan(f.input), b = await f.planner.plan(f.input);
  let budget = f.input.budget;
  const reserve = child => { assert.equal(budget.revision, '0', 'synthetic atomic CAS conflict');
    budget = reserveTaskBudget(f.task, freezeChildOperation(child), budget, '0', BigInt(epoch / 1000)); };
  reserve(a); assert.throws(() => reserve(b), /synthetic atomic CAS conflict/); assert.equal(budget.reservations.length, 1);
  assert.equal(await f.planner.plan({ ...f.input, budget }), null);
});

for (const sampleBlock of ['latest', 'safe', 'finalized']) test(`explicit ${sampleBlock} header selection is pinned without fallback`, async () => {
  const f = fixture({ feeRule: { sampleBlock } }); await f.planner.plan(f.input);
  assert.deepEqual(f.state.requests.filter(r => r.method === 'eth_getBlockByNumber').map(r => r.params), [[sampleBlock, false], ['0x2a', false]]);
});

const invalidRules = {
  missing: undefined, unversioned: { ...rule, ruleVersion: '' }, schema: { ...rule, schema: 'other' },
  implicitSample: { ...rule, sampleBlock: undefined }, pendingHeader: { ...rule, sampleBlock: 'pending' }, arbitraryHeader: { ...rule, sampleBlock: '0x1' },
  implicitSimulation: { ...rule, simulationBlock: undefined }, latestSimulation: { ...rule, simulationBlock: 'latest' },
  gasPadding: { ...rule, gasPaddingBps: '9999' }, gasZero: { ...rule, gasLimitCeiling: '0' }, baseMultiplier: { ...rule, baseFeeMultiplierBps: '9999' },
  priorityAboveFee: { ...rule, maxPriorityFeePerGasWei: '101' }, negative: { ...rule, maxPriorityFeePerGasWei: '-1' },
  decimal: { ...rule, gasPaddingBps: '1.2' }, number: { ...rule, gasLimitCeiling: 1000000 }, unsafe: { ...rule, gasLimitCeiling: (1n << 256n).toString() },
  lifetimeZero: { ...rule, maxChildLifetimeSeconds: '0' }, extra: { ...rule, walletSuggestedFee: '5' },
};
for (const [name, feeRule] of Object.entries(invalidRules)) test(`explicit fee rule refuses ${name}`, () => {
  assert.throws(() => createTaskExactOperationPlanner({ provider: { request() { assert.fail('no RPC'); } }, feeRule }));
});

test('normalized rule is captured and bound to identity including version, block policy, fee and lifetime', async () => {
  const f = fixture(), before = await f.planner.plan(f.input), identity = f.planner.identity;
  f.feeRule.maxPriorityFeePerGasWei = '9'; f.provider.request = () => { assert.fail('captured method replaced'); };
  assert.deepEqual(await f.planner.plan(f.input), before); assert.ok(Object.isFrozen(identity));
  for (const changed of [{ ruleVersion: '2' }, { maxPriorityFeePerGasWei: '2' }, { sampleBlock: 'safe' }, { maxChildLifetimeSeconds: '30' }, { gasPaddingBps: '11000' }]) {
    assert.notEqual(fixture({ feeRule: changed }).planner.identity.implementationDigest, identity.implementationDigest);
  }
  assert.ok(Object.isFrozen(normalizeTaskExactFeeRule(rule)));
  const getter = { ...rule }; Object.defineProperty(getter, 'ruleVersion', { get() { assert.fail('getters must not execute'); }, enumerable: true });
  assert.throws(() => normalizeTaskExactFeeRule(getter), /TASK_PLAN_SCHEMA_REFUSED/);
});

const rpcFailures = {
  chainStart: ({ method }) => method === 'eth_chainId' ? '0x1' : undefined,
  chainDrift: ({ method, state }) => method === 'eth_chainId' && state.chains > 1 ? '0x1' : undefined,
  nonceDrift: ({ method, state }) => method === 'eth_getTransactionCount' && state.nonces > 1 ? '0x8' : undefined,
  unsafeNonce: ({ method }) => method === 'eth_getTransactionCount' ? h(BigInt(Number.MAX_SAFE_INTEGER) + 1n) : undefined,
  missingEstimate: ({ method }) => method === 'eth_estimateGas' ? null : undefined,
  zeroEstimate: ({ method }) => method === 'eth_estimateGas' ? '0x0' : undefined,
  extremeEstimate: ({ method }) => method === 'eth_estimateGas' ? `0x${'f'.repeat(64)}` : undefined,
  overflowingQuantity: ({ method }) => method === 'eth_estimateGas' ? `0x1${'0'.repeat(64)}` : undefined,
  malformedEstimate: ({ method }) => method === 'eth_estimateGas' ? '0x05208' : undefined,
  changedFinalEstimate: ({ method, state }) => method === 'eth_estimateGas' && state.estimates > 1 ? '0x100000' : undefined,
  missingHeader: ({ method }) => method === 'eth_getBlockByNumber' ? null : undefined,
  missingBaseFee: ({ method }) => method === 'eth_getBlockByNumber' ? { number: '0x2a', hash: blockHash, gasLimit: '0xffffff' } : undefined,
  extremeBaseFee: ({ method }) => method === 'eth_getBlockByNumber' ? { number: '0x2a', hash: blockHash, gasLimit: '0xffffff', baseFeePerGas: `0x${'f'.repeat(64)}` } : undefined,
  zeroBlockGas: ({ method }) => method === 'eth_getBlockByNumber' ? { number: '0x2a', hash: blockHash, gasLimit: '0x0', baseFeePerGas: '0x2' } : undefined,
  sampleReorg: ({ method, params }) => method === 'eth_getBlockByNumber' && params[0] === '0x2a' ? { number: '0x2a', hash: sequenceId } : undefined,
  invalidSimulation: ({ method, params }) => method === 'eth_call' && params[0].from ? null : undefined,
  actorCode: ({ method, params }) => method === 'eth_getCode' && params[0] === actor ? code : undefined,
  nativeRecipientCode: ({ method, params }) => method === 'eth_getCode' && params[0] === recipient ? code : undefined,
};
for (const [name, rpc] of Object.entries(rpcFailures)) test(`planner fails closed on ${name}`, async () => {
  const f = fixture({ rpc }); await assert.rejects(f.planner.plan(f.input));
  assert.ok(f.state.requests.every(r => !['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign'].includes(r.method)));
});

test('provider errors expose a fixed code without leaking endpoint or payload', async () => {
  const f = fixture({ rpc() { throw Error('private endpoint https://secret.invalid/credential'); } });
  await assert.rejects(f.planner.plan(f.input), error => error.code === 'TASK_PLAN_RPC_FAILED' && !error.message.includes('secret'));
});

for (const budget of ['1', '125999']) test(`parent per-operation/total fee limit ${budget} is never enlarged`, async () => {
  const f = fixture({ policy: { fees: { perOperationWei: budget, totalWei: budget } } });
  await assert.rejects(f.planner.plan(f.input), /TASK_PLAN_FEE_BUDGET_EXHAUSTED|TASK_PLAN_GAS_BUDGET_REFUSED/);
});

test('exact budget boundary succeeds with integer-only ceiling arithmetic', async () => {
  const f = fixture({ policy: { fees: { perOperationWei: '126000', totalWei: '126000' } } });
  const proposal = await f.planner.plan(f.input); assert.equal(BigInt(proposal.fees.gasLimit) * BigInt(proposal.fees.maxFeePerGasWei), 126000n);
  const rounded = fixture({ feeRule: { gasPaddingBps: '10001', baseFeeMultiplierBps: '10001' } });
  const p = await rounded.planner.plan(rounded.input); assert.deepEqual(p.fees, { gasLimit: '21003', maxFeePerGasWei: '4' });
});

for (const change of [{ gasLimitCeiling: '21000' }, { maxFeePerGasWeiCeiling: '4' }]) test(`server gas or max-fee ceiling is fail-closed: ${JSON.stringify(change)}`, async () => {
  const f = fixture({ feeRule: change }); await assert.rejects(f.planner.plan(f.input));
});

test('child expiry is min(parent expiry, explicit lifetime, hard 900-second contract)', async () => {
  for (const [lifetime, parent, expected] of [['3600', 7200, 900], ['60', 7200, 60], ['600', 30, 30]]) {
    const f = fixture({ feeRule: { maxChildLifetimeSeconds: lifetime }, policy: { expiresAt: String(epoch / 1000 + parent) } });
    assert.equal((await f.planner.plan(f.input)).expiresAt, String(epoch / 1000 + expected));
  }
  const expired = fixture({ state: { now: epoch + 7200000 } }); await assert.rejects(expired.planner.plan(expired.input), /TASK_PLAN_EXPIRED/);
  assert.equal(expired.state.requests.length, 0);
  const during = fixture({ rpc({ method, state }) { if (method === 'eth_estimateGas') state.now = epoch + 601000; } });
  await assert.rejects(during.planner.plan(during.input), /TASK_PLAN_SCOPE_REFUSED/);
});

test('sale intents and input executor/budget mutations cannot select a new authority or rule', async () => {
  const f = fixture();
  const sale = freezeTaskPolicy({ ...f.task.policy, intent: { kind: 'nft-sale', direction: 'sell', standard: 'ERC-721', contract: tokenAddress,
    tokenId: '7', quantity: '1', minimumProceeds: { currency: 'USD', amountMinor: '50000', minorUnit: 2, comparison: 'gt', basis: 'net' }, marketAdapters: ['synthetic:market'] } });
  await assert.rejects(f.planner.plan({ ...f.input, task: sale, budget: emptyTaskBudget(sale) }), /TASK_ATOMIC_SALE_VERIFIER_NOT_CONNECTED/);
  await assert.rejects(f.planner.plan({ ...f.input, feeRule: rule }), /TASK_PLAN_SCHEMA_REFUSED/);
  await assert.rejects(f.planner.plan({ ...f.input, budget: { ...f.input.budget, taskDigest: sequenceId } }), /TASK_PLAN_BINDING_REFUSED/);
  await assert.rejects(f.planner.plan({ ...f.input, executor: { ...executor, digest: sequenceId } }), /TASK_PLAN_EXECUTOR_BINDING_REFUSED/);
  await assert.rejects(f.planner.plan({ ...f.input, budget: { ...f.input.budget, revision: ((1n << 256n) - 1n).toString() } }), /TASK_PLAN_BUDGET_REVISION_EXHAUSTED/);
  assert.equal(f.state.requests.length, 0);
});

for (const operation of [operations[5], operations[6]]) test(`${operation.kind} refuses wrong owner/controller/registration/code/account`, async () => {
  const mismatches = [
    ['accountOf(address)', ['address'], [actor], encodeWords(['address'], [`0x${'0'.repeat(40)}`])],
    ['registeredAccount(address)', ['address'], [account], encodeWords(['bool'], [false])],
    ['owner()', [], [], encodeWords(['address'], [recipient])], ['controller()', [], [], encodeWords(['address'], [recipient])],
  ];
  for (const [signature, types, values, response] of mismatches) {
    const f = fixture({ operation, rpc({ method, params }) { if (method === 'eth_call' && params[0].data === encodeCall(signature, types, values)) return response; } });
    await assert.rejects(f.planner.plan(f.input));
  }
  const f = fixture({ operation, rpc({ method, params }) { if (method === 'eth_getCode' && params[0] === controllerAddress) return '0x6000'; } });
  await assert.rejects(f.planner.plan(f.input), /CONTROL_RUNTIME_PIN_MISMATCH/);
});

test('ERC-20 false simulation and missing contract code are refused', async () => {
  const f = fixture({ operation: operations[1], rpc({ method, params }) { if (method === 'eth_call' && params[0].from) return encodeWords(['bool'], [false]); } });
  await assert.rejects(f.planner.plan(f.input), /TASK_PLAN_ERC20_RETURN_REFUSED/);
  const empty = fixture({ operation: operations[1], rpc({ method }) { if (method === 'eth_getCode') return '0x'; } });
  await assert.rejects(empty.planner.plan(empty.input), /TASK_PLAN_TARGET_CODE_REQUIRED/);
});

test('read-only port refuses write/sign/account-selection methods before provider invocation', async () => {
  let calls = 0; const port = createTaskPlannerReadProvider({ request() { calls++; return '0x'; } });
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_signTransaction', 'eth_signTypedData_v4', 'personal_sign',
    'wallet_switchEthereumChain', 'eth_accounts', 'eth_requestAccounts', 'debug_traceCall', '__proto__']) {
    await assert.rejects(port.request({ method, params: [] }), /TASK_PLAN_RPC_WRITE_REFUSED/);
  }
  assert.equal(calls, 0);
  for (const method of ['eth_chainId', 'eth_getTransactionCount', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas']) await port.request({ method });
  assert.equal(calls, 6); assert.ok(Object.isFrozen(port));
});

function signer(f, plannerFeeRule = null) {
  const unused = () => { assert.fail('planning must never invoke signer or store'); };
  return createTaskExactSignerAdapter({ provider: f.provider, externalSigner: { signExactTransaction: unused },
    signerIdentity: { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: sequenceId },
    store: { readMany: unused, transactionMany: unused, withReadSnapshot: unused }, maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1',
    plannerFeeRule, now: () => f.state.now });
}
test('factory v2 owns the planner identity and checks its own full executor digest during plan and verify', async () => {
  const f = fixture(), plain = signer(f), combined = signer(f, rule);
  assert.equal(plain.plan, undefined); assert.equal(combined.identity.adapterVersion, '2');
  assert.notEqual(plain.identity.implementationDigest, combined.identity.implementationDigest);
  const input = { ...f.input, executor: freezeTaskExecutorIdentity(combined.identity) };
  const child = freezeChildOperation(await combined.plan(input));
  assert.equal((await combined.verify({ task: f.task, child, executor: input.executor, grantPolicyVersion: '1' })).executorDigest, input.executor.digest);
  await assert.rejects(combined.plan({ ...input, executor: freezeTaskExecutorIdentity(plain.identity) }), /TASK_EXACT_BINDING_REFUSED/);
  // Relabeling an old factory around an external planner cannot change the
  // executor identity captured in that factory's verify/send/recover closures.
  await assert.rejects(plain.verify({ task: f.task, child, executor: input.executor, grantPolicyVersion: '1' }), /TASK_EXACT_BINDING_REFUSED/);
  assert.throws(() => signer(f, { ...rule, maxPriorityFeePerGasWei: '2' }), /TASK_EXACT_PLANNER_PRIORITY_MISMATCH/);
});

test('signer rechecks live nonce/chain after planning and server gas/fee/lifetime ceilings', async () => {
  for (const drift of ['chain', 'nonce']) {
    let changed = false;
    const f = fixture({ rpc({ method }) { if (changed && method === (drift === 'chain' ? 'eth_chainId' : 'eth_getTransactionCount')) return drift === 'chain' ? '0x1' : '0x8'; } });
    const combined = signer(f, rule), executor = freezeTaskExecutorIdentity(combined.identity);
    const child = freezeChildOperation(await combined.plan({ ...f.input, executor })); changed = true;
    await assert.rejects(combined.verify({ task: f.task, child, executor, grantPolicyVersion: '1' }), /TASK_EXACT_CHAIN_MISMATCH|TASK_EXACT_NONCE_MISMATCH/);
  }
  const f = fixture(), combined = signer(f, { ...rule, gasLimitCeiling: '30000', maxFeePerGasWeiCeiling: '5' }), executor = freezeTaskExecutorIdentity(combined.identity);
  const child = await combined.plan({ ...f.input, executor });
  for (const changed of [{ fees: { ...child.fees, gasLimit: '30001' } }, { fees: { ...child.fees, maxFeePerGasWei: '6' } }, { expiresAt: String(epoch / 1000 + 601) }]) {
    await assert.rejects(combined.verify({ task: f.task, child: freezeChildOperation({ ...child, ...changed }), executor, grantPolicyVersion: '1' }), /TASK_EXACT_PLANNER_RULE_REFUSED/);
  }
});

test('complete cancellation history beyond a transport page is preserved without ID reuse', async () => {
  const f = fixture(), history = Array.from({ length: 257 }, (_, i) => ({ operationId: `cancelled:${i}`, childDigest: legId,
    feeWei: '10000000', units: '1', status: 'cancelled', transactionHash: null }));
  const budget = { ...f.input.budget, revision: '514', reservations: history };
  const proposal = await f.planner.plan({ ...f.input, budget });
  const reserved = reserveTaskBudget(f.task, freezeChildOperation(proposal), budget, '514', BigInt(epoch / 1000));
  assert.equal(reserved.reservations.length, 258); assert.deepEqual(reserved.reservations.slice(0, 257), history);
});

test('control sequence token, code hash and revision are independently bound', async () => {
  for (const field of ['token', 'tokenCodeHash', 'revision']) {
    const f = fixture({ operation: operations[7], rpc({ method, params }) {
      if (method === 'eth_call' && params[0].data === encodeCall('sequence(bytes32)', ['bytes32'], [sequenceId])) return encodeWords(
        ['address','uint256','address','address','address','bytes32','bytes32','bytes32','uint256','uint256','uint256','uint256','uint256','bytes32','bool'],
        [field === 'token' ? recipient : tokenAddress,7n,actor,account,recipient,sequenceId,legId,field === 'tokenCodeHash' ? sequenceId : runtimeCodeHash,
          field === 'revision' ? 4n : 3n,1n,1n,0n,1n,sequenceId,false]);
    } });
    await assert.rejects(f.planner.plan(f.input), /TASK_PLAN_SEQUENCE_BINDING_REFUSED/);
  }
});

test('sampled block gas ceiling and final exact estimate are enforced without fallback', async () => {
  const f = fixture({ rpc({ method }) { if (method === 'eth_getBlockByNumber') return { number: '0x2a', hash: blockHash,
    gasLimit: '0x5208', baseFeePerGas: '0x2' }; } });
  await assert.rejects(f.planner.plan(f.input), /TASK_PLAN_GAS_BUDGET_REFUSED/);
  const unsupported = fixture({ feeRule: { sampleBlock: 'safe' }, rpc({ method }) { if (method === 'eth_getBlockByNumber') throw Error('UNSUPPORTED_SAFE_BLOCK'); } });
  await assert.rejects(unsupported.planner.plan(unsupported.input), /TASK_PLAN_RPC_FAILED/);
  assert.deepEqual(unsupported.state.requests.filter(r => r.method === 'eth_getBlockByNumber').map(r => r.params[0]), ['safe']);
});

test('zero-base EIP-1559 facts require explicit positive resulting fee; zero priority is otherwise supported', async () => {
  const zeroBase = ({ method }) => method === 'eth_getBlockByNumber'
    ? { number: '0x2a', hash: blockHash, gasLimit: '0xffffff', baseFeePerGas: '0x0' } : undefined;
  const permitted = fixture({ rpc: zeroBase }); assert.equal((await permitted.planner.plan(permitted.input)).fees.maxFeePerGasWei, '1');
  const zeroBoth = fixture({ rpc: zeroBase, feeRule: { maxPriorityFeePerGasWei: '0' } });
  await assert.rejects(zeroBoth.planner.plan(zeroBoth.input), /TASK_PLAN_FEE_CEILING_REFUSED/);
  const explicitZeroPriority = fixture({ feeRule: { maxPriorityFeePerGasWei: '0' } });
  assert.equal((await explicitZeroPriority.planner.plan(explicitZeroPriority.input)).fees.maxFeePerGasWei, '4');
});

test('planner requires sampled and pending balances to cover value plus maximum child fee',async()=>{
  for(const tag of ['0x2a','pending']) {
    const f=fixture({rpc:({method,params})=>method==='eth_getBalance' && params[1]===tag?'0x0':undefined});
    await assert.rejects(f.planner.plan(f.input),/TASK_EXACT_BALANCE_INSUFFICIENT/);
  }
});

