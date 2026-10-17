import { verifyTaskExactChain, verifyTaskExactFunding } from './task-exact-chain-state.mjs';
/** Optional server-owned sign-only injection. No credential loading, key storage,
 * default signer, eth_sendTransaction, signer-side filling, or recovery resend. */
import { createHash } from 'node:crypto';
import { normalizeTestAssetPins, testAssetPinForTask } from './task-test-asset-authorization.mjs';
import { readFileSync } from 'node:fs';
import { Transaction, version as ethersVersion } from 'ethers';
import { freezeTaskPolicy, freezeChildOperation, assessChildScope } from '../src/agent/taskContract.ts';
import { encodeCall } from '../src/codec/abi.ts';
import { hashControlBytes, controlHex, verifyControlDeployment } from '../src/controls/authorization.ts';
import { ControlledAccountClient } from '../src/controls/accounts.ts';
import { decodeControlSequence } from '../src/controls/client.ts';
import { encodeExactTaskOperation } from './task-operation-encoding.mjs';
import { createTaskExactOperationPlanner, normalizeTaskExactFeeRule } from './task-exact-operation-planner.mjs';
import { testSeriesMintRequest, verifyTestSeriesMintPreflight } from './task-test-mint-contract.mjs';

export const TASK_EXACT_SIGNER_RUNTIME_FILES = Object.freeze([
  // Approval selection, channel isolation, and the shared-store constructor
  // affect this port's trusted runtime; UI/build/test code does not.
  'server/task-authorization.mjs', 'server/task-runtime-composition.mjs', 'server/task-exact-runtime.mjs',
  'server/task-exact-chain-state.mjs', 'server/crypto.mjs', 'server/task-listing-transport.mjs',
  'server/task-exact-bootstrap.mjs', 'server/task-exact-config.mjs', 'server/task-exact-sign-only.mjs',
  'server/task-test-asset-authorization.mjs', 'server/task-test-mint-contract.mjs', 'server/task-exact-signer-adapter.mjs', 'server/task-operation-encoding.mjs', 'server/task-exact-operation-planner.mjs',
  'src/agent/taskContract.ts', 'src/codec/abi.ts', 'src/codec/keccak.ts',
  'src/controls/accounts.ts', 'src/controls/authorization.ts', 'src/controls/client.ts', 'src/controls/execution.ts',
  'src/sdk/errors.ts', 'src/sdk/interfaceIds.ts', 'src/xiongan/address.ts',
]);
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceDigest = `0x${sha(JSON.stringify(TASK_EXACT_SIGNER_RUNTIME_FILES.map(path => ({ path,
  sha256: sha(readFileSync(new URL(`../${path}`, import.meta.url))) }))))}`;
export class TaskExactSignerError extends Error {
  constructor(code) { super(code); this.name = 'TaskExactSignerError'; this.code = code; }
}
const check = (ok, code) => { if (!ok) throw new TaskExactSignerError(code); };
function fields(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'TASK_EXACT_SCHEMA_REFUSED');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(descriptors).length === keys.length && keys.every(k =>
    Object.hasOwn(descriptors, k) && Object.hasOwn(descriptors[k], 'value')), 'TASK_EXACT_SCHEMA_REFUSED');
}
const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); };
const uint = value => { check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n, 'TASK_EXACT_INTEGER_REFUSED'); return BigInt(value); };
const quantity = value => { check(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) && value.length <= 66, 'TASK_EXACT_RPC_QUANTITY_REFUSED'); return BigInt(value); };
const identifier = value => { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'TASK_EXACT_ID_REFUSED'); return value; };
const hash = value => { check(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value), 'TASK_EXACT_HASH_REFUSED'); return value; };
const hex = value => `0x${BigInt(value).toString(16)}`;
const key = (kind, values) => `task-${kind}:${sha(JSON.stringify(values))}`;
const pin = (p, chainId) => ({ controller: p.contract, runtimeCodeHash: p.runtimeCodeHash, chainId: BigInt(chainId) });
const READ_METHODS = new Set(['eth_chainId', 'eth_getTransactionCount', 'eth_getCode', 'eth_call', 'eth_getTransactionByHash', 'eth_getBlockByNumber', 'eth_getBalance']);

