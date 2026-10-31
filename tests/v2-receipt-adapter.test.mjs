/** Reused synthetic fixture only; V2-specific checks below. No network or real accounts. */
import test from 'node:test';

import assert from 'node:assert/strict';

import { createTaskReceiptAdapter, TASK_RECEIPT_RUNTIME_FILES } from '../server/v2/task-receipt-adapter.mjs';

import { freezeTaskPolicy, freezeChildOperation, emptyTaskBudget, reserveTaskBudget, markTaskSendAttempt,
  noteTaskSubmission, reconcileTaskBudget } from '../src/agent/taskContract.ts';

import { bindTaskObservation, normalizeTaskObservation, freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';

import { hashControlBytes } from '../src/controls/authorization.ts';

import { encodeCall, encodeCallWithTail, encodeWords } from '../src/codec/abi.ts';

import { keccak256Utf8 } from '../src/codec/keccak.ts';


const a = digit => `0x${digit.repeat(40)}`, h = digit => `0x${digit.repeat(64)}`;

const actor = a('1'), recipient = a('2'), token = a('3'), controller = a('4'), account = a('5');

const transactionHash = h('a'), blockHash = h('b'), replacementHash = h('c'), executorDigest = h('d');

const runtimeCode = '0x6000', runtimeCodeHash = hashControlBytes(runtimeCode), chainId = '11155111';

const wordAddress = value => `0x${'0'.repeat(24)}${value.slice(2)}`;

const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;

const chainHex = `0x${BigInt(chainId).toString(16)}`;

const operationKinds = ['native-transfer', 'erc20-transfer', 'erc721-transfer', 'erc1155-transfer', 'create-account', 'deposit', 'standalone-withdraw', 'complete', 'return-hop'];

function fixture(kind = 'native-transfer') {
  const identity = { chainId, actor }, tokenPin = { contract: token, runtimeCodeHash }, controllerPin = { contract: controller, runtimeCodeHash };
  const operations = {
    'native-transfer': { ...identity, kind, recipient, valueWei: '100' },
    'erc20-transfer': { ...identity, kind, contract: token, recipient, amount: '7' },
    'erc721-transfer': { ...identity, kind, contract: token, recipient, tokenId: '7' },
    'erc1155-transfer': { ...identity, kind, contract: token, recipient, tokenId: '7', amount: '3' },
    'create-account': { ...identity, kind, controller: controllerPin },
    deposit: { ...identity, kind, controller: controllerPin, token: tokenPin, tokenId: '7' },
    'standalone-withdraw': { ...identity, kind, controller: controllerPin, token: tokenPin, tokenId: '7', destination: recipient },
    complete: { ...identity, kind, controller: controllerPin, token: tokenPin, sequenceId: h('6'), legId: h('7'), expectedRevision: '3' },
    'return-hop': { ...identity, kind, controller: controllerPin, token: tokenPin, sequenceId: h('6'), legId: h('7'), expectedRevision: '3' },
  };
  const operation = operations[kind];
  let to = recipient, value = '0x0', data;
  if (kind === 'native-transfer') { data = '0x'; value = '0x64'; }
  else if (kind === 'erc20-transfer') { to = token; data = encodeCall('transfer(address,uint256)', ['address', 'uint256'], [recipient, 7n]); }
  else if (kind === 'erc721-transfer' || kind === 'deposit') { to = token; data = encodeCall('safeTransferFrom(address,address,uint256)', ['address', 'address', 'uint256'], [actor, kind === 'deposit' ? account : recipient, 7n]); }
  else if (kind === 'erc1155-transfer') { to = token; data = encodeCallWithTail('safeTransferFrom(address,address,uint256,uint256,bytes)', ['address', 'address', 'uint256', 'uint256', 'bytes'], [actor, recipient, 7n, 3n, '0x']); }
  else if (kind === 'standalone-withdraw') { to = account; data = encodeCall('withdrawStandalone(address,uint256,address)', ['address', 'uint256', 'address'], [token, 7n, recipient]); }
  else { to = controller; data = kind === 'create-account' ? encodeCall('createAccount()', [], []) : encodeCall(kind === 'complete' ? 'completeThrough(bytes32,bytes32,uint256)' : 'returnHop(bytes32,bytes32,uint256)', ['bytes32', 'bytes32', 'uint256'], [h('6'), h('7'), 3n]); }
  const task = freezeTaskPolicy({ schema: '8415-agent-task/1', taskId: 'receipt-test', tenant: 'default', origin: 'https://wallet.example',
    chainId, actor, expiresAt: '2000', fees: { perOperationWei: '1000000', totalWei: '1000000' }, intent: { kind: 'exact-operation', operation } });
  const child = freezeChildOperation({ schema: '8415-agent-child/1', operationId: 'receipt-op', taskDigest: task.digest,
    operation, nonce: '1', expiresAt: '1500', wire: { to, calldataHash: hashControlBytes(data), valueWei: BigInt(value).toString() },
    fees: { gasLimit: '100000', maxFeePerGasWei: '10' }, market: null });
  const input = { task, child, executor: { digest: executorDigest }, attempt: { executorDigest, grantPolicyVersion: '1', transactionHash }, observationPolicy: { minimumConfirmations: '2' } };
  const logs = [];
  const log = (address, signature, topics, data) => ({ address, transactionHash, blockHash, blockNumber: '0x64', transactionIndex: '0x0', removed: false,
    topics: [keccak256Utf8(signature), ...topics], data });
  if (kind === 'erc20-transfer') logs.push(log(token, 'Transfer(address,address,uint256)', [wordAddress(actor), wordAddress(recipient)], word(7)));
  else if (['erc721-transfer', 'deposit', 'standalone-withdraw'].includes(kind)) logs.push(log(token, 'Transfer(address,address,uint256)',
    [wordAddress(kind === 'standalone-withdraw' ? account : actor), wordAddress(kind === 'deposit' ? account : recipient), word(7)], '0x'));
  else if (kind === 'erc1155-transfer') logs.push(log(token, 'TransferSingle(address,address,address,uint256,uint256)', [wordAddress(actor), wordAddress(actor), wordAddress(recipient)], encodeWords(['uint256', 'uint256'], [7n, 3n])));
  else if (kind === 'create-account') logs.push(log(controller, 'AccountCreated(address,address)', [wordAddress(actor), wordAddress(account)], '0x'));
  else if (kind === 'complete') logs.push(log(controller, 'PrefixCompleted(bytes32,uint256,uint64,uint256)', [h('6')], encodeWords(['uint256', 'uint64', 'uint256'], [1n, 1n, 4n])));
  else if (kind === 'return-hop') logs.push(log(controller, 'ReturnHopCompleted(bytes32,bytes32,address,address,uint256)', [h('6'), h('7')], encodeWords(['address', 'address', 'uint256'], [account, recipient, 4n])));
  const tx = { hash: transactionHash, from: actor, to, value, input: data, nonce: '0x1', chainId: chainHex, blockHash, blockNumber: '0x64', transactionIndex: '0x0', gas: '0x186a0', maxFeePerGas: '0xa' };
  const receipt = { transactionHash, from: actor, to, blockHash, blockNumber: '0x64', transactionIndex: '0x0', status: '0x1', logs };
  const flags = { pending: false, head: '0x65', canonical: blockHash, chain: chainHex, sequenceToken: token, sequenceCodeHash: runtimeCodeHash,
    code: runtimeCode, actorCode: '0x', recipientCode: '0x', replacementPending: false, replaceNonce: '0x1', replaceActor: actor, replaceSameIntent: false, reorgOnBlockRead: Infinity };
  const calls = []; let blockReads = 0;
  const provider = { async request({ method, params = [] }) {
    calls.push({ method, params });
    if (method === 'eth_chainId') return flags.chain;
    if (method === 'eth_getCode') return params[0] === actor ? flags.actorCode : params[0] === recipient ? flags.recipientCode : flags.code;
    if (method === 'eth_getBlockByNumber') { blockReads++; return flags.canonical === null ? null : { number: '0x64', hash: blockReads >= flags.reorgOnBlockRead ? h('e') : flags.canonical }; }
    if (method === 'eth_blockNumber') return flags.head;
    if (method === 'eth_getTransactionCount') return '0x2';
    if (method === 'eth_getTransactionByHash') return params[0] === replacementHash ? { ...tx, hash: replacementHash, from: flags.replaceActor, nonce: flags.replaceNonce,
      ...(flags.replaceSameIntent ? {} : { to: actor, input: '0x', value: '0x0' }) } : structuredClone(tx);
    if (method === 'eth_getTransactionReceipt') return params[0] === replacementHash ? flags.replacementPending ? null : { ...receipt, transactionHash: replacementHash, from: flags.replaceActor,
      to: flags.replaceSameIntent ? tx.to : actor, logs: [] } : flags.pending ? null : structuredClone(receipt);
    if (method === 'eth_call') {
      const call = params[0];
      if (call.data === encodeCall('accountOf(address)', ['address'], [actor])) return wordAddress(account);
      if (call.data === encodeCall('registeredAccount(address)', ['address'], [account])) return word(1);
      if (call.data === encodeCall('owner()', [], [])) return wordAddress(actor);
      if (call.data === encodeCall('controller()', [], [])) return wordAddress(controller);
      if (call.data === encodeCall('sequence(bytes32)', ['bytes32'], [h('6')])) return encodeWords(
        ['address', 'uint256', 'address', 'address', 'address', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32', 'bool'],
        [flags.sequenceToken, 7n, actor, account, recipient, h('8'), h('9'), flags.sequenceCodeHash, 4n, 1n, 1n, 0n, 1n, h('a'), false]);
    }
    throw new Error(`Unexpected read-only fixture method ${method}`);
  } };
  const adapter = createTaskReceiptAdapter({ provider, observationPolicy: input.observationPolicy, now: () => 2500000 });
  return { input, adapter, flags, tx, receipt, calls, provider };
}


const assessmentInput = input => ({ task: input.task, child: input.child, executor: input.executor, observationPolicy: input.observationPolicy });
for(const kind of operationKinds.filter(x=>!['complete','return-hop'].includes(x)))test(`V2 receipt ${kind} validates actual effect and refuses wrong nonce`,async()=>{
 const f=fixture(kind),result=await f.adapter.observe(f.input);assert.equal(result.state,'confirmed-at-depth');assert.equal(result.effect,'exact-operation-observed');
 assert.ok(!f.calls.some(c=>/send|sign|accounts/i.test(c.method)));f.tx.nonce='0x2';await assert.rejects(f.adapter.observe(f.input));
});
test('V2 receipt refuses linked observation and capability before RPC',async()=>{
 for(const kind of ['complete','return-hop']){const f=fixture(kind);await assert.rejects(f.adapter.observe(f.input),/TASK_V2_OPERATION_NOT_SUPPORTED/);assert.deepEqual(f.calls,[]);}
});
test('V2 receipt UNKNOWN cannot claim success and replacement is read only',async()=>{
 const f=fixture('native-transfer');f.flags.pending=true;assert.equal((await f.adapter.observe(f.input)).state,'pending');
 const r=await f.adapter.observeReplacement(f.input,replacementHash);assert.equal(r.state,'superseded-at-depth');assert.equal(r.effect,'not-established');assert.ok(!f.calls.some(c=>/send|sign|accounts/i.test(c.method)));
});
