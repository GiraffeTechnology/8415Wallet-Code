/** The receipt path must give the ArtFi native operation journal the same held
 * execution context the listing path has, without relaxing any authorization
 * rule and without letting the journal spend a permitted attempt. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Interface, AbiCoder, TypedDataEncoder, keccak256 } from 'ethers';
import { createTaskAuthorizationService } from '../server/task-authorization.mjs';
import { createTaskReceiptRuntime, disabledTaskReceiptRuntime } from '../server/task-receipt-runtime.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
const a = n => '0x' + n.repeat(40), h = n => '0x' + n.repeat(64), epoch = 1800000000000;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PEER = 'spiffe://wallet.example.invalid/journal', CONSUMER = 'spiffe://artfi.example.invalid/journal-consumer';
const saleType = '(address seller,address collection,uint256 tokenId,address paymentToken,uint256 price,address buyer,uint256 salt,uint48 startsAt,uint48 endsAt,uint256 epoch)';
const correspondenceType = '(bytes32 settlementId,bytes32 assetRecordHash,bytes32 oracleSourceId,bytes32 requestHash,bytes32 executionReferenceHash,bytes32 previousSegment,bytes32 oldCertificateHash,bytes32 warehouseReceiptHash)';
const abi = new Interface(['function fund(' + saleType + ' sale,' + correspondenceType + ' correspondence,bytes signature)',
  'function confirmRegistration(bytes32 id,bytes evidence)', 'function paySeller(bytes32 id)']);
const saleFields = [['seller', 'address'], ['collection', 'address'], ['tokenId', 'uint256'], ['paymentToken', 'address'],
  ['price', 'uint256'], ['buyer', 'address'], ['salt', 'uint256'], ['startsAt', 'uint48'], ['endsAt', 'uint48'],
  ['epoch', 'uint256']].map(([name, type]) => ({ name, type }));

function fixture() {
  const state = { now: epoch };
  const store = new MemoryCredentialStore({ 'xiongan:tester': { revision: 1, synthetic: true } });
  const journalStore = new MemoryCredentialStore({});
  const session = { username: 'tester', account: a('1'), chainId: '560048', id: 'synthetic-session', revision: 1, issuedAt: epoch, expiresAt: epoch + 900000 };
  const sale = { seller: a('2'), collection: a('3'), tokenId: '7', paymentToken: a('4'), price: '100', buyer: a('1'), salt: '9', startsAt: '1', endsAt: '2000000000', epoch: '0' };
  const correspondence = { settlementId: h('1'), assetRecordHash: h('2'), oracleSourceId: h('3'), requestHash: h('4'),
    executionReferenceHash: h('5'), previousSegment: h('0'), oldCertificateHash: h('6'), warehouseReceiptHash: h('7') };
  const segment = TypedDataEncoder.hash({ name: 'ArtFi Whole Artwork Receipt Settlement', version: '1', chainId: 560048, verifyingContract: a('5') },
    { ReceiptAuthorization: [{ name: 'saleIntentHash', type: 'bytes32' }, ...Object.keys(correspondence).map(name => ({ name, type: 'bytes32' }))] },
    { saleIntentHash: TypedDataEncoder.hashStruct('SaleIntent', { SaleIntent: saleFields }, sale), ...correspondence });
  const data = { funded: abi.encodeFunctionData('fund', [sale, correspondence, '0x1234']),
    registered: abi.encodeFunctionData('confirmRegistration', [segment, AbiCoder.defaultAbiCoder().encode([saleType, correspondenceType, 'uint64', 'bytes'], [sale, correspondence, 2, '0x5678'])]),
    paid: abi.encodeFunctionData('paySeller', [segment]) };
  const policy = { schema: '8415-agent-task/1', taskId: 'synthetic-receipt', tenant: 'xiongan', origin: 'https://wallet.example.invalid',
    chainId: '560048', actor: a('1'), expiresAt: String(epoch / 1000 + 600), fees: { perOperationWei: '100000', totalWei: '300000' },
    intent: { kind: 'artfi-receipt', handlerId: 'artfi:whole-receipt:v1', escrow: a('5'), runtimeCodeHash: h('8'), segmentId: segment, sale, correspondence,
      phases: Object.keys(data).map((phase, n) => ({ phase, nonce: String(n), calldataHash: keccak256(data[phase]), planDigest: h(String(n + 1)),
        journalBindingHash: h(String(n + 4)), gasLimit: '21000', maxFeePerGasWei: '2', maxPriorityFeePerGasWei: '1' })),
      recovery: { funding: 'once', payout: 'once', unknownOutcome: 'reconcile-only' } } };
  const assertSession = (s, c) => { if (s !== session || state.now >= session.expiresAt || c !== undefined && c?.revision !== 1) throw Error('AUTH_REFUSED'); };
  const service = createTaskAuthorizationService({ origin: policy.origin, tenant: 'xiongan', store, now: () => state.now, assertSession,
    credentialFor: async s => { const c = await store.read('xiongan:tester'); assertSession(s, c); return c; },
    consumeTotp: (s, c, code) => { assertSession(s, c); assert.equal(code, '123456'); return c; },
    assertPrincipal: (p, c) => { if (p.username !== 'tester' || p.account !== a('1') || p.chainId !== '560048' || c?.revision !== 1) throw Error('AUTH_PRINCIPAL_REFUSED'); },
    receiptHandlerId: 'artfi:whole-receipt:v1',
    executorIdentity: { schema: '8415-task-executor/1', agentId: 'synthetic-receipt', agentVersion: '1', adapterId: 'artfi:whole-receipt:v1', adapterVersion: '1', implementationDigest: h('9') } });
  const runtime = createTaskReceiptRuntime({ store, journalStore, peerId: PEER, consumerPeerId: CONSUMER,
    digest: sha, nativeDigest: sha, now: () => state.now });
  const authority = runtime.connectAuthorization(service.receiptAuthorization);
  const call = (path, body) => service.handler('tasks/' + path, body, session);
  async function grant() {
    const c = await call('prepare', { policy });
    return call('authorize', { challengeId: c.challengeId, taskDigest: c.task.digest, executorDigest: c.executor.digest, observationPolicyDigest: null, code: '123456' });
  }
  function operation(g, phase) {
    const p = g.task.policy.intent.phases.find(p => p.phase === phase);
    return { claimed: { taskId: g.task.policy.taskId, taskDigest: g.task.digest, executorDigest: g.executor.digest,
        grantReference: g.authorization.reference, grantPolicyVersion: g.authorization.grantPolicyVersion,
        operationId: 'receipt-' + phase, phase, planDigest: p.planDigest, journalBindingHash: p.journalBindingHash },
      wire: { account: a('1'), chainId: '560048', to: a('5'), data: data[phase], value: '0', nonce: p.nonce,
        gasLimit: p.gasLimit, maxFeePerGasWei: p.maxFeePerGasWei, maxPriorityFeePerGasWei: p.maxPriorityFeePerGasWei } };
  }
  /** The journal request the ArtFi consumer would make for this exact phase. */
  function journalScope(g, phase, action) {
    const claimed = operation(g, phase).claimed;
    const principal = { kind: 'task', taskId: claimed.taskId, taskDigest: claimed.taskDigest, executorDigest: claimed.executorDigest,
      grantReference: claimed.grantReference, grantPolicyVersion: claimed.grantPolicyVersion, operationId: claimed.operationId };
    const { kind, ...binding } = principal;
    const id = `native_${sha(binding)}`;
    const plan = { id: 'native-plan-' + phase, operationId: id, taskPrincipal: principal };
    const operationBody = action === 'get' ? { id } : { id, plan, chainId: 560048, wallet: a('1') };
    return { peerId: PEER, principal, action, nativeOperationId: id,
      planDigest: action === 'get' ? '' : sha(plan), requestDigest: sha({ action, operation: operationBody }), operation: operationBody };
  }
  const send = (g, phase, callback = async () => h('a')) => {
    const x = operation(g, phase);
    return authority.withAuthorization(x.claimed, x.wire, callback);
  };
  return { state, store, journalStore, session, policy, service, runtime, authority, call, grant, operation, journalScope, send };
}