/** ExternalExactSigner.signExactTransaction({requestId, unsignedSerialized,
 * unsignedDigest, binding}) -> signedSerialized. The injected implementation
 * must be sign-only and must not fill nonce/fees, broadcast or retain raw bytes.
 * This interface cannot sandbox a dishonest signer; its custody/integration
 * and metadata require independent review. No external implementation ships.
 *
 * maxPriorityFeePerGasWei is explicit server policy, bounded by each child's
 * exact maxFee. Policy and external signer provenance bind the executor digest.
 */
export function createTaskExactSignerAdapter({ provider, externalSigner, signerIdentity, store,
  maxPriorityFeePerGasWei, agentId, agentVersion, plannerFeeRule = null, testAssetPins = [], now = Date.now }) {
  const pins = normalizeTestAssetPins(testAssetPins);
  check(provider && typeof provider.request === 'function' && externalSigner && typeof externalSigner.signExactTransaction === 'function' &&
    store && typeof store.readMany === 'function' && typeof store.transactionMany === 'function' &&
    typeof store.withReadSnapshot === 'function' && typeof now === 'function', 'TASK_EXACT_CONFIG_REQUIRED');
  fields(signerIdentity, ['signerId', 'signerVersion', 'implementationDigest']);
  const signer = freeze({ signerId: identifier(signerIdentity.signerId), signerVersion: identifier(signerIdentity.signerVersion),
    implementationDigest: hash(signerIdentity.implementationDigest) });
  const priority = uint(maxPriorityFeePerGasWei);
  const planningRule = plannerFeeRule === null ? null : normalizeTaskExactFeeRule(plannerFeeRule);
  check(planningRule === null || planningRule.maxPriorityFeePerGasWei === maxPriorityFeePerGasWei, 'TASK_EXACT_PLANNER_PRIORITY_MISMATCH');
  const planner = planningRule === null ? null : createTaskExactOperationPlanner({ provider, feeRule: planningRule, testAssetPins: pins, now });
  const identity = freeze({ schema: '8415-task-executor/1', agentId: identifier(agentId), agentVersion: identifier(agentVersion),
    adapterId: '8415wallet:external-exact-signer', adapterVersion: '2',
    implementationDigest: `0x${sha(JSON.stringify({ sourceDigest, ethersVersion, signer, maxPriorityFeePerGasWei, testAssetPins: pins, planner: planner?.identity ?? null }))}` });
  const executorDigest = `0x${sha(JSON.stringify(identity))}`;
  // Capture all configured methods once. No endpoint, signer, fee policy or
  // account selection can be supplied by HTTP JSON or swapped after approval.
  const request = provider.request.bind(provider), sign = externalSigner.signExactTransaction.bind(externalSigner),
    readMany = store.readMany.bind(store), transact = store.transactionMany.bind(store), withReadSnapshot = store.withReadSnapshot.bind(store);
  const rpc = async (method, params = []) => {
    check(READ_METHODS.has(method), 'TASK_EXACT_RPC_WRITE_REFUSED');
    return structuredClone(await request({ method, params: structuredClone(params) }));
  };
  const readonlyProvider = Object.freeze({ request: ({ method, params = [] }) => rpc(method, params) });
  function seconds() { const time = now(); check(Number.isSafeInteger(time) && time >= 0, 'TASK_EXACT_CLOCK_REFUSED'); return BigInt(Math.floor(time / 1000)); }
  function context(input) {
    fields(input, ['task', 'child', 'executor', 'grantPolicyVersion']);
    const task = freezeTaskPolicy(input.task.policy), child = freezeChildOperation(input.child.child);
    check(task.digest === input.task.digest && child.digest === input.child.digest && child.child.taskDigest === task.digest &&
      input.executor?.digest === executorDigest && JSON.stringify(input.executor.identity) === JSON.stringify(identity), 'TASK_EXACT_BINDING_REFUSED');
    uint(input.grantPolicyVersion);
    check(task.policy.intent.kind === 'exact-operation', 'TASK_ATOMIC_SALE_VERIFIER_NOT_CONNECTED');
    check(task.policy.actor === child.child.operation.actor && task.policy.chainId === child.child.operation.chainId &&
      JSON.stringify(task.policy.intent.operation) === JSON.stringify(child.child.operation) && child.child.market === null, 'TASK_EXACT_BINDING_REFUSED');
    const binding = freeze({ taskDigest: task.digest, childDigest: child.digest, chainId: child.child.operation.chainId,
      actor: child.child.operation.actor, nonce: child.child.nonce, executorDigest, grantPolicyVersion: input.grantPolicyVersion });
    return { task, child, binding,
      okey: key('operation', [binding.chainId, binding.actor, child.child.operationId]),
      nkey: key('nonce', [binding.chainId, binding.actor, binding.nonce]) };
  }
  function activeScope(c) {
    const time = seconds();
    check(assessChildScope(c.task, c.child, time).state !== 'outside-declared-scope', 'TASK_EXACT_SCOPE_REFUSED');
    if (planningRule !== null) check(BigInt(c.child.child.fees.gasLimit) <= BigInt(planningRule.gasLimitCeiling) &&
      BigInt(c.child.child.fees.maxFeePerGasWei) <= BigInt(planningRule.maxFeePerGasWeiCeiling) &&
      BigInt(c.child.child.expiresAt) - time <= BigInt(planningRule.maxChildLifetimeSeconds), 'TASK_EXACT_PLANNER_RULE_REFUSED');
  }
  async function unsigned(c, live) {
    const child = c.child.child, op = child.operation;
    check(quantity(await rpc('eth_chainId')) === BigInt(op.chainId), 'TASK_EXACT_CHAIN_MISMATCH');
    const account = ['deposit', 'standalone-withdraw'].includes(op.kind)
      ? await new ControlledAccountClient(readonlyProvider, pin(op.controller, op.chainId)).account(op.actor) : null;
    if (['deposit', 'standalone-withdraw'].includes(op.kind)) check(account !== null, 'TASK_EXACT_ACCOUNT_REQUIRED');
    const encoded = encodeExactTaskOperation(c.child, account?.account ?? null);
    check(BigInt(child.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) && priority <= BigInt(child.fees.maxFeePerGasWei), 'TASK_EXACT_TRANSACTION_BOUNDS_REFUSED');
    const tx = Transaction.from({ type: 2, chainId: BigInt(op.chainId), nonce: Number(child.nonce), to: encoded.to,
      data: encoded.data, value: BigInt(encoded.value), gasLimit: BigInt(child.fees.gasLimit),
      maxFeePerGas: BigInt(child.fees.maxFeePerGasWei), maxPriorityFeePerGas: priority, accessList: [] });
    if (live) {
      activeScope(c);
      await verifyTaskExactChain(readonlyProvider, op.chainId);
      check(await rpc('eth_getCode', [op.actor, 'latest']) === '0x', 'TASK_EXACT_EOA_ACTOR_REQUIRED');
      if (op.kind === 'native-transfer') check(await rpc('eth_getCode', [op.recipient, 'latest']) === '0x', 'TASK_EXACT_NATIVE_EOA_REQUIRED');
      else { const code = await rpc('eth_getCode', [encoded.to, 'latest']); check(controlHex(code) && code !== '0x', 'TASK_EXACT_TARGET_CODE_REQUIRED'); }
      const testPin = testAssetPinForTask(pins, c.task);
      if (testPin) check(hashControlBytes(await rpc('eth_getCode', [testPin.contract, 'latest'])) === testPin.runtimeCodeHash, 'TASK_EXACT_TEST_ASSET_CODE_REFUSED');
      if ('controller' in op) await verifyControlDeployment(readonlyProvider, pin(op.controller, op.chainId));
      if ('token' in op) await verifyControlDeployment(readonlyProvider, pin(op.token, op.chainId));
      if (op.kind === 'complete' || op.kind === 'return-hop') {
        const sequence = decodeControlSequence(await rpc('eth_call', [{ to: op.controller.contract,
          data: encodeCall('sequence(bytes32)', ['bytes32'], [op.sequenceId]) }, 'latest']));
        check(sequence.token === op.token.contract && sequence.tokenCodeHash === op.token.runtimeCodeHash &&
          sequence.revision === BigInt(op.expectedRevision), 'TASK_EXACT_SEQUENCE_BINDING_REFUSED');
      }
      if (op.kind === 'artfi-test-series-mint') await verifyTestSeriesMintPreflight({
        request: testSeriesMintRequest(op), provider: readonlyProvider, allowedWallets: [op.actor, op.distributionWallet] });
      await verifyTaskExactFunding(readonlyProvider, { actor: op.actor, valueWei: tx.value.toString(),
        gasLimit: child.fees.gasLimit, maxFeePerGasWei: child.fees.maxFeePerGasWei });
      check(quantity(await rpc('eth_getTransactionCount', [op.actor, 'pending'])) === BigInt(child.nonce), 'TASK_EXACT_NONCE_MISMATCH');
      const simulation = await rpc('eth_call', [{ from: op.actor, to: tx.to, data: tx.data, value: hex(tx.value),
        chainId: hex(tx.chainId), nonce: hex(tx.nonce), type: '0x2', gas: hex(tx.gasLimit),
        maxFeePerGas: hex(tx.maxFeePerGas), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas) }, 'pending']);
      check(controlHex(simulation), 'TASK_EXACT_SIMULATION_REFUSED');
      if (op.kind === 'erc20-transfer') check(simulation === '0x' || simulation === `0x${'0'.repeat(63)}1`, 'TASK_EXACT_ERC20_RETURN_REFUSED');
      check(quantity(await rpc('eth_getTransactionCount', [op.actor, 'pending'])) === BigInt(child.nonce), 'TASK_EXACT_NONCE_MISMATCH');
    }
    check(quantity(await rpc('eth_chainId')) === BigInt(op.chainId), 'TASK_EXACT_CHAIN_MISMATCH');
    return tx;
  }
  function signedTransaction(serialized, expected, actor) {
    check(typeof serialized === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(serialized) && serialized.length <= 8192, 'TASK_EXACT_SIGNATURE_REFUSED');
    try {
      const tx = Transaction.from(serialized);
      check(tx.isSigned() && tx.isValid() && tx.from?.toLowerCase() === actor, 'TASK_EXACT_SIGNATURE_REFUSED');
      check(tx.serialized === serialized.toLowerCase() && tx.unsignedSerialized === expected.unsignedSerialized &&
        tx.unsignedHash === expected.unsignedHash && tx.type === 2 && tx.chainId === expected.chainId && tx.to === expected.to &&
        tx.data === expected.data && tx.value === expected.value && tx.nonce === expected.nonce && tx.gasLimit === expected.gasLimit &&
        tx.maxFeePerGas === expected.maxFeePerGas && tx.maxPriorityFeePerGas === expected.maxPriorityFeePerGas &&
        tx.gasPrice === null && tx.accessList.length === 0, 'TASK_EXACT_SIGNED_FIELDS_MISMATCH');
      hash(tx.hash); return tx;
    } catch (error) { if (error instanceof TaskExactSignerError) throw error; throw new TaskExactSignerError('TASK_EXACT_SIGNATURE_REFUSED'); }
  }
  async function journalKeys(c) {
    const first = await readMany([c.okey]); const operation = first[c.okey];
    check(operation?.schema === '8415-task-operation/1' && typeof operation.grantKey === 'string', 'TASK_EXACT_ATTEMPT_REQUIRED');
    const gkey = operation.grantKey, g = (await readMany([gkey]))[gkey];
    let principal; try { principal = JSON.parse(g?.principal); } catch { check(false, 'TASK_EXACT_JOURNAL_REFUSED'); }
    check(Array.isArray(principal) && principal.length === 5 && principal[0] === c.task.policy.origin && principal[1] === c.task.policy.tenant &&
      typeof principal[2] === 'string' && principal[3] === c.binding.actor && principal[4] === c.binding.chainId, 'TASK_EXACT_JOURNAL_REFUSED');
    return { gkey, ckey: `${principal[1]}:${principal[2]}`, keys: [c.okey, c.nkey, gkey, `${principal[1]}:${principal[2]}`] };
  }
  function journal(c, j, values, active) {
    const op = values[c.okey], nonce = values[c.nkey], grant = values[j.gkey];
    check(op?.schema === '8415-task-operation/1' && op.grantKey === j.gkey && op.child?.digest === c.child.digest &&
      freezeChildOperation(op.child.child).digest === c.child.digest && op.nonceKey === c.nkey &&
      ['outcome-unknown', 'submitted'].includes(op.status) && op.attemptExecutor?.digest === executorDigest &&
      op.attemptGrantPolicyVersion === c.binding.grantPolicyVersion && nonce?.permanent === true && nonce.operationKey === c.okey &&
      nonce.taskDigest === c.task.digest && nonce.childDigest === c.child.digest && grant?.task?.digest === c.task.digest &&
      freezeTaskPolicy(grant.task.policy).digest === c.task.digest, 'TASK_EXACT_ATTEMPT_REQUIRED');
    if (active) {
      activeScope(c);
      check(op.status === 'outcome-unknown' && grant.status === 'authorized' && grant.grantPolicyVersion === c.binding.grantPolicyVersion &&
        grant.executor?.digest === executorDigest && String(values[j.ckey]?.revision ?? 0) === grant.credentialRevisionAtApproval,
      'TASK_EXACT_GRANT_NOT_ACTIVE');
    }
    return op;
  }
  const requestId = (c, tx) => `exact:${sha(JSON.stringify({ binding: c.binding, unsignedDigest: tx.unsignedHash }))}`;
  function checkClaim(claim, c, tx, state) {
    fields(claim, ['schema', 'requestId', 'binding', 'unsignedDigest', 'transactionHash', 'state']);
    check(claim.schema === '8415-task-exact-signature/1' && claim.requestId === requestId(c, tx) &&
      JSON.stringify(claim.binding) === JSON.stringify(c.binding) && claim.unsignedDigest === tx.unsignedHash && claim.state === state,
    'TASK_EXACT_JOURNAL_REFUSED');
    check(state === 'claimed' ? claim.transactionHash === null : typeof claim.transactionHash === 'string', 'TASK_EXACT_JOURNAL_REFUSED');
    if (state === 'signed') hash(claim.transactionHash);
  }
  async function verify(input) { const c = context(input); await unsigned(c, true); return c.binding; }
  async function send(input) {
    const c = context(input), tx = await unsigned(c, true), j = await journalKeys(c);
    // The service already persisted unknown + permanent nonce. Claim once in
    // that same store before calling the external signer; restart cannot retry.
    await transact(j.keys, values => {
      const op = journal(c, j, values, true); check(op.exactSignature === undefined, 'TASK_EXACT_SIGN_ALREADY_CLAIMED');
      return { ...values, [c.okey]: { ...op, exactSignature: { schema: '8415-task-exact-signature/1',
        requestId: requestId(c, tx), binding: c.binding, unsignedDigest: tx.unsignedHash, transactionHash: null, state: 'claimed' } } };
    });
    let signing;
    // Claim persistence also crosses an await. A queued revoke must win before
    // signer invocation, not merely prevent the eventual broadcast.
    await withReadSnapshot(j.keys, values => {
      const op = journal(c, j, values, true); checkClaim(op.exactSignature, c, tx, 'claimed');
      signing = Promise.resolve(sign(freeze({ requestId: requestId(c, tx), unsignedSerialized: tx.unsignedSerialized,
        unsignedDigest: tx.unsignedHash, binding: c.binding }))).then(value => ({ value }), error => ({ error }));
    });
    const signature = await signing;
    if (Object.hasOwn(signature, 'error')) throw new TaskExactSignerError('TASK_EXACT_SIGNATURE_OUTCOME_UNKNOWN');
    const signed = signedTransaction(signature.value, tx, c.binding.actor);
    // Persist only the hash, never broadcastable signed bytes. Expand the latest
    // record, retaining concurrent receipt metadata and all existing fields.
    await transact(j.keys, values => {
      const op = journal(c, j, values, true); checkClaim(op.exactSignature, c, tx, 'claimed');
      return { ...values, [c.okey]: { ...op, exactSignature: { ...op.exactSignature, transactionHash: signed.hash, state: 'signed' } } };
    });
    const fresh = await unsigned(c, true);
    check(fresh.unsignedSerialized === tx.unsignedSerialized, 'TASK_EXACT_CURRENT_TRANSACTION_CHANGED');
    let broadcast;
    // A returned readMany snapshot would allow a queued revoke to commit before
    // this async continuation resumes. Validate AND invoke the sole RPC inside
    // the store's synchronous read boundary. No persistence follows this gate.
    // Revocation ordered before this callback blocks; one ordered after it
    // cannot undo a request already made. Network completion is outside the lock.
    await withReadSnapshot(j.keys, values => {
      const op = journal(c, j, values, true); checkClaim(op.exactSignature, c, tx, 'signed');
      check(op.exactSignature.transactionHash === signed.hash, 'TASK_EXACT_JOURNAL_REFUSED');
      broadcast = Promise.resolve(request({ method: 'eth_sendRawTransaction', params: [signed.serialized] }))
        .then(value => ({ value }), error => ({ error }));
    });
    const result = await broadcast;
    if (Object.hasOwn(result, 'error')) throw new TaskExactSignerError('TASK_EXACT_BROADCAST_OUTCOME_UNKNOWN');
    const returned = result.value;
    check(typeof returned === 'string' && returned.toLowerCase() === signed.hash, 'TASK_EXACT_BROADCAST_HASH_MISMATCH');
    return Object.freeze({ ...c.binding, transactionHash: signed.hash });
  }
  async function recover(input) {
    const c = context(input), tx = await unsigned(c, false), j = await journalKeys(c), values = await readMany(j.keys);
    const op = journal(c, j, values, false); checkClaim(op.exactSignature, c, tx, 'signed');
    const expectedHash = op.exactSignature.transactionHash;
    // A locally signed hash proves no submission. Require full independently
    // fetched signature + exact fields; do not accept a caller-supplied hash.
    const observed = await rpc('eth_getTransactionByHash', [expectedHash]);
    check(observed !== null && observed.hash?.toLowerCase() === expectedHash && observed.from?.toLowerCase() === c.binding.actor &&
      quantity(observed.type) === 2n && Array.isArray(observed.accessList) && observed.accessList.length === 0,
    'TASK_EXACT_RECOVERY_NOT_ESTABLISHED');
    let recovered;
    try {
      check(quantity(observed.nonce) <= BigInt(Number.MAX_SAFE_INTEGER), 'TASK_EXACT_RECOVERY_NOT_ESTABLISHED');
      const parity = quantity(observed.yParity ?? observed.v); check(parity === 0n || parity === 1n, 'TASK_EXACT_RECOVERY_NOT_ESTABLISHED');
      recovered = Transaction.from({ type: 2, chainId: quantity(observed.chainId), nonce: Number(quantity(observed.nonce)),
        to: observed.to, data: observed.input, value: quantity(observed.value), gasLimit: quantity(observed.gas),
        maxFeePerGas: quantity(observed.maxFeePerGas), maxPriorityFeePerGas: quantity(observed.maxPriorityFeePerGas), accessList: [],
        signature: { r: observed.r, s: observed.s, yParity: Number(parity) } });
      recovered = signedTransaction(recovered.serialized, tx, c.binding.actor);
    } catch { throw new TaskExactSignerError('TASK_EXACT_RECOVERY_NOT_ESTABLISHED'); }
    check(recovered.hash === expectedHash && quantity(await rpc('eth_chainId')) === tx.chainId, 'TASK_EXACT_RECOVERY_NOT_ESTABLISHED');
    return Object.freeze({ ...c.binding, state: 'submitted', transactionHash: expectedHash });
  }
  async function plan(input) {
    fields(input, ['task', 'budget', 'executor', 'grantPolicyVersion']);
    check(input.executor?.digest === executorDigest && JSON.stringify(input.executor.identity) === JSON.stringify(identity), 'TASK_EXACT_BINDING_REFUSED');
    return planner.plan(input);
  }
  return Object.freeze({ identity, verify, send, recover, ...(planner === null ? {} : { plan }) });
}


