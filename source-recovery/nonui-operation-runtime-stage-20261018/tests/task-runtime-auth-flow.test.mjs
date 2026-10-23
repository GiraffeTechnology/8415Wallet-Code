/** Synthetic standard-entry HTTP-handler flow, not a browser or public-chain test.
 * No listeners, existing wallets, credential files or network are used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Wallet, Transaction } from 'ethers';
import { createAuthRuntime } from '../server/main.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { disabledTaskListingRuntime } from '../server/task-listing-runtime.mjs';
import { base32, hotp } from '../server/crypto.mjs';
import { freezeTaskPolicy, freezeChildOperation } from '../src/agent/taskContract.ts';
import { hashControlBytes } from '../src/controls/authorization.ts';

const origin = 'https://wallet.example.invalid', epoch = 1_800_000_000_000;
const quantity = value => `0x${BigInt(value).toString(16)}`;
const recipient = `0x${'2'.repeat(40)}`, blockHash = `0x${'7'.repeat(64)}`;
async function fixture(t, options = {}) {
  const wallet = Wallet.createRandom(), actor = wallet.address.toLowerCase();
  const secret = base32(Buffer.alloc(20, 0x35)), store = new MemoryCredentialStore();
  await store.transaction('xiongan:tester', () => ({ secret, lastStep: -1, revision: 1 }));
  const state = { signed: 0, actualSigningEffects: 0, broadcasts: 0, mined: false, visible: null, methods: [] };
  const provider = { async request({ method, params = [] }) {
    state.methods.push(method);
    if (method === 'eth_chainId') return '0x88bb0';
    if (method === 'eth_getBalance') return '0xffffffffffffffff';
    // Block zero is what the fixed-genesis check reads; a case can replace it.
    if (method === 'eth_getBlockByNumber' && params[0] === '0x0') {
      return options.genesis === null ? null
        : {number:'0x0',hash:options.genesis ?? '0xbbe312868b376a3001692a646dd2d7d1e4406380dfd86b98aa8a34d1557c971b'};
    }
    if (method === 'eth_getCode') return '0x';
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_call') return '0x';
    if (method === 'eth_getBlockByNumber') return { number: '0x10', hash: blockHash };
    if (method === 'eth_blockNumber') return '0x11';
    if (method === 'eth_getTransactionByHash') return state.visible;
    if (method === 'eth_getTransactionReceipt') return state.mined ? {
      transactionHash: state.visible.hash, from: actor, to: recipient, transactionIndex: '0x0',
      blockHash, blockNumber: '0x10', status: '0x1', logs: [],
    } : null;
    if (method === 'eth_sendRawTransaction') {
      state.broadcasts++;
      const tx = Transaction.from(params[0]);
      state.visible = { hash: tx.hash, from: tx.from.toLowerCase(), to: tx.to.toLowerCase(),
        type: quantity(tx.type), chainId: quantity(tx.chainId), nonce: quantity(tx.nonce),
        value: quantity(tx.value), input: tx.data, gas: quantity(tx.gasLimit),
        maxFeePerGas: quantity(tx.maxFeePerGas), maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas),
        accessList: [], r: tx.signature.r, s: tx.signature.s, yParity: quantity(tx.signature.yParity),
        v: quantity(tx.signature.yParity), blockNumber: '0x10', blockHash, transactionIndex: '0x0' };
      if (options.lostResponse) throw Error('Synthetic response lost after dispatch');
      return tx.hash;
    }
    throw Error(`Unexpected synthetic method ${method}`);
  } };
  const config = { origin, tenant: 'xiongan', port: 31999, statePath: '/synthetic-task-runtime/credentials.enc',
    accounts: [{ username: 'tester', wallets: [{ account: actor, chainId: '560048' }] }] };
  const exactServerConfiguration = { provider, externalSigner: { async signExactTransaction(input, execution) {
    state.signed++;
    if (options.beforeSign) await options.beforeSign({ call, state });
    assert.equal(typeof execution?.withSigningFence, 'function', 'real one-use signing fence is required');
    return execution.withSigningFence(() => {
      state.actualSigningEffects++;
      return wallet.signTransaction(Transaction.from(input.unsignedSerialized));
    });
  } }, signerIdentity: { signerId: 'synthetic:signer', signerVersion: '1', implementationDigest: `0x${'5'.repeat(64)}` },
  maxPriorityFeePerGasWei: '1', agentId: 'synthetic:agent', agentVersion: '1', observationPolicy: { minimumConfirmations: '2' } };
  const runtime = await createAuthRuntime({ config, store, exactServerConfiguration, now: () => epoch,
    listingRuntime: { runtime: disabledTaskListingRuntime(), async start() {}, async stop() {} } });
  t.after(() => runtime.stop());
  const cookies = new Map(); let csrf;
  async function call(path, body, { unauthenticated = false } = {}) {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { method: body === undefined ? 'GET' : 'POST', url: `/auth/${path}`,
      socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'wallet.example.invalid', origin,
        'x-wallet-tenant': 'xiongan', 'content-type': 'application/json',
        ...(unauthenticated ? {} : { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'x-wallet-csrf': csrf }) } });
    let status, result;
    await runtime.handler(request, { set statusCode(value) { status = value; },
      setHeader(name, value) {
        if (name.toLowerCase() === 'set-cookie') for (const item of Array.isArray(value) ? value : [value]) {
          const pair = item.split(';')[0], equals = pair.indexOf('=');
          cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
        }
      }, end(value) { result = JSON.parse(value); } });
    if (status !== 200) throw Object.assign(Error(result.error), { status });
    return result;
  }
  csrf = (await call('bootstrap')).csrf;
  const challenge = await call('challenge', { method: 'wallet', account: actor, chainId: '560048' });
  const session = await call('proof', { id: challenge.id, account: actor, chainId: '560048', signature: await wallet.signMessage(challenge.message) });
  csrf = session.csrf;
  const task = freezeTaskPolicy({ schema: '8415-agent-task/1', taskId: 'synthetic:entry-task', tenant: 'xiongan', origin,
    chainId: '560048', actor, expiresAt: String(epoch / 1000 + 7200), fees: { perOperationWei: '1000000', totalWei: '1000000' },
    intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId: '560048', actor, recipient, valueWei: '10' } } });
  const child = freezeChildOperation({ schema: '8415-agent-child/1', operationId: 'synthetic:entry-operation', taskDigest: task.digest,
    operation: task.policy.intent.operation, nonce: '7', expiresAt: String(epoch / 1000 + 600),
    wire: { to: recipient, calldataHash: hashControlBytes('0x'), valueWei: '10' },
    fees: { gasLimit: '21000', maxFeePerGasWei: '3' }, market: null });
  const operation = result => ({ taskDigest: task.digest, operationId: child.child.operationId,
    childDigest: child.digest, expectedBudgetRevision: result.budget.revision });
  async function reserve() {
    const prepared = await call('tasks/prepare', { policy: task.policy });
    const authorized = await call('tasks/authorize', { challengeId: prepared.challengeId, taskDigest: task.digest,
      executorDigest: prepared.executor.digest, observationPolicyDigest: prepared.observationPolicy.digest,
      code: hotp(secret, Math.floor(epoch / 30000)) });
    return call('tasks/reserve', { taskDigest: task.digest, child: child.child, expectedBudgetRevision: authorized.budget.revision });
  }
  return { runtime, state, task, child, call, reserve, operation };
}

test('standard entry handler authorizes, executes, observes and reads the same task status', async t => {
  const f = await fixture(t), reserved = await f.reserve();
  const submitted = await f.call('tasks/execute', f.operation(reserved));
  assert.equal(submitted.outcome, 'submitted');
  const pending = await f.call('tasks/observe', f.operation(submitted));
  assert.equal(pending.outcome, 'pending');
  f.state.mined = true;
  const observed = await f.call('tasks/observe', f.operation(pending));
  assert.equal(observed.outcome, 'confirmed-at-depth');
  assert.equal(observed.completion.state, 'completed-at-observation-depth');
  const status = await f.call('tasks/status', { taskDigest: f.task.digest });
  assert.equal(status.observations[0].observation.originalTransactionHash, f.state.visible.hash);
  assert.equal(status.observations[0].observation.effect, 'exact-operation-observed');
  assert.equal(status.observations[0].observation.protocolFinality, 'not-evaluated');
  assert.equal(f.state.signed, 1); assert.equal(f.state.broadcasts, 1);
  assert.equal(f.state.actualSigningEffects, 1);
  assert.equal(f.runtime.server.listening, false);
});
test('entry handler rejects unauthenticated execution and replay without another signer call', async t => {
  const f = await fixture(t), reserved = await f.reserve();
  await assert.rejects(f.call('tasks/execute', f.operation(reserved), { unauthenticated: true }), /AUTH_/);
  assert.equal(f.state.signed, 0);
  const submitted = await f.call('tasks/execute', f.operation(reserved));
  await assert.rejects(f.call('tasks/execute', f.operation(submitted)));
  assert.equal(f.state.signed, 1); assert.equal(f.state.broadcasts, 1);
});
test('entry handler reconciles an unknown dispatch without signing or broadcasting again', async t => {
  const f = await fixture(t, { lostResponse: true }), reserved = await f.reserve();
  const unknown = await f.call('tasks/execute', f.operation(reserved));
  assert.equal(unknown.outcome, 'outcome-unknown');
  const recovered = await f.call('tasks/recover', f.operation(unknown));
  assert.equal(recovered.outcome, 'submitted');
  assert.equal(f.state.signed, 1); assert.equal(f.state.broadcasts, 1);
});
test('revocation during external signing prevents raw dispatch through the standard entry', async t => {
  let taskDigest;
  const f = await fixture(t, { async beforeSign({ call }) {
    await call('tasks/revoke', { taskDigest, expectedGrantPolicyVersion: '1' });
  } });
  taskDigest = f.task.digest;
  const reserved = await f.reserve(), result = await f.call('tasks/execute', f.operation(reserved));
  assert.equal(result.outcome, 'outcome-unknown');
  assert.equal(f.state.signed, 1); assert.equal(f.state.broadcasts, 0);
  assert.equal(f.state.actualSigningEffects, 0, 'revocation must win before the actual signature effect');
  assert.equal((await f.call('tasks/status', { taskDigest })).effectiveStatus, 'revoked');
});


// Chain560048 with another genesis is another chain. The refusal code itself is
// asserted at the unit boundary in task-exact-chain-state.test.mjs; across the
// entry handler it must stay a generic refusal, so what these pin is the
// observable outcome: block zero was read, the operation did not proceed, and
// no internal detail crossed the boundary. The same flow on the real genesis
// signs and broadcasts once, two tests above, which is the control.
for (const [label, genesis] of [
  ['a replaced genesis block', `0x${'c'.repeat(64)}`],
  ['no genesis block at all', null],
]) {
  test(`the standard entry refuses to execute against ${label}, without signing`, async t => {
    const f = await fixture(t, { genesis }), reserved = await f.reserve();
    await assert.rejects(f.call('tasks/execute', f.operation(reserved)), error => {
      assert.doesNotMatch(String(error), /GENESIS|0x0|chain-state/i, 'the refusal leaked its internals');
      return true;
    });
    assert.ok(f.state.methods.includes('eth_getBlockByNumber'), 'block zero was never read');
    assert.equal(f.state.signed, 0, 'a refused chain reached the signer');
    assert.equal(f.state.broadcasts, 0);
  });
}
