/** Reused synthetic fixture only; V2-specific checks below. No network or real accounts. */
/** All RPC responses are synthetic in-process fixtures. No network or keys. */
import test from 'node:test';

import assert from 'node:assert/strict';

import { createTaskExactOperationPlanner, createTaskPlannerReadProvider, normalizeTaskExactFeeRule } from '../server/v2/task-exact-operation-planner.mjs';

import { createTaskExactSignerAdapter } from '../server/v2/task-exact-signer-adapter.mjs';

import { encodeTaskOperationCall, encodeExactTaskOperation } from '../server/v2/task-operation-encoding.mjs';

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


const invalidRules = {
  missing: undefined, unversioned: { ...rule, ruleVersion: '' }, schema: { ...rule, schema: 'other' },
  implicitSample: { ...rule, sampleBlock: undefined }, pendingHeader: { ...rule, sampleBlock: 'pending' }, arbitraryHeader: { ...rule, sampleBlock: '0x1' },
  implicitSimulation: { ...rule, simulationBlock: undefined }, latestSimulation: { ...rule, simulationBlock: 'latest' },
  gasPadding: { ...rule, gasPaddingBps: '9999' }, gasZero: { ...rule, gasLimitCeiling: '0' }, baseMultiplier: { ...rule, baseFeeMultiplierBps: '9999' },
  priorityAboveFee: { ...rule, maxPriorityFeePerGasWei: '101' }, negative: { ...rule, maxPriorityFeePerGasWei: '-1' },
  decimal: { ...rule, gasPaddingBps: '1.2' }, number: { ...rule, gasLimitCeiling: 1000000 }, unsafe: { ...rule, gasLimitCeiling: (1n << 256n).toString() },
  lifetimeZero: { ...rule, maxChildLifetimeSeconds: '0' }, extra: { ...rule, walletSuggestedFee: '5' },
};


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


function signer(f, plannerFeeRule = null) {
  const unused = () => { assert.fail('planning must never invoke signer or store'); };
  return createTaskExactSignerAdapter({ provider: f.provider, externalSigner: { signExactTransaction: unused },
    signerIdentity: { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: sequenceId },
    store: { readMany: unused, transactionMany: unused, withReadSnapshot: unused }, maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1',
    plannerFeeRule, now: () => f.state.now });
}
for(const operation of operations.filter(x=>!['complete','return-hop'].includes(x.kind)))test(`V2 planner ${operation.kind} preserves exact encoding, nonce, fees and scope`,async()=>{
 const f=fixture({operation}),proposal=await f.planner.plan(f.input),child=freezeChildOperation(proposal);
 assert.deepEqual(encodeExactTaskOperation(child,account),encodeTaskOperationCall(f.task.policy.intent.operation,account));
 assert.equal(proposal.nonce,'7');assert.deepEqual(proposal.fees,{gasLimit:'25200',maxFeePerGasWei:'5'});assert.equal(proposal.market,null);
 assert.equal(assessChildScope(f.task,child,BigInt(epoch/1000)).state,'requires-trusted-verification');
});
test('V2 planner refuses linked operations before any provider call',async()=>{
 for(const operation of operations.filter(x=>['complete','return-hop'].includes(x.kind))){const f=fixture({operation});await assert.rejects(f.planner.plan(f.input),/TASK_V2_OPERATION_NOT_SUPPORTED/);assert.deepEqual(f.state.requests,[]);}
});
test('V2 planner keeps UNKNOWN reservation and makes no RPC or replacement proposal',async()=>{
 const f=fixture();const child=freezeChildOperation(await f.planner.plan(f.input));const r=reserveTaskBudget(f.task,child,f.input.budget,'0',BigInt(epoch/1000));
 const budget=structuredClone(r);budget.reservations[0].status='outcome-unknown';f.state.requests.length=0;
 assert.equal(await f.planner.plan({...f.input,budget}),null);assert.deepEqual(f.state.requests,[]);
});
