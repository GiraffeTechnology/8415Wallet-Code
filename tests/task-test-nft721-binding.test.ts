/** Synthetic source-contract regressions; not deployed admission or mint evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeTaskPolicy,freezeChildOperation,assessChildScope,normalizeExistingOperation} from '../src/agent/taskContract.ts';
import {encodeTestNFT721Mint} from '../server/task-test-nft721-contract.mjs';
import {hashControlBytes} from '../src/controls/authorization.ts';
import {normalizeTestNFT721Bindings,testNFT721BindingForOperation,testNFT721OperationRequest,
  normalizeTestNFT721OperationResult} from '../server/task-test-nft721-binding.mjs';
const h=(n:string)=>'0x'+n.repeat(64),actor='0x'+'1'.repeat(40),collection='0x'+'2'.repeat(40);
const operation=()=>({kind:'artfi-test-nft721-mint' as const,taskId:'wallet:mint:synthetic:1',sourceTaskId:'producer:original:synthetic',
  taskIdBytes32:h('3'),artifactDigest:h('4'),chainId:'560048',actor,
  collection:{contract:collection,runtimeCodeHash:h('5')},sourceHash:h('6'),assetKind:0 as const,metadataHash:h('7'),
  metadataURI:'ipfs://synthetic-test-only'});
const row=(op:ReturnType<typeof operation>)=>({taskId:op.taskId,binding:{schema:'8415-hoodi-test-nft-deployment/1',artifactDigest:op.artifactDigest,
  chainId:op.chainId,collection:op.collection.contract,runtimeCodeHash:op.collection.runtimeCodeHash,issuer:op.actor,
  taskId:op.sourceTaskId,taskIdBytes32:op.taskIdBytes32}});
const taskFor=(op:ReturnType<typeof operation>)=>freezeTaskPolicy({schema:'8415-agent-task/1',taskId:op.taskId,tenant:'default',
  origin:'https://wallet.example.invalid',chainId:op.chainId,actor:op.actor,expiresAt:'2000',
  fees:{perOperationWei:'1000000',totalWei:'1000000'},intent:{kind:'exact-operation',operation:op}});
test('Wallet authorization task and opaque producer task pair remain separate exact fields',()=>{
  const op=operation(),task=taskFor(op),rows=normalizeTestNFT721Bindings([row(op)]);
  assert.notEqual(op.taskId,op.sourceTaskId);assert.equal(testNFT721OperationRequest(op).taskId,op.sourceTaskId);
  assert.equal(testNFT721OperationRequest(op).taskIdBytes32,op.taskIdBytes32);
  assert.ok(task.policy.intent.kind==='exact-operation');
  assert.equal(testNFT721BindingForOperation(rows,task.policy.intent.operation).taskId,op.sourceTaskId);
  assert.ok(rows[0]);
  assert.ok(Object.isFrozen(rows)&&Object.isFrozen(rows[0])&&Object.isFrozen(rows[0].binding));
  const raw=row(op);const captured=normalizeTestNFT721Bindings([raw]);raw.binding.taskIdBytes32=h('8');
  assert.equal(captured[0]!.binding.taskIdBytes32,op.taskIdBytes32);
});
test('typed ERC721 mint rejects another parent, network, arbitrary data and unsupported asset kind',()=>{
  const op=operation();
  assert.throws(()=>freezeTaskPolicy({...taskFor(op).policy,taskId:'different-wallet-task'}),/TASK_TEST_MINT_TASK_BINDING_REFUSED/);
  for(const patch of [{chainId:'11155111'},{assetKind:2},{assetKind:'0'},{metadataURI:'ipfs://has space'},
    {taskIdBytes32:h('0')},{artifactDigest:h('0')},{data:'0x1234'},{tokenId:'1'}])
    assert.throws(()=>normalizeExistingOperation({...op,...patch}));
});
test('server deployment admission is exact and cannot be invented by operation JSON',()=>{
  const op=operation(),rows=normalizeTestNFT721Bindings([row(op)]);
  for(const patch of [{taskId:'unadmitted'},{sourceTaskId:'other-producer'},{taskIdBytes32:h('8')},{artifactDigest:h('9')},
    {chainId:'1'},{actor:'0x'+'3'.repeat(40)},{collection:{...op.collection,runtimeCodeHash:h('a')}}])
    assert.throws(()=>testNFT721BindingForOperation(rows,{...op,...patch}),/NOT_ADMITTED/);
  assert.throws(()=>testNFT721BindingForOperation([],op),/NOT_ADMITTED/);
  assert.throws(()=>normalizeTestNFT721Bindings([{...row(op),modulePath:'attacker'}]),/BINDING_REFUSED/);
  assert.throws(()=>normalizeTestNFT721Bindings([row(op),{...row(op),binding:{...row(op).binding,artifactDigest:h('f')}}]),/BINDING_REFUSED/);
});
test('equivalent binding key order has one canonical captured identity',()=>{
  const op=operation(),original=row(op),reordered={...original,binding:Object.fromEntries(Object.entries(original.binding).reverse())};
  assert.deepEqual(normalizeTestNFT721Bindings([original,reordered]),normalizeTestNFT721Bindings([original]));
});
test('child wire remains zero-value, fixed four-argument ABI and exact collection',()=>{
  const op=operation(),task=taskFor(op),wire=encodeTestNFT721Mint(testNFT721OperationRequest(op));
  const make=(changes:Partial<{to:string;calldataHash:string;valueWei:string}>)=>freezeChildOperation({schema:'8415-agent-child/1',operationId:'mint:child',taskDigest:task.digest,
    operation:op,nonce:'7',expiresAt:'1500',wire:{to:wire.to,calldataHash:hashControlBytes(wire.data),valueWei:'0',...changes},
    fees:{gasLimit:'100000',maxFeePerGasWei:'10'},market:null});
  assert.notEqual(assessChildScope(task,make({}),1000n).state,'outside-declared-scope');
  for(const changes of [{valueWei:'1'},{to:actor}])assert.equal(assessChildScope(task,make(changes),1000n).state,'outside-declared-scope');
});
test('normalized result binds Wallet task, producer task, artifact and actual observed token separately',()=>{
  const op=operation(),observation={state:'confirmed-at-depth',effect:'exact-operation-observed',
    originalTransactionHash:h('a'),blockHash:h('b'),blockNumber:'100'};
  const raw={schema:'8415-wallet-test-nft721-result/1',taskId:op.taskId,sourceTaskId:op.sourceTaskId,
    taskIdBytes32:op.taskIdBytes32,artifactDigest:op.artifactDigest,chainId:op.chainId,collection:op.collection.contract,
    runtimeCodeHash:op.collection.runtimeCodeHash,issuer:op.actor,sourceHash:op.sourceHash,assetKind:op.assetKind,
    metadataHash:op.metadataHash,metadataURI:op.metadataURI,transactionHash:h('a'),blockHash:h('b'),blockNumber:'0x64',
    tokenId:'9007199254740993123',standard:'ERC-721',quantity:'1',testOnly:true,finality:'canonical-at-observed-block-not-finality'};
  assert.deepEqual(normalizeTestNFT721OperationResult(raw,op,observation),raw);
  for(const patch of [{taskId:op.sourceTaskId},{sourceTaskId:op.taskId},{artifactDigest:h('e')},{quantity:'100'},
    {tokenId:'01'},{sourceHash:h('e')},{metadataURI:'ipfs://other'},{finality:'finalized'},{sourceAuthority:true}])
    assert.throws(()=>normalizeTestNFT721OperationResult({...raw,...patch},op,observation));
  assert.throws(()=>normalizeTestNFT721OperationResult(raw,op,{...observation,state:'reorged'}));
});

