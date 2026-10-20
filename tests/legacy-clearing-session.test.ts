import test from 'node:test';
import assert from 'node:assert/strict';
import { LegacyClearingSession, legacyTradeKey, parseLegacyClearingDeployment, parseLegacyClearingState,
  type LegacyClearingDeployment, type LegacyClearingState, type LegacyClearingStore } from '../src/wallet/legacyClearingSession.ts';
import { encodeCall, encodeWords } from '../src/codec/abi.ts';
import { hashControlBytes } from '../src/controls/authorization.ts';
import { keccak256Utf8 } from '../src/codec/keccak.ts';
const seller = `0x${'a'.repeat(40)}`, buyer = `0x${'b'.repeat(40)}`, escrow = `0x${'c'.repeat(40)}`, projection = `0x${'d'.repeat(40)}`;
const localId = `0x${'5'.repeat(64)}`, key = legacyTradeKey(seller, localId), blockHash = `0x${'6'.repeat(64)}`, txHash = `0x${'7'.repeat(64)}`;
const zero = `0x${'0'.repeat(64)}`, zeroAddress = `0x${'0'.repeat(40)}`, registerId = `0x${'8'.repeat(64)}`, profile = `0x${'9'.repeat(64)}`;
const deployment: LegacyClearingDeployment = { schema: '8415-legacy-clearing/1', chainId: '31337', escrow: { address: escrow, runtimeCodeHash: hashControlBytes('0x6000') },
  projection: { address: projection, runtimeCodeHash: hashControlBytes('0x6001') }, registerId, verificationProfile: profile };