test('a receipt send runs inside the journal held gate and issues a one-use capability', async () => {
  const f = fixture(), g = await f.grant();
  let inGate = false, claim = null;
  await f.send(g, 'funded', async () => {
    inGate = f.runtime.inHeldGate();
    await f.runtime.withCapability(f.journalScope(g, 'funded', 'update'), async capability => {
      const request = f.journalScope(g, 'funded', 'update');
      claim = f.runtime.consumeCapability({ capability, peerId: PEER, action: 'update',
        nativeOperationId: request.nativeOperationId, planDigest: request.planDigest, requestDigest: request.requestDigest }, CONSUMER);
    });
    return h('a');
  });
  assert.equal(inGate, true, 'the receipt action must run inside the held gate');
  assert.equal(claim.action, 'update');
  // The frozen phase commitment travels in the authenticated claim.
  assert.equal(claim.receiptPhase, 'funded');
  assert.equal(claim.receiptNonce, '0');
  assert.equal(claim.receiptPlanDigest, h('1'));
  assert.equal(claim.receiptJournalBindingHash, h('4'));
  assert.equal(claim.principal.operationId, 'receipt-funded', 'the principal must name the receipt operation, not a listing');
  await f.store.close();
});

test('the journal cannot open a receipt gate of its own, so it can never spend an attempt', async () => {
  const f = fixture(), g = await f.grant();
  assert.equal(f.runtime.inHeldGate(), false);
  assert.throws(() => f.runtime.withCapability(f.journalScope(g, 'funded', 'update'), async () => {}),
    /TASK_RECEIPT_JOURNAL_GATE_REQUIRED/);
  const status = await f.call('status', { taskDigest: g.task.digest });
  assert.deepEqual(status.receiptAttempts, [], 'a refused journal call must not record an attempt');
  await f.store.close();
});

