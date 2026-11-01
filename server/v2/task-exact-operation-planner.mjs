/** V2 ordinary-operation runtime. Linked responsibility operations are unsupported. */
import { normalizeTestNFT721Bindings, verifyTestNFT721OperationPreflight, readTestNFT721OperationResult } from '../task-test-nft721-binding.mjs';
import { captureTestNFT721MetadataVerifier } from '../task-test-nft721-metadata.mjs';
import { verifyTaskExactChain, verifyTaskExactFunding } from '../task-exact-chain-state.mjs';
/** Optional read-only proposal planner. No key, signer, store or broadcast port.
 * Server configuration only; HTTP input cannot provide a fee rule or provider.
 * Proposals never replace durable reserve/verify/CAS or the signer's live checks. */
import { createHash } from 'node:crypto';
import { normalizeTestAssetPins, testAssetPinForTask } from '../task-test-asset-authorization.mjs';
import { readFileSync } from 'node:fs';
import { freezeTaskPolicy, freezeChildOperation, normalizeTaskBudget, assessChildScope } from '../../src/agent/taskContract.ts';
import { ControlledAccountClient } from '../../src/standalone/accounts.ts';
import { controlHex, hashControlBytes, verifyControlDeployment } from '../../src/standalone/authorization.ts';
import { encodeTaskOperationCall, assertV2TaskOperation } from './task-operation-encoding.mjs';
import { testSeriesMintRequest, verifyTestSeriesMintPreflight } from '../task-test-mint-contract.mjs';

export const TASK_EXACT_PLANNER_RUNTIME_FILES = Object.freeze([
  "server/account-directory.mjs",
  "server/auth-service-core.mjs",
  "server/ca-bindings.mjs",
  "server/ca-verifier.mjs",
  "server/config-validation.mjs",
  "server/configuration-transition.mjs",
  "server/crypto.mjs",
  "server/erc721-log-discovery.mjs",
  "server/funds-service.mjs",
  "server/login-identifier.mjs",
  "server/mail-config.mjs",
  "server/mail-otp.mjs",
  "server/method-change-service.mjs",
  "server/native-wallet-login.mjs",
  "server/nft-inventory-reader.mjs",
  "server/nft-inventory-service.mjs",
  "server/origin-continuation-context.mjs",
  "server/origin-continuation.mjs",
  "server/origin-realm-router.mjs",
  "server/origin-transition-state.mjs",
  "server/owner-change-origin.mjs",
  "server/receipt-operation-encoding.mjs",
  "server/receipt-principal-grant.mjs",
  "server/recovery-service.mjs",
  "server/registration-service.mjs",
  "server/rpc-funds-reader.mjs",
  "server/runtime-entry-core.mjs",
  "server/socket-path.mjs",
  "server/store-state-generation.mjs",
  "server/store.mjs",
  "server/task-asset-control-catalog.mjs",
  "server/task-asset-control-policy.mjs",
  "server/task-asset-control-state.mjs",
  "server/task-authorization.mjs",
  "server/task-background-runner.mjs",
  "server/task-exact-bootstrap.mjs",
  "server/task-exact-chain-state.mjs",
  "server/task-exact-config.mjs",
  "server/task-exact-sign-only.mjs",
  "server/task-journal-capabilities.mjs",
  "server/task-listing-bootstrap-core.mjs",
  "server/task-listing-config.mjs",
  "server/task-listing-observation-consumer.mjs",
  "server/task-listing-results.mjs",
  "server/task-listing-runtime.mjs",
  "server/task-listing-transport.mjs",
  "server/task-native-listing-composition.mjs",
  "server/task-observation-sources.mjs",
  "server/task-operation-verification.mjs",
  "server/task-runtime-composition.mjs",
  "server/task-test-asset-authorization.mjs",
  "server/task-test-mint-contract.mjs",
  "server/task-test-nft721-binding.mjs",
  "server/task-test-nft721-contract.mjs",
  "server/task-test-nft721-metadata.mjs",
  "server/task-verification-execution.mjs",
  "server/task-verification-policy.mjs",
  "server/task-verification-state.mjs",
  "server/v2/auth-service.mjs",
  "server/v2/listing-binding.mjs",
  "server/v2/main.mjs",
  "server/v2/runtime-entry.mjs",
  "server/v2/task-exact-operation-planner.mjs",
  "server/v2/task-exact-runtime.mjs",
  "server/v2/task-exact-signer-adapter.mjs",
  "server/v2/task-listing-installed.mjs",
  "server/v2/task-operation-encoding.mjs",
  "server/v2/task-receipt-adapter.mjs",
  "server/wallet-bindings.mjs",
  "server/wallet-read-runtime.mjs",
  "src/agent/receiptObservation.ts",
  "src/agent/receiptPrincipal.ts",
  "src/agent/receiptTask.ts",
  "src/agent/taskContract.ts",
  "src/codec/abi.ts",
  "src/codec/keccak.ts",
  "src/sdk/errors.ts",
  "src/sdk/interfaceIds.ts",
  "src/standalone/accounts.ts",
  "src/standalone/authorization.ts",
  "src/standalone/client.ts",
  "src/standalone/execution.ts",
  "src/wallet/currencyFunds.ts",
  "src/xiongan/address.ts",
  "src/xiongan/externalAssets.ts",
  "web/account-auth.mjs",
  "web/authorization-context.mjs",
  "web/coordination-view.mjs",
  "web/forward-progress-client.mjs",
  "web/funds-client.mjs",
  "web/login-core.mjs",
  "web/native-login-challenge.mjs",
  "web/nft-details-client.mjs",
  "web/nft-inventory-client.mjs",
  "web/task-listing-results.mjs",
  "web/task-observer-context.mjs",
  "web/tenant-path.mjs",
  "web/wallet-entry.mjs"
]);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceDigest = `0x${sha(JSON.stringify(TASK_EXACT_PLANNER_RUNTIME_FILES.map(path => ({ path,
  sha256: sha(readFileSync(new URL(`../../${path}`, import.meta.url))) }))))}`;
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