const open = (kind = 'open') => JSON.stringify({ kind, localId, tokenId: '1', buyer, priceWei: '1000', admissionDeadline: '1200', maxEffectiveAt: '1100' });
function fixture(actor = seller) {
  const flags = { state: 0n, approved: true, operator: false, confirmed: false, now: 1000n, selected: actor, chain: '0x7a69',
    projectionCode: '0x6001', register: registerId, settlement: true, interface: true, invalidInterface: false, reject: null as unknown,
    releaseSchema: 'legacy', releaseCommitment: profile, releaseDataMismatch: false,
    includePositions: false, successorOrder: 'after', wrongSuccessorEntry: false, duplicateSuccessor: false, revertedAdmission: false,
    observationVersion: 0n, observedHolder: null as string | null,
    failReserve: false, failReset: false, failSubmitted: false, omitEvent: false, wrongTx: false, pending: false, receiptStatus: '0x1', reorg: false, nonce: 0n, owner: seller, rpcCase: false, replacement: false, wrongNonce: false, head: '0x65' };
  let record: LegacyClearingState | null = null, sends = 0, sent: Record<string, string> | null = null, method = '';
  const store: LegacyClearingStore = { async read() { return structuredClone(record); }, async compareAndSwap(expected, next) {
    if (next.status === 'outcome-unknown' && flags.failReserve || next.status === 'idle' && next.revision > 0 && flags.failReset || next.status === 'submitted' && flags.failSubmitted) return false;
    if ((record?.revision ?? null) !== expected) return false; record = parseLegacyClearingState(JSON.stringify(next)); return true;
  } };
  const provider = { async request({ method: name, params = [] }: { method: string; params?: readonly unknown[] }): Promise<unknown> {
    if (name === 'eth_chainId') return flags.chain;
    if (name === 'eth_accounts') return [flags.rpcCase ? flags.selected.slice(0, 2) + flags.selected.slice(2, 3).toUpperCase() + flags.selected.slice(3) : flags.selected];
    if (name === 'eth_getCode') return params[0] === escrow ? '0x6000' : params[0] === projection ? flags.projectionCode : '0x';
    if (name === 'eth_getBlockByNumber') return { number: '0x64', hash: flags.reorg ? registerId : blockHash, timestamp: `0x${flags.now.toString(16)}` };
    if (name === 'eth_blockNumber') return flags.head;
    if (name === 'eth_getTransactionCount') return `0x${flags.nonce.toString(16)}`;
    if (name === 'eth_estimateGas') return '0x100000';
    if (name === 'eth_call') {
      const data = (params[0] as { data: string }).data;
      if (data.startsWith(encodeCall('tradeOf(bytes32)', ['bytes32'], [key]).slice(0, 10))) return encodeWords(
        ['address', 'uint256', 'address', 'address', 'uint256', 'uint64', 'uint64', 'uint64', 'uint8'],
        flags.state === 0n ? [zeroAddress, 0n, zeroAddress, zeroAddress, 0n, 0n, 0n, 0n, 0n] : [projection, 1n, seller, buyer, 1000n, flags.state === 1n ? 0n : 1n, 1200n, 1100n, flags.state]);
      if (data.startsWith(encodeCall('observe(bytes32)', ['bytes32'], [key]).slice(0, 10))) return encodeWords(
        ['uint8', 'bool', 'uint64', 'uint64', 'address', 'address', 'uint64'], [flags.state, flags.confirmed, flags.observationVersion || (flags.confirmed ? 2n : 1n), 1050n, flags.observedHolder ?? (flags.confirmed ? buyer : seller), escrow, flags.observationVersion || (flags.confirmed ? 2n : 1n)]);
      if (data === encodeCall('supportsInterface(bytes4)', ['bytes4'], ['0xffffffff'])) return encodeWords(['bool'], [flags.invalidInterface]);
      if (data === encodeCall('supportsInterface(bytes4)', ['bytes4'], ['0xf4a7d71b'])) return encodeWords(['bool'], [flags.settlement]);
      if (data.startsWith('0x01ffc9a7')) return encodeWords(['bool'], [flags.interface]);
      if (data === encodeCall('registerId()', [], [])) return flags.register;
      if (data === encodeCall('verificationProfile()', [], [])) return profile;
      if (data === encodeCall('ownerOf(uint256)', ['uint256'], [1n])) return encodeWords(['address'], [flags.owner]);
      if (data === encodeCall('getApproved(uint256)', ['uint256'], [1n])) return encodeWords(['address'], [flags.approved ? escrow : zeroAddress]);
      if (data === encodeCall('isApprovedForAll(address,address)', ['address', 'address'], [seller, escrow])) return encodeWords(['bool'], [flags.operator]);
      if (flags.includePositions && data === encodeCall('entryAt(uint256,uint64)', ['uint256', 'uint64'], [1n, 2n])) {
        assert.equal(params[1], '0x64');
        return encodeWords(['bytes32', 'bytes32', 'bytes32', 'address', 'uint64', 'uint64', 'uint64'],
          [flags.wrongSuccessorEntry ? localId : profile, zero, registerId, buyer, 2n, 1050n, 1060n]);
      }
      if (flags.includePositions && data === encodeCall('entryAt(uint256,uint64)', ['uint256', 'uint64'], [1n, 3n])) {
        assert.equal(params[1], '0x64');
        return encodeWords(['bytes32', 'bytes32', 'bytes32', 'address', 'uint64', 'uint64', 'uint64'],
          [registerId, profile, registerId, seller, 3n, 1060n, 0n]);
      }
      throw new Error(`unhandled call ${data}`);
    }
    if (name === 'eth_sendTransaction') { sends++; sent = params[0] as Record<string, string>;
      method = ['approve', 'open', 'fund', 'release', 'refund', 'abandon'].find(k => sent!.data!.startsWith(k === 'approve' ? encodeCall('approve(address,uint256)', ['address', 'uint256'], [escrow, 1n]).slice(0, 10) : k === 'open' ? encodeCall('open(bytes32,address,uint256,address,uint256,uint64,uint64)', ['bytes32', 'address', 'uint256', 'address', 'uint256', 'uint64', 'uint64'], [localId, projection, 1n, buyer, 1000n, 1200n, 1100n]).slice(0, 10) : encodeCall(`${k}(bytes32)`, ['bytes32'], [key]).slice(0, 10)))!;
      assert.equal(record?.status, 'outcome-unknown'); if (flags.reject) throw flags.reject; return txHash; }
    const releaseIndex = flags.includePositions && flags.successorOrder === 'before' ? '0x1' : '0x0';
    const admissionIndex = flags.successorOrder === 'before' ? '0x0' : '0x1';
    const successorLog = { address: projection, transactionHash: localId, blockHash, blockNumber: '0x64', transactionIndex: admissionIndex,
      logIndex: flags.successorOrder === 'before' ? '0x0' : '0x2', removed: false,
      topics: [keccak256Utf8('RegisterSuperseded(uint256,uint64,bytes32,bytes32,address,uint64)'), encodeWords(['uint256'], [1n]), encodeWords(['uint64'], [3n]), registerId],
      data: encodeWords(['bytes32', 'address', 'uint64'], [profile, seller, 1060n]) };
    if (name === 'eth_getLogs' && flags.includePositions) {
      assert.deepEqual(params, [{ address: projection, blockHash, topics: [successorLog.topics[0], successorLog.topics[1], successorLog.topics[2]] }]);
      return flags.duplicateSuccessor ? [successorLog, successorLog] : [successorLog];
    }
    if (name === 'eth_getTransactionByHash') return { ...sent, from: flags.wrongTx ? buyer : actor, nonce: flags.wrongNonce ? '0xff' : sent!.nonce, input: flags.replacement ? '0x' : sent!.data, hash: txHash, blockHash, blockNumber: '0x64', transactionIndex: releaseIndex };
    if (name === 'eth_getTransactionReceipt') {
      if (flags.pending) return null;
      if (params[0] === localId && flags.includePositions) return { status: flags.revertedAdmission ? '0x0' : '0x1', transactionHash: localId,
        blockHash, blockNumber: '0x64', transactionIndex: admissionIndex, logs: [successorLog] };
      const addressWord = (a: string) => encodeWords(['address'], [a]);
      const events: Record<string, { topics: string[]; data: string }> = {
        approve: { topics: [keccak256Utf8('Approval(address,address,uint256)'), addressWord(seller), addressWord(escrow), encodeWords(['uint256'], [1n])], data: '0x' },
        open: { topics: [keccak256Utf8('TradeOpened(bytes32,bytes32,address,uint256,address,address,uint256,uint64,uint64)'), key, localId, addressWord(projection)], data: encodeWords(['uint256', 'address', 'address', 'uint256', 'uint64', 'uint64'], [1n, seller, buyer, 1000n, 1200n, 1100n]) },
        fund: { topics: [keccak256Utf8('TradeFunded(bytes32,address,uint256,uint64)'), key, addressWord(buyer)], data: encodeWords(['uint256', 'uint64'], [1000n, 1n]) },
        release: { topics: [keccak256Utf8('TradeReleased(bytes32,address,uint64,uint64)'), key, addressWord(buyer)], data: encodeWords(['uint64', 'uint64'], [2n, 1050n]) },
        refund: { topics: [keccak256Utf8('TradeRefunded(bytes32,address,uint64)'), key, addressWord(buyer)], data: encodeWords(['uint64'], [1n]) },
        abandon: { topics: [keccak256Utf8('TradeAbandoned(bytes32,address)'), key, addressWord(seller)], data: '0x' },
      };
      if (flags.releaseSchema === 'committed') events.release = {
        topics: [keccak256Utf8('TradeReleased(bytes32,address,uint64,uint64,bytes32)'), key, addressWord(buyer)],
        data: encodeWords(['uint64', 'uint64', 'bytes32'], [2n, 1050n, flags.releaseCommitment]),
      };
      if (flags.releaseDataMismatch) events.release!.data = flags.releaseSchema === 'committed'
        ? encodeWords(['uint64', 'uint64'], [2n, 1050n])
        : encodeWords(['uint64', 'uint64', 'bytes32'], [2n, 1050n, profile]);
      return { transactionHash: txHash, blockHash, blockNumber: '0x64', transactionIndex: releaseIndex, from: actor, to: sent!.to, status: flags.receiptStatus,
        logs: flags.omitEvent ? [] : [{ ...events[method], address: sent!.to, transactionHash: txHash, blockHash, blockNumber: '0x64', transactionIndex: releaseIndex, removed: false,
          ...(flags.includePositions ? { logIndex: '0x0' } : {}) }] };
    }
    throw new Error(`unhandled ${name}`);
  } };
  return { flags, provider, store, session: () => new LegacyClearingSession(provider, deployment, actor, store), sends: () => sends, record: () => record };
}