test('read-only preparation opens the gate for a journal create without consuming the phase', async () => {
  const f = fixture(), g = await f.grant(), x = f.operation(g, 'funded');
  let created = false;
  await f.authority.withPreparation(x.claimed, 'prepare', async (snapshot, revalidate) => {
    revalidate();
    assert.equal(snapshot.scope.phase, 'funded');
    await f.runtime.withCapability(f.journalScope(g, 'funded', 'create'), async () => { created = true; });
  });
  assert.equal(created, true);
  const status = await f.call('status', { taskDigest: g.task.digest });
  assert.deepEqual(status.receiptAttempts, [], 'preparation must not write an attempt');
  // The phase is still spendable afterwards, exactly once.
  const sent = await f.send(g, 'funded');
  assert.match(sent.transactionHash, /^0x[0-9a-f]{64}$/);
  assert.equal((await f.service.receiptAuthorization.readState(x.claimed)).transactionHash, sent.transactionHash);
  await f.store.close();
});

test('a journal create is refused once the phase has been attempted', async () => {
  const f = fixture(), g = await f.grant(), x = f.operation(g, 'funded');
  await f.send(g, 'funded');
  await assert.rejects(() => f.authority.withPreparation(x.claimed, 'prepare', async () => {}), /TASK_RECEIPT_ALREADY_ATTEMPTED/);
  // Observation of the spent phase stays available for reconciliation.
  let observed = false;
  await f.authority.withPreparation(x.claimed, 'observe', async () => { observed = true; });
  assert.equal(observed, true);
  await f.store.close();
});

test('a second gate is refused from inside a held one instead of deadlocking, and the gate releases on an exception', async () => {
  const f = fixture(), g = await f.grant();
  await assert.rejects(() => f.send(g, 'funded', async () => {
    // Both of these would otherwise wait on the store queue entry their own
    // caller is holding, which never returns.
    assert.throws(() => f.authority.withPreparation(f.operation(g, 'registered').claimed, 'observe', async () => {}),
      /TASK_RECEIPT_GATE_REENTRY_REFUSED/);
    assert.throws(() => f.send(g, 'registered'), /TASK_RECEIPT_GATE_REENTRY_REFUSED/);
    throw Error('SYNTHETIC_ACTION_FAILURE');
  }), /TASK_RECEIPT_OUTCOME_UNKNOWN_RECONCILE_ONLY/);
  assert.equal(f.runtime.inHeldGate(), false, 'the gate must be released after the action throws');
  // The untouched phase is still usable once the failed gate has released.
  assert.match((await f.send(g, 'registered')).transactionHash, /^0x[0-9a-f]{64}$/);
  await f.store.close();
});

