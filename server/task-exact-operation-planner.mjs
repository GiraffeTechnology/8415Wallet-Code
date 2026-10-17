import { verifyTaskExactChain, verifyTaskExactFunding } from './task-exact-chain-state.mjs';
/** Optional read-only proposal planner. No key, signer, store or broadcast port.
 * Server configuration only; HTTP input cannot provide a fee rule or provider.
 * Proposals never replace durable reserve/verify/CAS or the signer's live checks. */
import { createHash } from 'node:crypto';
import { normalizeTestAssetPins, testAssetPinForTask } from './task-test-asset-authorization.mjs';
import { readFileSync } from 'node:fs';
import { freezeTaskPolicy, freezeChildOperation, normalizeTaskBudget, assessChildScope } from '../src/agent/taskContract.ts';
import { encodeCall } from '../src/codec/abi.ts';
import { ControlledAccountClient } from '../src/controls/accounts.ts';
import { decodeControlSequence } from '../src/controls/client.ts';
import { controlHex, hashControlBytes, verifyControlDeployment } from '../src/controls/authorization.ts';
import { encodeTaskOperationCall } from './task-operation-encoding.mjs';
import { testSeriesMintRequest, verifyTestSeriesMintPreflight } from './task-test-mint-contract.mjs';

export const TASK_EXACT_PLANNER_RUNTIME_FILES = Object.freeze([
  'server/task-exact-chain-state.mjs', 'server/crypto.mjs', 'server/task-exact-operation-planner.mjs', 'server/task-operation-encoding.mjs', 'server/task-test-asset-authorization.mjs', 'server/task-test-mint-contract.mjs',
  'src/agent/taskContract.ts', 'src/codec/abi.ts', 'src/codec/keccak.ts',
  'src/controls/accounts.ts', 'src/controls/authorization.ts', 'src/controls/client.ts', 'src/controls/execution.ts',
  'src/sdk/errors.ts', 'src/sdk/interfaceIds.ts', 'src/xiongan/address.ts',
]);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceDigest = `0x${sha(JSON.stringify(TASK_EXACT_PLANNER_RUNTIME_FILES.map(path => ({ path,
  sha256: sha(readFileSync(new URL(`../${path}`, import.meta.url))) }))))}`;