// The actual session, not the test, constructs before/after classification from
// canonical receipt metadata, bounded logs and independently decoded entries.
for (const order of ['after', 'before']) test(`same-block ${order}: session wires receipt and entry provenance into product view`, async () => {
  const f = fixture(), s = f.session();
  Object.assign(f.flags, { state: 2n, confirmed: true, releaseSchema: 'committed', includePositions: true, successorOrder: order });
  const review = await s.prepare(JSON.stringify({ kind: 'release', tradeKey: key }));
  await s.submit(review, review.digest);
  Object.assign(f.flags, { state: order === 'after' ? 3n : 2n, confirmed: false, observationVersion: 3n, observedHolder: seller,
    receiptStatus: order === 'after' ? '0x1' : '0x0' });
  const result = await s.observe(key);
  assert.equal(result.view.releaseOrdering.classification, order === 'after' ? 'superseded-after-release' : 'superseded-before-release-attempt');
  assert.equal(result.view.confirmingVersion, order === 'after' ? 2n : undefined);
  assert.equal(result.view.confirmingRecordCommitment, order === 'after' ? profile : undefined);
  assert.equal(result.view.releaseOrdering.evidence?.attempt.basisSource, order === 'after' ? 'release-event' : 'prepared-observation');
  assert.equal(result.view.releaseOrdering.evidence?.supersession?.source, 'canonical-receipt-and-entry');
  assert.equal(f.sends(), 1, 'Provenance reads cannot submit or replay a transaction');
  assert.equal((await s.status()).status, 'submitted', 'Presentation cannot release the durable journal');
});