test('a capability issued inside a failed action is not consumable afterwards', async () => {
  const f = fixture(), g = await f.grant();
  let escaped = null, request = null;
  await assert.rejects(() => f.send(g, 'funded', async () => {
    request = f.journalScope(g, 'funded', 'update');
    await f.runtime.withCapability(request, async capability => { escaped = capability; });
    throw Error('SYNTHETIC_ACTION_FAILURE');
  }), /TASK_RECEIPT_OUTCOME_UNKNOWN_RECONCILE_ONLY/);
  assert.equal(typeof escaped, 'string');
  assert.throws(() => f.runtime.consumeCapability({ capability: escaped, peerId: PEER, action: 'update',
    nativeOperationId: request.nativeOperationId, planDigest: request.planDigest, requestDigest: request.requestDigest }, CONSUMER),
  /TASK_JOURNAL_CAPABILITY_REFUSED/);
  await f.store.close();
});

test('concurrent phase sends serialize on the store gate and each keeps its own held snapshot', async () => {
  const f = fixture(), g = await f.grant();
  const seen = [];
  const results = await Promise.all(['funded', 'registered'].map(phase => f.send(g, phase, async snapshot => {
    seen.push(snapshot.scope.phase);
    assert.equal(f.runtime.inHeldGate(), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(snapshot.scope.phase, phase, 'a concurrent send must not observe another phase snapshot');
    return h(phase === 'funded' ? 'a' : 'b');
  })));
  assert.deepEqual(results.map(r => r.phase), ['funded', 'registered']);
  assert.deepEqual(seen.sort(), ['funded', 'registered']);
  const status = await f.call('status', { taskDigest: g.task.digest });
  assert.deepEqual(status.receiptAttempts.map(r => r.status), ['submitted', 'submitted']);
  await f.store.close();
});

test('a repeated send for the same phase is refused and the journal gate is not opened again', async () => {
  const f = fixture(), g = await f.grant();
  await f.send(g, 'funded');
  let reopened = false;
  await assert.rejects(() => f.send(g, 'funded', async () => { reopened = true; return h('a'); }), /TASK_RECEIPT_ALREADY_ATTEMPTED/);
  assert.equal(reopened, false);
  await f.store.close();
});

test('a revoked grant opens no new gate, while observation for reconciliation still does', async () => {
  const f = fixture(), g = await f.grant(), x = f.operation(g, 'funded');
  await f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' });
  // No journal plan may be created and no send may be dispatched any more.
  await assert.rejects(() => f.authority.withPreparation(x.claimed, 'prepare', async () => {}));
  let dispatched = false;
  await assert.rejects(() => f.send(g, 'funded', async () => { dispatched = true; return h('a'); }));
  assert.equal(dispatched, false, 'a revoked grant must not reach the action');
  // Read-only observation of the revoked grant keeps working, inside the gate.
  let observedInGate = false;
  await f.authority.withPreparation(x.claimed, 'observe', async (snapshot, revalidate) => {
    revalidate(); observedInGate = f.runtime.inHeldGate();
    assert.equal(snapshot.scope.phase, 'funded');
  });
  assert.equal(observedInGate, true);
  await f.store.close();
});

test('a capability stops being consumable as soon as its gate ends', async () => {
  const f = fixture(), g = await f.grant();
  let capability = null, request = null;
  await f.authority.withPreparation(f.operation(g, 'funded').claimed, 'prepare', async () => {
    request = f.journalScope(g, 'funded', 'create');
    await f.runtime.withCapability(request, async issued => { capability = issued; });
  });
  assert.equal(typeof capability, 'string');
  assert.throws(() => f.runtime.consumeCapability({ capability, peerId: PEER, action: 'create',
    nativeOperationId: request.nativeOperationId, planDigest: request.planDigest, requestDigest: request.requestDigest }, CONSUMER),
  /TASK_JOURNAL_CAPABILITY_REFUSED/);
  await f.store.close();
});

test('the journal store may not be the grant store, and a second connection is refused', async () => {
  const f = fixture();
  assert.throws(() => createTaskReceiptRuntime({ store: f.store, journalStore: f.store, peerId: PEER,
    consumerPeerId: CONSUMER, digest: sha, nativeDigest: sha }), /TASK_RECEIPT_STORE_REENTRY_REFUSED/);
  assert.throws(() => f.runtime.connectAuthorization(f.service.receiptAuthorization), /TASK_RECEIPT_AUTHORIZATION_CONNECTION_REFUSED/);
  const partial = createTaskReceiptRuntime({ store: f.store, journalStore: f.journalStore, peerId: PEER,
    consumerPeerId: CONSUMER, digest: sha, nativeDigest: sha });
  assert.throws(() => partial.connectAuthorization({ withAuthorization() {} }), /TASK_RECEIPT_AUTHORIZATION_CONNECTION_REFUSED/);
  partial.stop();
  await f.store.close();
});

test('a disabled receipt runtime refuses every capability path', async () => {
  const disabled = disabledTaskReceiptRuntime();
  assert.equal(disabled.state, 'disabled');
  assert.equal(disabled.inHeldGate(), false);
  assert.throws(() => disabled.withCapability({}, () => {}), /TASK_RECEIPT_NOT_CONFIGURED/);
  assert.throws(() => disabled.consumeCapability({}, CONSUMER), /TASK_RECEIPT_NOT_CONFIGURED/);
  assert.throws(() => disabled.connectAuthorization({}), /TASK_RECEIPT_NOT_CONFIGURED/);
});

for (const gate of ['withPreparation', 'withAuthorization']) {
  test(`${gate} keeps the validated journal binding when the caller mutates its claim`, async () => {
    const f = fixture(), g = await f.grant(), x = f.operation(g, 'funded');
    const original = structuredClone(x.claimed);
    let consumed = false;
    const action = async () => {
      const request = f.journalScope(g, 'funded', 'get');
      // A self-consistent journal request for the substituted principal must
      // still be refused, even though the caller changed its original claim.
      const forged = structuredClone(request);
      for (const key of ['grantReference', 'grantPolicyVersion', 'operationId']) {
        forged.principal[key] = x.claimed[key];
      }
      const { kind, ...binding } = forged.principal;
      forged.nativeOperationId = `native_${sha(binding)}`;
      forged.operation.id = forged.nativeOperationId;
      forged.requestDigest = sha({ action: 'get', operation: forged.operation });
      await assert.rejects(() => f.runtime.withCapability(forged, async () => {}), /TASK_JOURNAL_PRINCIPAL_REFUSED/);
      await f.runtime.withCapability(request, async capability => {
        const claim = f.runtime.consumeCapability({ capability, peerId: PEER, action: 'get',
          nativeOperationId: request.nativeOperationId, planDigest: '', requestDigest: request.requestDigest }, CONSUMER);
        for (const key of ['grantReference', 'grantPolicyVersion', 'operationId']) {
          assert.equal(claim.principal[key], original[key]);
        }
        consumed = true;
      });
      return h('a');
    };
    const pending = gate === 'withPreparation'
      ? f.authority.withPreparation(x.claimed, 'prepare', action)
      : f.authority.withAuthorization(x.claimed, x.wire, action);
    // Both authority methods have cloned the binding and suspended at their
    // first await; the runtime must never read this caller-owned object again.
    Object.assign(x.claimed, { grantReference: 'substituted-reference', grantPolicyVersion: '999', operationId: 'substituted-operation' });
    await pending;
    assert.equal(consumed, true);
    const state = await f.authority.readState(original);
    assert.equal(state.status, gate === 'withPreparation' ? 'not-attempted' : 'submitted');
    await f.store.close();
  });

  test(`${gate} refuses readState reentry without blocking subsequent reads`, async () => {
    const f = fixture(), g = await f.grant(), x = f.operation(g, 'funded');
    const action = async () => {
      assert.throws(() => f.authority.readState(x.claimed), /TASK_RECEIPT_GATE_REENTRY_REFUSED/);
      return h('a');
    };
    if (gate === 'withPreparation') await f.authority.withPreparation(x.claimed, 'prepare', action);
    else await f.authority.withAuthorization(x.claimed, x.wire, action);
    assert.equal(f.runtime.inHeldGate(), false);
    const state = await f.authority.readState(x.claimed);
    assert.equal(state.status, gate === 'withPreparation' ? 'not-attempted' : 'submitted');
    await f.store.close();
  });
}