export function createTaskExactOperationPlanner({ provider, feeRule, testAssetPins = [], testMint721Bindings = [], testNFT721Metadata = null, now = Date.now }) {
  const pins = normalizeTestAssetPins(testAssetPins);
  const mint721Bindings=normalizeTestNFT721Bindings(testMint721Bindings), metadata=captureTestNFT721MetadataVerifier(testNFT721Metadata);
  check(typeof now === 'function', 'TASK_PLAN_CONFIG_REQUIRED');
  const rule = normalizeTaskExactFeeRule(feeRule), readonlyProvider = createTaskPlannerReadProvider(provider);
  const rpc = (method, params = []) => readonlyProvider.request({ method, params });
  const identity = freeze({ schema: '8415-task-planner/1', plannerId: '8415wallet:exact-operation-planner', plannerVersion: '1',
    implementationDigest: `0x${sha(JSON.stringify({ sourceDigest, feeRule: rule, testAssetPins: pins, mint721Bindings, metadataIdentity: metadata?.identity ?? null }))}` });
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
    const op = task.policy.intent.operation;
    assertV2TaskOperation(op);
    check(BigInt(budget.revision) < (1n << 256n) - 1n, 'TASK_PLAN_BUDGET_REVISION_EXHAUSTED');
    // Complete logical history, including tombstones. Neither a timeout nor a
    // stale head frees a reserved/submitted/unknown exact-operation quota.
    if (budget.reservations.some(r => r.status !== 'cancelled')) return null;
    const startedAt = seconds();
    const expiresAt = minimum(BigInt(task.policy.expiresAt), startedAt + 900n, startedAt + BigInt(rule.maxChildLifetimeSeconds));
    check(expiresAt > startedAt, 'TASK_PLAN_EXPIRED');
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
    if (op.kind === 'artfi-test-series-mint') await verifyTestSeriesMintPreflight({
      request: testSeriesMintRequest(op), provider: readonlyProvider, snapshotBlock: block,
      allowedWallets: [op.actor, op.distributionWallet] });
    if(op.kind==='artfi-test-nft721-mint') {
      check(metadata!==null,'TASK_TEST_721_METADATA_NOT_ADMITTED');await metadata.verify(op);
      await verifyTestNFT721OperationPreflight({operation:op,bindings:mint721Bindings,provider:readonlyProvider,snapshotBlock:block});
    }
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