for (const failure of ['wrongSuccessorEntry', 'duplicateSuccessor', 'revertedAdmission'] as const)
  test(`same-block invalid ${failure} remains unknown without losing actual release evidence`, async () => {
    const f = fixture(), s = f.session();
    Object.assign(f.flags, { state: 2n, confirmed: true, releaseSchema: 'committed', includePositions: true });
    const review = await s.prepare(JSON.stringify({ kind: 'release', tradeKey: key })); await s.submit(review, review.digest);
    Object.assign(f.flags, { state: 3n, confirmed: false, observationVersion: 3n }); f.flags[failure] = true;
    const result = await s.observe(key);
    assert.equal(result.view.releaseOrdering.classification, 'unknown');
    assert.equal(result.view.confirmingVersion, 2n); assert.equal(result.view.confirmingRecordCommitment, profile);
    assert.equal(f.sends(), 1); assert.equal((await s.status()).status, 'submitted');
  });
for (const kind of ['approve', 'open', 'fund', 'release', 'refund', 'abandon']) test(`legacy ${kind}: read/review, durable owner send, bound event receipt and acknowledgement`, async () => {
  const f = fixture(kind === 'fund' ? buyer : seller), s = f.session();
  f.flags.state = ['fund', 'abandon'].includes(kind) ? 1n : ['release', 'refund'].includes(kind) ? 2n : 0n;
  f.flags.confirmed = kind === 'release'; f.flags.approved = kind !== 'approve'; if (kind === 'refund') f.flags.now = 1201n;
  const r = await s.prepare(['approve', 'open'].includes(kind) ? open(kind) : JSON.stringify({ kind, tradeKey: key }));
  assert.equal(f.sends(), 0); assert.equal(r.transaction.value, kind === 'fund' ? '0x3e8' : '0x0');
  await assert.rejects(s.submit(r, zero), /OWNER_REVIEW_REQUIRED/); assert.equal(f.sends(), 0);
  await s.submit(r, r.digest); assert.equal(f.sends(), 1); assert.equal((await f.session().status()).status, 'submitted');
  assert.equal((await s.reconcile()).state, 'confirmed'); await s.acknowledge(); assert.equal((await s.status()).status, 'idle');
});
test('all encoders work without Buffer and agree with namespaced key', async () => {
  const buffer = globalThis.Buffer;
  try { (globalThis as any).Buffer = undefined; assert.equal(legacyTradeKey(seller, localId), key); assert.equal((await fixture().session().prepare(open())).tradeKey, key); }
  finally { globalThis.Buffer = buffer; }
});
test('open requires exact existing approval; approval has no operator-for-all path', async () => {
  const f = fixture(); f.flags.approved = false;
  await assert.rejects(f.session().prepare(open()), /TOKEN_APPROVAL_REQUIRED/);
  const r = await f.session().prepare(open('approve')); assert.equal(r.transaction.data, encodeCall('approve(address,uint256)', ['address', 'uint256'], [escrow, 1n]));
  f.flags.owner = buyer; await assert.rejects(f.session().prepare(open('approve')), /SELLER_NOT_OWNER/); assert.equal(f.sends(), 0);
});
test('projection discovery, immutable identity, chain and runtime pins fail closed', async () => {
  for (const changes of [{ projectionCode: '0x6002' }, { interface: false }, { invalidInterface: true }, { register: profile }, { settlement: false }, { chain: '0x1' }, { selected: buyer }]) {
    const f = fixture(); Object.assign(f.flags, changes); await assert.rejects(f.session().prepare(open())); assert.equal(f.sends(), 0);
  }
});
test('late confirmation prevents refund; deadline equality is not expiry; release needs actual condition', async () => {
  const f = fixture(); f.flags.state = 2n; const s = f.session();
  f.flags.now = 1200n; await assert.rejects(s.prepare(JSON.stringify({ kind: 'refund', tradeKey: key })), /REFUND_UNAVAILABLE/);
  f.flags.now = 1201n; f.flags.confirmed = true; await assert.rejects(s.prepare(JSON.stringify({ kind: 'refund', tradeKey: key })), /REFUND_UNAVAILABLE/);
  await s.prepare(JSON.stringify({ kind: 'release', tradeKey: key }));
  f.flags.confirmed = false; await assert.rejects(s.prepare(JSON.stringify({ kind: 'release', tradeKey: key })), /RELEASE_UNAVAILABLE/);
  const observation = await s.observe(key); assert.equal(observation.view.state, 'deadline-passed'); assert.match(observation.notes, /provisional/);
  assert.notEqual(observation.observation.positionHolder, observation.observation.confirmedHolder); assert.equal(f.sends(), 0);
});
test('arbitrary calls, unknown fields, mainnet and unsafe numbers are refused', async () => {
  for (const text of [JSON.stringify({ kind: 'call', tradeKey: key }), JSON.stringify({ ...JSON.parse(open()), data: '0xdeadbeef' }),
    JSON.stringify({ ...JSON.parse(open()), tokenId: '1.0' }), JSON.stringify({ ...JSON.parse(open()), admissionDeadline: (1n << 64n).toString() })])
    await assert.rejects(fixture().session().prepare(text));
  assert.throws(() => parseLegacyClearingDeployment({ ...deployment, chainId: '1' }), /TESTNET_REQUIRED/);
});
test('changed nonce/terms and expired review never reach send', async () => {
  for (const change of [{ nonce: 1n }, { now: 1400n }]) {
    const f = fixture(), s = f.session(), r = await s.prepare(open()); Object.assign(f.flags, change);
    await assert.rejects(s.submit(r, r.digest)); assert.equal(f.sends(), 0);
  }
});
test('failed durable reservation and cross-session concurrent send cannot send twice', async () => {
  const f = fixture(), s = f.session(), r = await s.prepare(open()); await s.status(); f.flags.failReserve = true;
  await assert.rejects(s.submit(r, r.digest), /OPERATION_CONCURRENT/); assert.equal(f.sends(), 0);
  f.flags.failReserve = false;
  const results = await Promise.allSettled([s.submit(r, r.digest), f.session().submit(r, r.digest)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.sends(), 1);
});
test('standard numeric 4001 clears only the exact send reservation and permits new review', async () => {
  const f = fixture(), s = f.session(), r = await s.prepare(open()); f.flags.reject = { code: 4001, message: 'private diagnostics' };
  await assert.rejects(s.submit(r, r.digest), /CONTROL_PROVIDER_REQUEST_REJECTED/); assert.equal((await s.status()).status, 'idle');
  f.flags.reject = null; const next = await s.prepare(open()); await s.submit(next, next.digest); assert.equal(f.sends(), 2);
});
test('failed rejection persistence stays locked and is not reported as safe cancellation', async () => {
  const f = fixture(), s = f.session(), r = await s.prepare(open()); f.flags.reject = { code: 4001 }; f.flags.failReset = true;
  await assert.rejects(s.submit(r, r.digest), /CLEARING_REJECTION_PERSISTENCE_UNCERTAIN/); assert.equal((await s.status()).status, 'outcome-unknown');
});
for (const error of [new Error('private endpoint'), { code: '4001' }, { data: { code: 4001 } }]) test('ambiguous provider outcome remains locked across reload and never resends', async () => {
  const f = fixture(), s = f.session(), r = await s.prepare(open()); f.flags.reject = error;
  await assert.rejects(s.submit(r, r.digest), /OUTCOME_UNCERTAIN/); assert.equal((await f.session().status()).status, 'outcome-unknown');
  await assert.rejects(f.session().submit(r, r.digest), /RECONCILIATION_REQUIRED/); assert.equal(f.sends(), 1);
  f.flags.reject = null; assert.equal((await f.session().recover(txHash)).state, 'confirmed'); await f.session().acknowledge(); assert.equal(f.sends(), 1);
});
test('missing event, mismatched sender, pending receipt and reorg cannot unlock', async () => {
  for (const change of [{ omitEvent: true }, { wrongTx: true }, { pending: true }, { reorg: true }]) {
    const f = fixture(), s = f.session(), r = await s.prepare(open()); await s.submit(r, r.digest); Object.assign(f.flags, change);
    await assert.rejects(s.acknowledge()); assert.equal((await s.status()).status, 'submitted'); assert.equal(f.sends(), 1);
  }
});
test('canonical reverted receipt can be acknowledged but is never called success', async () => {
  const f = fixture(), s = f.session(), r = await s.prepare(open()); await s.submit(r, r.digest); f.flags.receiptStatus = '0x0'; f.flags.omitEvent = true;
  assert.equal((await s.reconcile()).state, 'reverted'); await s.acknowledge(); assert.equal((await s.status()).status, 'idle');
});
test('saved unknown operation cannot be hidden behind a different deployment file', async () => {
  const f = fixture(), s = f.session(), r = await s.prepare(open()); f.flags.reject = new Error('unavailable'); await assert.rejects(s.submit(r, r.digest));
  const other = new LegacyClearingSession(f.provider, { ...deployment, registerId: profile }, seller, f.store);
  await assert.rejects(other.status(), /SAVED_DEPLOYMENT_REQUIRED/);
});

test('raw EIP-1193 mixed-case address bytes need not carry an EIP-55 input checksum', async () => {
  const f = fixture(), s = f.session(); f.flags.rpcCase = true; await s.verify(); const r = await s.prepare(open()); await s.submit(r, r.digest); assert.equal(f.sends(), 1);
});
test('explicit canonical wallet replacement clears the old intent without claiming success or resending', async () => {
  const f = fixture(), s = f.session(), r = await s.prepare(open()); f.flags.reject = new Error('unknown'); await assert.rejects(s.submit(r, r.digest));
  f.flags.replacement = true;
  assert.deepEqual(await f.session().acknowledgeReplacement(txHash), { originalOutcome: 'superseded-not-successful', replacementHash: txHash });
  assert.equal((await s.status()).status, 'idle'); assert.equal(f.sends(), 1);
});
test('same intent, wrong nonce, reorg and insufficient replacement confirmations keep reservation locked', async () => {
  for (const changes of [{}, { replacement: true, wrongNonce: true }, { replacement: true, reorg: true }, { replacement: true, head: '0x64' }]) {
    const f = fixture(), s = f.session(), r = await s.prepare(open()); f.flags.reject = new Error('unknown'); await assert.rejects(s.submit(r, r.digest));
    Object.assign(f.flags, changes); await assert.rejects(s.acknowledgeReplacement(txHash)); assert.equal((await s.status()).status, 'outcome-unknown'); assert.equal(f.sends(), 1);
  }
});

for (const schema of ['legacy', 'committed']) test(`release receipt ${schema} ABI preserves only its own recorded fields`, async () => {
  const f = fixture(), s = f.session(); f.flags.state = 2n; f.flags.confirmed = true; f.flags.releaseSchema = schema;
  const review = await s.prepare(JSON.stringify({ kind: 'release', tradeKey: key }));
  await s.submit(review, review.digest);
  const result = await s.reconcile();
  assert.equal(result.state, 'confirmed');
  assert.deepEqual(result.releaseConfirmation, { version: 2n, effectiveAt: 1050n,
    ...(schema === 'committed' ? { recordCommitment: profile } : {}) });
  // Later current observations cannot rewrite the receipt's release evidence.
  f.flags.state = 3n; f.flags.confirmed = false; f.flags.observationVersion = 3n; f.flags.observedHolder = seller;
  const current = await s.observe(key);
  assert.equal(current.observation.version, 3n);
  assert.equal(current.view.confirmingVersion, 2n);
  assert.equal(current.view.confirmingRecordCommitment, schema === 'committed' ? profile : undefined);
  assert.equal(current.view.confirmedHolder, seller);
  assert.equal(f.sends(), 1);
  assert.deepEqual((await s.reconcile()).releaseConfirmation, result.releaseConfirmation);
  await s.acknowledge();
  assert.equal((await s.observe(key)).view.confirmingVersion, undefined);
  assert.equal(f.sends(), 1);
});
for (const schema of ['legacy', 'committed']) test(`release ${schema} topic cannot decode the other ABI's data`, async () => {
  const f = fixture(), s = f.session(); f.flags.state = 2n; f.flags.confirmed = true;
  f.flags.releaseSchema = schema; f.flags.releaseDataMismatch = true;
  const review = await s.prepare(JSON.stringify({ kind: 'release', tradeKey: key }));
  await s.submit(review, review.digest);
  await assert.rejects(s.reconcile(), /CLEARING_RPC_ABI_REFUSED/);
  assert.equal((await s.status()).status, 'submitted');
});
test('new release event with a zero commitment cannot become release evidence', async () => {
  const f = fixture(), s = f.session(); f.flags.state = 2n; f.flags.confirmed = true;
  f.flags.releaseSchema = 'committed'; f.flags.releaseCommitment = zero;
  const review = await s.prepare(JSON.stringify({ kind: 'release', tradeKey: key })); await s.submit(review, review.digest);
  await assert.rejects(s.reconcile(), /CLEARING_HASH_REFUSED/);
});