export class TaskExactPlannerError extends Error {
  constructor(code) { super(code); this.name = 'TaskExactPlannerError'; this.code = code; }
}
const check = (ok, code) => { if (!ok) throw new TaskExactPlannerError(code); };
function fields(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'TASK_PLAN_SCHEMA_REFUSED');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).length === keys.length && keys.every(k =>
    Object.hasOwn(descriptors, k) && Object.hasOwn(descriptors[k], 'value')), 'TASK_PLAN_SCHEMA_REFUSED');
}
const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); };
const uint = value => { check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n, 'TASK_PLAN_INTEGER_REFUSED'); return BigInt(value); };
const quantity = value => { check(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) && value.length <= 66, 'TASK_PLAN_RPC_QUANTITY_REFUSED'); return BigInt(value); };
const identifier = value => { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'TASK_PLAN_ID_REFUSED'); return value; };
const hash = value => { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'TASK_PLAN_HASH_REFUSED'); return value; };
const hex = value => `0x${BigInt(value).toString(16)}`;
const minimum = (...values) => values.reduce((a, b) => a < b ? a : b);
const ceiling = (n, d) => (n + d - 1n) / d;
const pin = (p, chainId) => ({ controller: p.contract, runtimeCodeHash: p.runtimeCodeHash, chainId: BigInt(chainId) });
const READ_METHODS = new Set(['eth_chainId', 'eth_getTransactionCount', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_getBalance']);

/** Exposed for independent boundary tests and reuse by trusted read-only code.
 * No forwarding escape hatch; injected provider code itself remains trusted. */
export function createTaskPlannerReadProvider(provider) {
  check(provider && typeof provider.request === 'function', 'TASK_PLAN_CONFIG_REQUIRED');
  const request = provider.request.bind(provider);
  return Object.freeze({ async request({ method, params = [] }) {
    check(READ_METHODS.has(method), 'TASK_PLAN_RPC_WRITE_REFUSED');
    try { return structuredClone(await request({ method, params: structuredClone(params) })); }
    catch { throw new TaskExactPlannerError('TASK_PLAN_RPC_FAILED'); }
  } });
}

/** All quantities are canonical decimal strings. No gas/fee/lifetime defaults.
 * sampleBlock selects a canonical header; identity/code reads are pinned to its
 * numeric height and checked again for reorgs. Nonce and exact simulation use
 * pending state, explicitly selected by simulationBlock. No silent fallback. */
export function normalizeTaskExactFeeRule(input) {
  fields(input, ['schema', 'ruleId', 'ruleVersion', 'sampleBlock', 'simulationBlock', 'gasPaddingBps', 'gasLimitCeiling',
    'baseFeeMultiplierBps', 'maxPriorityFeePerGasWei', 'maxFeePerGasWeiCeiling', 'maxChildLifetimeSeconds']);
  check(input.schema === '8415-task-exact-fee-rule/1' && ['latest', 'safe', 'finalized'].includes(input.sampleBlock) &&
    input.simulationBlock === 'pending', 'TASK_PLAN_FEE_RULE_REFUSED');
  const rule = { schema: input.schema, ruleId: identifier(input.ruleId), ruleVersion: identifier(input.ruleVersion),
    sampleBlock: input.sampleBlock, simulationBlock: input.simulationBlock,
    gasPaddingBps: uint(input.gasPaddingBps).toString(), gasLimitCeiling: uint(input.gasLimitCeiling).toString(),
    baseFeeMultiplierBps: uint(input.baseFeeMultiplierBps).toString(), maxPriorityFeePerGasWei: uint(input.maxPriorityFeePerGasWei).toString(),
    maxFeePerGasWeiCeiling: uint(input.maxFeePerGasWeiCeiling).toString(), maxChildLifetimeSeconds: uint(input.maxChildLifetimeSeconds).toString() };
  check(BigInt(rule.gasPaddingBps) >= 10000n && BigInt(rule.gasLimitCeiling) > 0n && BigInt(rule.baseFeeMultiplierBps) >= 10000n &&
    BigInt(rule.maxFeePerGasWeiCeiling) > 0n && BigInt(rule.maxPriorityFeePerGasWei) <= BigInt(rule.maxFeePerGasWeiCeiling) &&
    BigInt(rule.maxChildLifetimeSeconds) > 0n, 'TASK_PLAN_FEE_RULE_REFUSED');
  return freeze(rule);
}

export function createTaskExactOperationPlanner({ provider, feeRule, testAssetPins = [], now = Date.now }) {
  const pins = normalizeTestAssetPins(testAssetPins);
  check(typeof now === 'function', 'TASK_PLAN_CONFIG_REQUIRED');
  const rule = normalizeTaskExactFeeRule(feeRule), readonlyProvider = createTaskPlannerReadProvider(provider);
  const rpc = (method, params = []) => readonlyProvider.request({ method, params });
  const identity = freeze({ schema: '8415-task-planner/1', plannerId: '8415wallet:exact-operation-planner', plannerVersion: '1',
    implementationDigest: `0x${sha(JSON.stringify({ sourceDigest, feeRule: rule, testAssetPins: pins }))}` });
  function seconds() { const time = now(); check(Number.isSafeInteger(time) && time >= 0, 'TASK_PLAN_CLOCK_REFUSED'); return BigInt(Math.floor(time / 1000)); }
  async function plan(input) {
    fields(input, ['task', 'budget', 'executor', 'grantPolicyVersion']);
    const task = freezeTaskPolicy(input.task.policy), budget = normalizeTaskBudget(input.budget);
    check(task.digest === input.task.digest && budget.taskDigest === task.digest, 'TASK_PLAN_BINDING_REFUSED');
    fields(input.executor, ['identity', 'digest']);
    const e = input.executor.identity;
    fields(e, ['schema', 'agentId', 'agentVersion', 'adapterId', 'adapterVersion', 'implementationDigest']);
    const executor = { schema: e.schema, agentId: identifier(e.agentId), agentVersion: identifier(e.agentVersion),
      adapterId: identifier(e.adapterId), adapterVersion: identifier(e.adapterVersion), implementationDigest: hash(e.implementationDigest) };
    check(executor.schema === '8415-task-executor/1' && input.executor.digest === `0x${sha(JSON.stringify(executor))}`, 'TASK_PLAN_EXECUTOR_BINDING_REFUSED');
    const executorDigest = input.executor.digest, grantPolicyVersion = uint(input.grantPolicyVersion).toString();
    check(task.policy.intent.kind === 'exact-operation', 'TASK_ATOMIC_SALE_VERIFIER_NOT_CONNECTED');
    check(BigInt(budget.revision) < (1n << 256n) - 1n, 'TASK_PLAN_BUDGET_REVISION_EXHAUSTED');
    // Complete logical history, including tombstones. Neither a timeout nor a
    // stale head frees a reserved/submitted/unknown exact-operation quota.
    if (budget.reservations.some(r => r.status !== 'cancelled')) return null;
    const startedAt = seconds();
    const expiresAt = minimum(BigInt(task.policy.expiresAt), startedAt + 900n, startedAt + BigInt(rule.maxChildLifetimeSeconds));
    check(expiresAt > startedAt, 'TASK_PLAN_EXPIRED');
    const op = task.policy.intent.operation;
    check(quantity(await rpc('eth_chainId')) === BigInt(op.chainId), 'TASK_PLAN_CHAIN_MISMATCH');
    await verifyTaskExactChain(readonlyProvider, op.chainId);
    const nonce = quantity(await rpc('eth_getTransactionCount', [op.actor, 'pending']));
    check(nonce <= BigInt(Number.MAX_SAFE_INTEGER), 'TASK_PLAN_NONCE_REFUSED');
    const header = await rpc('eth_getBlockByNumber', [rule.sampleBlock, false]);
    check(header && typeof header === 'object', 'TASK_PLAN_HEADER_REQUIRED');
    const block = hex(quantity(header.number)), blockHash = hash(header.hash), blockGas = quantity(header.gasLimit), baseFee = quantity(header.baseFeePerGas);
    check(blockGas > 0n, 'TASK_PLAN_GAS_LIMIT_REFUSED');
    const priority = BigInt(rule.maxPriorityFeePerGasWei), maxFee = ceiling(baseFee * BigInt(rule.baseFeeMultiplierBps), 10000n) + priority;
    check(maxFee > 0n && maxFee < 1n << 256n && maxFee <= BigInt(rule.maxFeePerGasWeiCeiling) && priority <= maxFee, 'TASK_PLAN_FEE_CEILING_REFUSED');
    const spent = budget.reservations.reduce((sum, r) => sum + (r.status === 'cancelled' ? 0n : BigInt(r.feeWei)), 0n);
    const remaining = BigInt(task.policy.fees.totalWei) - spent;
    const feeBudget = minimum(BigInt(task.policy.fees.perOperationWei), remaining);
    const gasCap = minimum(BigInt(rule.gasLimitCeiling), blockGas, feeBudget / maxFee);
    check(feeBudget > 0n && gasCap > 0n, 'TASK_PLAN_FEE_BUDGET_EXHAUSTED');
    // Adapt the existing pinned readers' latest requests to this one sampled
    // height, without granting access to their submission methods.
    const pinned = Object.freeze({ request({ method, params = [] }) {
      const copied = structuredClone(params);
      if (['eth_getCode', 'eth_call'].includes(method)) {
        check(copied[1] === 'latest', 'TASK_PLAN_SAMPLE_REFUSED'); copied[1] = block;
      }
      return rpc(method, copied);
    } });
    check(await rpc('eth_getCode', [op.actor, block]) === '0x', 'TASK_PLAN_EOA_ACTOR_REQUIRED');
    const testPin = testAssetPinForTask(pins, task);
    if (testPin) check(hashControlBytes(await rpc('eth_getCode', [testPin.contract, block])) === testPin.runtimeCodeHash, 'TASK_PLAN_TEST_ASSET_CODE_REFUSED');
    if ('controller' in op) await verifyControlDeployment(pinned, pin(op.controller, op.chainId));
    if ('token' in op) await verifyControlDeployment(pinned, pin(op.token, op.chainId));
    const account = ['deposit', 'standalone-withdraw'].includes(op.kind)
      ? await new ControlledAccountClient(pinned, pin(op.controller, op.chainId)).account(op.actor) : null;
    if (['deposit', 'standalone-withdraw'].includes(op.kind)) check(account !== null, 'TASK_PLAN_ACCOUNT_REQUIRED');
    const encoded = encodeTaskOperationCall(op, account?.account ?? null);
    if (op.kind === 'native-transfer') check(await rpc('eth_getCode', [op.recipient, block]) === '0x', 'TASK_PLAN_NATIVE_EOA_REQUIRED');
    else { const code = await rpc('eth_getCode', [encoded.to, block]); check(controlHex(code) && code !== '0x', 'TASK_PLAN_TARGET_CODE_REQUIRED'); }
    if (op.kind === 'complete' || op.kind === 'return-hop') {
      const sequence = decodeControlSequence(await rpc('eth_call', [{ to: op.controller.contract,
        data: encodeCall('sequence(bytes32)', ['bytes32'], [op.sequenceId]) }, block]));
      check(sequence.token === op.token.contract && sequence.tokenCodeHash === op.token.runtimeCodeHash &&
        sequence.revision === BigInt(op.expectedRevision), 'TASK_PLAN_SEQUENCE_BINDING_REFUSED');
    }
    if (op.kind === 'artfi-test-series-mint') await verifyTestSeriesMintPreflight({
      request: testSeriesMintRequest(op), provider: readonlyProvider, snapshotBlock: block,
      allowedWallets: [op.actor, op.distributionWallet] });
    const transaction = { from: op.actor, to: encoded.to, data: encoded.data, value: hex(encoded.value), chainId: hex(op.chainId),
      nonce: hex(nonce), type: '0x2', gas: hex(gasCap), maxFeePerGas: hex(maxFee), maxPriorityFeePerGas: hex(priority), accessList: [] };
    const estimate = quantity(await rpc('eth_estimateGas', [transaction, rule.simulationBlock]));
    check(estimate > 0n, 'TASK_PLAN_ESTIMATE_REFUSED');
    const gasLimit = ceiling(estimate * BigInt(rule.gasPaddingBps), 10000n);
    check(gasLimit <= gasCap && gasLimit * maxFee <= feeBudget, 'TASK_PLAN_GAS_BUDGET_REFUSED');
    await verifyTaskExactFunding(readonlyProvider, { actor: op.actor, valueWei: encoded.value,
      gasLimit: gasLimit.toString(), maxFeePerGasWei: maxFee.toString(), block });
    const exact = { ...transaction, gas: hex(gasLimit) };
    const finalEstimate = quantity(await rpc('eth_estimateGas', [exact, rule.simulationBlock]));
    check(finalEstimate > 0n && finalEstimate <= gasLimit, 'TASK_PLAN_ESTIMATE_CHANGED');
    const simulation = await rpc('eth_call', [exact, rule.simulationBlock]);
    check(controlHex(simulation), 'TASK_PLAN_SIMULATION_REFUSED');
    if (op.kind === 'erc20-transfer') check(simulation === '0x' || simulation === `0x${'0'.repeat(63)}1`, 'TASK_PLAN_ERC20_RETURN_REFUSED');
    check(quantity(await rpc('eth_getTransactionCount', [op.actor, 'pending'])) === nonce, 'TASK_PLAN_NONCE_MISMATCH');
    const canonical = await rpc('eth_getBlockByNumber', [block, false]);
    check(canonical && hex(quantity(canonical.number)) === block && canonical.hash === blockHash, 'TASK_PLAN_SAMPLE_REORGED');
    check(quantity(await rpc('eth_chainId')) === BigInt(op.chainId), 'TASK_PLAN_CHAIN_MISMATCH');
    await verifyTaskExactFunding(readonlyProvider, { actor: op.actor, valueWei: encoded.value,
      gasLimit: gasLimit.toString(), maxFeePerGasWei: maxFee.toString() });
    await verifyTaskExactChain(readonlyProvider, op.chainId);
    const proposal = { schema: '8415-agent-child/1', taskDigest: task.digest, operation: op, nonce: nonce.toString(), expiresAt: expiresAt.toString(),
      wire: { to: encoded.to, calldataHash: hashControlBytes(encoded.data), valueWei: encoded.value },
      fees: { gasLimit: gasLimit.toString(), maxFeePerGasWei: maxFee.toString() }, market: null };
    const operationId = `plan:${sha(JSON.stringify({ taskDigest: task.digest, budgetRevision: budget.revision, executorDigest,
      grantPolicyVersion, planner: identity, proposal }))}`;
    check(!budget.reservations.some(r => r.operationId === operationId), 'TASK_PLAN_OPERATION_TOMBSTONED');
    const frozen = freezeChildOperation({ ...proposal, operationId });
    check(assessChildScope(task, frozen, seconds()).state !== 'outside-declared-scope', 'TASK_PLAN_SCOPE_REFUSED');
    return frozen.child;
  }
  return Object.freeze({ identity, plan });
}


