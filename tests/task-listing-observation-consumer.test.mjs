import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { createTaskListingObservationConsumer } from '../server/task-listing-observation-consumer.mjs';

const H = value => `0x${value.toString(16).padStart(64, '0')}`;
const binding = () => ({ taskDigest: H(1), childDigest: H(2), chainId: '1', orderHash: H(3), orderDigest: '4'.repeat(64),
  sourceId: 'fixed-reader', observationPolicyId: 'listing-observation', minimumConfirmations: 3, requestedQuantity: '10', orderQuantity: '10' });
const cursor = (next = 13, hash = H(next - 1)) => ({ schema: 'artfi-listed-order-cursor/1', bindingDigest: '5'.repeat(64), nextBlock: next,
  checkpoint: next === 10 ? null : { number: next - 1, hash } });
const fill = (overrides = {}) => ({ kind: 'NFT_SALE_FILL', state: 'CONFIRMED', verified: true, canonical: true, finality: 'NOT_EVALUATED',
  chainId: '1', sourceId: 'fixed-reader', observationPolicyId: 'listing-observation', orderHash: H(3), orderDigest: '4'.repeat(64),
  transactionHash: H(100), blockHash: H(10), blockNumber: 10, fillId: `1:${H(100)}:0`, confirmations: 11,
  observedAt: 1000, evidenceDigest: '6'.repeat(64), quantity: '2', requestedQuantity: '10', orderQuantity: '10',
  gross: '200', fees: '10', sellerNet: '190', paymentToken: `0x${'0'.repeat(40)}`,
  accountingBasis: 'SEAPORT_SUCCESSFUL_NATIVE_CONSIDERATION_V1', sellerNetBasis: 'TOKEN_PROCEEDS_EXCLUDING_GAS',
  authorizationChanged: false, budgetChanged: false, ...overrides });
function observation(fills = [fill()], { next = 13, start = 10, overrides = {}, cursorOverride, status = 'SCANNED' } = {}) {
  return { kind: 'NFT_LISTED_ORDER_OBSERVATION', state: fills.length ? 'CONFIRMED' : 'UNKNOWN', verified: fills.length > 0,
    chainId: '1', sourceId: 'fixed-reader', observationPolicyId: 'listing-observation', orderHash: H(3), orderDigest: '4'.repeat(64),
    fills, nextCursor: cursorOverride ?? cursor(next), scanStatus: status, reason: 'NFT_SALE_OBSERVER_VERIFIED_FILLS',
    scan: { fromBlock: 10, throughBlock: 30, pages: status === 'SCANNED' ? 1 : 0, coverageScope: 'THIS_INVOCATION_ONLY',
      scannedFromBlock: status === 'SCANNED' ? start : null, scannedThroughBlock: status === 'SCANNED' ? next - 1 : null },
    cumulativeCompletion: 'NOT_EVALUATED', onchainOrderStatus: 'NOT_EVALUATED', authorizationChanged: false,
    budgetChanged: false, resendAuthorized: false, ...overrides };
}
function harness({ store = new MemoryCredentialStore(), observe, b = binding() } = {}) {
  const calls = [], observerCalls = [], blocks = new Map(), state = { head: 20, chainId: '0x1', fail: false, at: 1000 };
  const reader = { sourceId: 'fixed-reader', async request(input) {
    calls.push(structuredClone(input));
    if (state.fail) throw Error('offline');
    if (input.method === 'eth_chainId') return state.chainId;
    assert.equal(input.method, 'eth_getBlockByNumber');
    const number = input.params[0] === 'latest' ? state.head : Number(BigInt(input.params[0]));
    return { number: `0x${number.toString(16)}`, hash: blocks.get(number) ?? H(number) };
  } };
  const observed = { async observe(input) { observerCalls.push(structuredClone(input)); return observe ? observe(input) :
    input.cursor ? observation([], { start: input.cursor.nextBlock, next: input.cursor.nextBlock, status: 'NO_NEW_RANGE' }) : observation(); } };
  const make = (more = {}) => createTaskListingObservationConsumer({ store, observer: observed, canonicalReader: reader, binding: b, now: () => state.at, ...more });
  return { consumer: make(), make, store, reader, observed, calls, observerCalls, blocks, state, binding: b };
}
async function record(h) { return (await h.store.readMany([h.consumer.storageKey]))[h.consumer.storageKey]; }
const noMutationFlags = summary => {
  for (const key of ['authorizationChanged', 'budgetChanged', 'quotaChanged', 'resendAuthorized', 'relistAuthorized']) assert.equal(summary[key], false);
  for (const key of ['finality', 'cumulativeCompletion', 'onchainOrderStatus', 'currentOwnership', 'currentBalances', 'usdProceeds']) assert.equal(summary[key], 'NOT_EVALUATED');
};

test('scan uses the captured observer and trusted persisted cursor; read summary revalidates without scanning', async () => {
  const h = harness();
  const first = await h.consumer.scan();
  assert.equal(first.freshness, 'FRESH'); assert.equal(first.saleStatus, 'VERIFIED_FILLS');
  assert.deepEqual(first.aggregate, { quantity: '2', gross: '200', fees: '10', sellerNet: '190' });
  assert.deepEqual(h.observerCalls, [{}]); noMutationFlags(first);
  await h.consumer.scan(); assert.deepEqual(h.observerCalls[1], { cursor: cursor() });
  const before = h.calls.length;
  const summary = await h.consumer.readSummary();
  assert.equal(summary.freshness, 'FRESH'); assert.equal(h.observerCalls.length, 2); assert.ok(h.calls.length > before);
  assert.equal((await record(h)).fills.length, 1);
  assert.ok(h.calls.every(c => ['eth_chainId', 'eth_getBlockByNumber'].includes(c.method)));
});

test('empty scan stays unknown and does not infer unsold, cancellation, expiry, completion, or authority', async () => {
  const h = harness({ observe: () => observation([]) });
  const result = await h.consumer.scan();
  assert.equal(result.freshness, 'FRESH'); assert.equal(result.saleStatus, 'UNKNOWN'); assert.equal(result.aggregate.quantity, '0'); noMutationFlags(result);
});

test('unobserved summary is stale and never returns a fabricated zero verified aggregate', async () => {
  const h = harness(); const result = await h.consumer.readSummary();
  assert.equal(result.freshness, 'STALE'); assert.equal(result.aggregate, null); assert.equal(h.observerCalls.length, 0);
});

test('caller cursor, observation, verified boolean, reader and empty object are all refused', async () => {
  const h = harness();
  for (const input of [{ cursor: cursor(30) }, { observation: observation() }, { verified: true }, { reader: h.reader }, {}]) {
    await assert.rejects(() => h.consumer.scan(input), /TASK_LISTING_CALLER_INPUT_REFUSED/);
    await assert.rejects(() => h.consumer.readSummary(input), /TASK_LISTING_CALLER_INPUT_REFUSED/);
  }
  assert.equal(h.observerCalls.length, 0); assert.equal(h.calls.length, 0);
});

test('fixed dependencies and binding cannot be replaced after construction', async () => {
  const h = harness();
  h.binding.minimumConfirmations = 1; h.binding.orderHash = H(66);
  h.reader.request = () => { throw Error('replacement'); };
  h.observed.observe = () => { throw Error('replacement'); };
  assert.equal((await h.consumer.scan()).aggregate.quantity, '2');
  assert.equal(h.consumer.binding.minimumConfirmations, 3); assert.equal(h.consumer.binding.orderHash, H(3));
  assert.ok(Object.isFrozen(h.consumer.binding));
});

test('durable slot rejects changing order, source, chain, or minimum depth for the same task and child', async () => {
  const h = harness(); await h.consumer.scan();
  for (const change of [{ orderHash: H(7) }, { minimumConfirmations: 1 }, { chainId: '8453' }]) {
    const other = h.make({ binding: { ...binding(), ...change } });
    await assert.rejects(() => other.readSummary(), /TASK_LISTING_STORED_BINDING_REFUSED/);
  }
});

test('duplicates inside one scan count once; stable replay ignores new evidence timestamps', async () => {
  const h = harness({ observe: () => observation([fill(), fill({ observedAt: 2000, evidenceDigest: '7'.repeat(64), confirmations: 12 })]) });
  const summary = await h.consumer.scan();
  assert.equal(summary.aggregate.quantity, '2'); assert.equal(summary.availableFillCount, 1);
});

test('distinct partial fills aggregate exact integer quantity, gross, fees and seller net atomically', async () => {
  const h = harness({ observe: () => observation([fill(), fill({ fillId: `1:${H(101)}:7`, transactionHash: H(101), quantity: '3', gross: '300', fees: '15', sellerNet: '285' })]) });
  assert.deepEqual((await h.consumer.scan()).aggregate, { quantity: '5', gross: '500', fees: '25', sellerNet: '475' });
});

test('conflicting duplicate refuses all entries and cursor movement', async () => {
  const h = harness({ observe: () => observation([fill(), fill({ quantity: '3' })]) });
  const result = await h.consumer.scan();
  assert.equal(result.freshness, 'STALE'); assert.equal(result.aggregate, null); assert.equal(result.reason, 'TASK_LISTING_CONFLICTING_FILL_REFUSED');
  assert.equal((await record(h)).fills.length, 0); assert.equal((await record(h)).cursor, null);
});

test('concurrent scans CAS the durable revision; the losing scan exposes no uncommitted aggregate', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); let entered = 0;
  const h = harness({ observe: async () => { if (++entered === 2) release(); await gate; return observation(); } });
  const summaries = await Promise.all([h.consumer.scan(), h.make().scan()]);
  assert.deepEqual(summaries.map(v => v.freshness).sort(), ['FRESH', 'STALE']);
  assert.equal(summaries.find(v => v.freshness === 'STALE').reason, 'TASK_LISTING_SCAN_CONFLICT');
  assert.equal(summaries.find(v => v.freshness === 'STALE').aggregate, null);
  const saved = await record(h); assert.equal(saved.revision, 1); assert.equal(saved.fills.length, 1); assert.equal(saved.aggregate.quantity, '2');
});

test('encrypted restart recovers persisted cursor and fill deduplication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'listing-consumer-')), file = join(dir, 'store.json'), key = Buffer.alloc(32, 0x42);
  let store;
  try {
    store = await openEncryptedStore(file, key); const first = harness({ store }); await first.consumer.scan(); await store.close();
    store = await openEncryptedStore(file, key); const second = harness({ store });
    const result = await second.consumer.scan();
    assert.deepEqual(second.observerCalls, [{ cursor: cursor() }]); assert.equal(result.aggregate.quantity, '2'); assert.equal(result.availableFillCount, 1);
    await store.close(); store = null;
  } finally { if (store) await store.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); }
});

test('persist failure never reports aggregate or commits cursor; existing store is unhealthy thereafter', async () => {
  class FailingStore extends MemoryCredentialStore { async persist() { throw Error('synthetic disk failure'); } }
  const h = harness({ store: new FailingStore() });
  await assert.rejects(() => h.consumer.scan(), /synthetic disk failure/);
  await assert.rejects(() => h.consumer.readSummary(), /AUTH_STORE_UNHEALTHY/);
});

test('same task/child reorg invalidates old block, withdraws aggregate, and resumes from server-owned initial cursor', async () => {
  const h = harness(); await h.consumer.scan();
  h.blocks.set(10, H(500));
  const stale = await h.consumer.readSummary();
  assert.equal(stale.freshness, 'STALE'); assert.equal(stale.aggregate, null); assert.equal(stale.invalidatedFillCount, 1);
  const saved = await record(h); assert.equal(saved.cursor, null); assert.equal(saved.needsRescan, true); assert.equal(saved.aggregate.quantity, '0');
  assert.deepEqual(saved.invalidatedAnchors, [{ number: 10, hash: H(10) }]);
  assert.equal((await h.consumer.readSummary()).reason, 'TASK_LISTING_RECONCILIATION_REQUIRED');
  const replay = await h.consumer.scan();
  assert.deepEqual(h.observerCalls.at(-1), {}); assert.equal(replay.reason, 'TASK_LISTING_INVALIDATED_BLOCK_REFUSED');
});

test('a re-mined fill replaces its invalidated slot on a new anchor without double counting', async () => {
  let changed = false;
  const h = harness({ observe: () => observation([fill(changed ? { blockHash: H(500) } : {})]) });
  await h.consumer.scan(); h.blocks.set(10, H(500)); await h.consumer.readSummary(); changed = true;
  const result = await h.consumer.scan();
  assert.equal(result.freshness, 'FRESH'); assert.equal(result.aggregate.quantity, '2'); assert.equal(result.availableFillCount, 1);
  const saved = await record(h); assert.equal(saved.fills.length, 1); assert.deepEqual(saved.invalidatedAnchors, [{ number: 10, hash: H(10) }]);
});

test('once invalidated, an old anchor is refused even if the reader later returns that old block again', async () => {
  const h = harness(); await h.consumer.scan(); h.blocks.set(10, H(500)); await h.consumer.readSummary(); h.blocks.delete(10);
  const result = await h.consumer.scan();
  assert.equal(result.reason, 'TASK_LISTING_INVALIDATED_BLOCK_REFUSED'); assert.equal(result.aggregate, null);
});

test('cursor-only reorg resets coverage and makes retained evidence stale until a fresh scan', async () => {
  const h = harness(); await h.consumer.scan(); h.blocks.set(12, H(600));
  const result = await h.consumer.readSummary();
  assert.equal(result.reason, 'TASK_LISTING_REORG'); assert.equal(result.aggregate, null); assert.equal(result.availableFillCount, 1);
  assert.equal((await record(h)).cursor, null); assert.equal((await record(h)).needsRescan, true);
});

test('reorg occurring during observer invocation cannot commit new fills', async () => {
  const h = harness({ observe: () => { h.blocks.set(10, H(500)); return observation(); } });
  const result = await h.consumer.scan();
  assert.equal(result.reason, 'TASK_LISTING_REORG'); assert.equal(result.aggregate, null);
  const saved = await record(h); assert.equal(saved.fills.length, 0); assert.equal(saved.cursor, null); assert.equal(saved.needsRescan, true);
});

test('provider outage, chain mismatch, and lost confirmation depth make previously verified totals unavailable', async () => {
  for (const mutate of [h => { h.state.fail = true; }, h => { h.state.chainId = '0x2105'; }, h => { h.state.head = 12; }]) {
    const h = harness(); await h.consumer.scan(); mutate(h);
    const result = await h.consumer.readSummary();
    assert.equal(result.freshness, 'STALE'); assert.equal(result.aggregate, null); assert.equal(result.lastKnownAggregate.quantity, '2');
  }
});

test('observer rejection does not overwrite existing cursor or add any partial evidence', async () => {
  let block = false;
  const h = harness({ observe: () => block ? observation([], { status: 'BLOCKED', overrides: { reason: 'NFT_SALE_OBSERVER_PROVIDER_FAILURE' } }) : observation() });
  await h.consumer.scan(); block = true;
  const result = await h.consumer.scan();
  assert.equal(result.reason, 'NFT_SALE_OBSERVER_PROVIDER_FAILURE'); assert.equal(result.aggregate, null);
  const saved = await record(h); assert.deepEqual(saved.cursor, cursor()); assert.equal(saved.aggregate.quantity, '2');
});

test('malformed fill bindings, fill IDs, depth, finality, arithmetic and overfill fail closed', async () => {
  for (const patch of [{ chainId: '8453' }, { orderHash: H(999) }, { orderDigest: 'a'.repeat(64) }, { sourceId: 'other' },
    { observationPolicyId: 'other' }, { fillId: `1:${H(101)}:0` }, { fillId: `1:${H(100)}:9007199254740992` },
    { blockHash: '0x' }, { blockNumber: 9 }, { confirmations: 2 }, { finality: 'FINAL' }, { verified: false }, { canonical: false },
    { quantity: '0' }, { quantity: '11' }, { fees: '11' }, { gross: '0x200' }, { budgetChanged: true }]) {
    const h = harness({ observe: () => observation([fill(patch)]) });
    const result = await h.consumer.scan();
    assert.equal(result.freshness, 'STALE', JSON.stringify(patch)); assert.equal(result.aggregate, null); assert.equal((await record(h)).fills.length, 0);
  }
});

test('aggregate beyond fixed order quantity refuses complete invocation', async () => {
  const h = harness({ observe: () => observation([fill({ quantity: '7' }), fill({ fillId: `1:${H(101)}:0`, transactionHash: H(101), quantity: '7' })]) });
  assert.equal((await h.consumer.scan()).reason, 'TASK_LISTING_AGGREGATE_REFUSED'); assert.equal((await record(h)).fills.length, 0);
});

test('future scans cannot swap observer binding or scan window', async () => {
  let changed = false;
  const h = harness({ observe: input => changed ? observation([], { start: 13, next: 14, cursorOverride: { ...cursor(14), bindingDigest: '9'.repeat(64) } }) : observation() });
  await h.consumer.scan(); changed = true;
  const result = await h.consumer.scan(); assert.equal(result.reason, 'TASK_LISTING_OBSERVER_REBOUND'); assert.deepEqual((await record(h)).cursor, cursor());
});

test('does not mutate spending, task grant, quota, or unrelated store entries', async () => {
  const baseline = { 'grant:example': { state: 'revoked', spendingBudget: '1000', remainingQuota: '0' }, 'task:example': { status: 'expired' } };
  const store = new MemoryCredentialStore(baseline), h = harness({ store });
  await h.consumer.scan(); await h.consumer.readSummary();
  assert.deepEqual(await store.readMany(Object.keys(baseline)), baseline);
});

test('reorg rewind deduplicates retained fills and recovered fills across durable scans', async () => {
  let changed = false;
  const another = fill({ fillId: `1:${H(101)}:1`, transactionHash: H(101), blockNumber: 11, blockHash: H(11), quantity: '3', gross: '300', fees: '15', sellerNet: '285' });
  const h = harness({ observe: () => observation([fill(), { ...another, ...(changed ? { blockHash: H(501), observedAt: 2000, evidenceDigest: '9'.repeat(64) } : {}) }]) });
  assert.equal((await h.consumer.scan()).aggregate.quantity, '5');
  h.blocks.set(11, H(501)); await h.consumer.readSummary(); changed = true;
  const result = await h.consumer.scan();
  assert.equal(result.freshness, 'FRESH'); assert.equal(result.aggregate.quantity, '5'); assert.equal(result.availableFillCount, 2);
  assert.equal((await record(h)).fills.length, 2);
});

test('provider failure after discovery discards all proposed cursor and evidence changes', async () => {
  const h = harness({ observe: () => { h.state.fail = true; return observation(); } });
  const result = await h.consumer.scan();
  assert.equal(result.reason, 'TASK_LISTING_CANONICAL_READER_UNAVAILABLE'); assert.equal(result.aggregate, null);
  assert.equal((await record(h)).cursor, null); assert.equal((await record(h)).fills.length, 0);
});

test('cursor checkpoint cannot reuse a tombstoned block even when it has no corresponding fill', async () => {
  const h = harness(); await h.consumer.scan(); h.blocks.set(12, H(600)); await h.consumer.readSummary(); h.blocks.delete(12);
  const result = await h.consumer.scan();
  assert.equal(result.reason, 'TASK_LISTING_INVALIDATED_BLOCK_REFUSED'); assert.equal(result.aggregate, null);
  assert.equal((await record(h)).cursor, null);
});

test('canonical source changing during its second anchor read makes all results unavailable', async () => {
  const h = harness(); await h.consumer.scan();
  const request = h.reader.request; let count = 0;
  const reader = { sourceId: 'fixed-reader', async request(input) {
    if (input.method === 'eth_getBlockByNumber' && input.params[0] === '0xa' && ++count === 2) h.blocks.set(10, H(888));
    return request(input);
  } };
  const result = await h.make({ canonicalReader: reader }).readSummary();
  assert.equal(result.reason, 'TASK_LISTING_REORG'); assert.equal(result.invalidatedFillCount, 1); assert.equal(result.aggregate, null);
});

test('observer failure preserves valid evidence, but never converts fresh point-in-time data into finality', async () => {
  let fail = false;
  const h = harness({ observe: () => { if (fail) throw Error('observer offline'); return observation(); } });
  await h.consumer.scan(); fail = true;
  const stale = await h.consumer.scan(); assert.equal(stale.freshness, 'STALE'); assert.equal(stale.aggregate, null);
  const read = await h.consumer.readSummary(); assert.equal(read.freshness, 'FRESH'); assert.equal(read.aggregate.quantity, '2'); noMutationFlags(read);
});

test('known reorg survives a later checkpoint, head or final chain-read failure', async () => {
  for (const failAt of ['checkpoint', 'head', 'chain']) {
    const h = harness(); await h.consumer.scan(); const original = h.reader.request;
    let phase = 'reorg', chainReads = 0;
    const reader = { sourceId: h.reader.sourceId, async request(input) {
      if (phase === 'reorg') {
        if (input.method === 'eth_chainId' && ++chainReads === 2 && failAt === 'chain') return '0x2105';
        if (input.method === 'eth_getBlockByNumber') {
          if (input.params[0] === '0xa') return { number: '0xa', hash: H(500) };
          if ((failAt === 'checkpoint' && input.params[0] === '0xc') || (failAt === 'head' && input.params[0] === '0x14')) throw Error('offline after known contradiction');
        }
      }
      return original(input);
    } };
    const consumer = h.make({ canonicalReader: reader });
    const first = await consumer.readSummary();
    assert.equal(first.reason, 'TASK_LISTING_REORG', failAt); assert.equal(first.aggregate, null);
    const saved = await record(h);
    assert.equal(saved.fills[0].status, 'INVALIDATED', failAt); assert.equal(saved.cursor, null); assert.equal(saved.aggregate.quantity, '0');
    assert.deepEqual(saved.invalidatedAnchors, [{ number: 10, hash: H(10) }]);
    phase = 'old-branch-returned';
    const again = await consumer.readSummary(); assert.equal(again.freshness, 'STALE'); assert.equal(again.aggregate, null);
  }
});

test('known reorg merges into a winning revision instead of being discarded by CAS', async () => {
  const h = harness(); await h.consumer.scan(); const original = h.reader.request;
  let release, signal;
  const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { signal = resolve; });
  let paused = false, phase = 'reorg';
  const reader = { sourceId: h.reader.sourceId, async request(input) {
    if (phase === 'reorg' && input.method === 'eth_getBlockByNumber') {
      if (input.params[0] === '0xa') return { number: '0xa', hash: H(500) };
      if (input.params[0] === '0xc' && !paused) { paused = true; signal(); await gate; }
    }
    return original(input);
  } };
  const consumer = h.make({ canonicalReader: reader }), pending = consumer.readSummary(); await entered;
  const winner = await h.consumer.readSummary(); assert.equal(winner.freshness, 'FRESH'); assert.equal(winner.revision, 2);
  release(); const stale = await pending;
  assert.equal(stale.reason, 'TASK_LISTING_REORG'); assert.equal(stale.revision, 3); assert.equal(stale.aggregate, null);
  const saved = await record(h); assert.equal(saved.freshness, 'STALE'); assert.equal(saved.fills[0].status, 'INVALIDATED'); assert.equal(saved.aggregate.quantity, '0');
  assert.equal(saved.cursor, null); assert.equal(saved.needsRescan, true);
  phase = 'old-branch-returned'; assert.equal((await consumer.readSummary()).freshness, 'STALE');
});

test('known reorg CAS merge preserves independently committed fills and never adds failed-scan fills', async () => {
  const h = harness(); await h.consumer.scan(); const original = h.reader.request;
  let release, signal; const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { signal = resolve; });
  let paused = false, observerRan = false;
  const reader = { sourceId: h.reader.sourceId, async request(input) {
    if (observerRan && input.method === 'eth_getBlockByNumber') {
      if (input.params[0] === '0xa') return { number: '0xa', hash: H(500) };
      if (input.params[0] === '0xe' && !paused) { paused = true; signal(); await gate; throw Error('offline after known conflict'); }
    }
    return original(input);
  } };
  const failedFill = fill({ fillId: `1:${H(103)}:0`, transactionHash: H(103), blockNumber: 13, blockHash: H(13) });
  const loser = h.make({ canonicalReader: reader, observer: { observe() { observerRan = true; return observation([failedFill], { start: 13, next: 15 }); } } });
  const pending = loser.scan(); await entered;
  const committedFill = fill({ fillId: `1:${H(104)}:0`, transactionHash: H(104), blockNumber: 13, blockHash: H(13) });
  const winner = h.make({ observer: { observe() { return observation([committedFill], { start: 13, next: 14 }); } } });
  assert.equal((await winner.scan()).aggregate.quantity, '4');
  release(); const result = await pending; assert.equal(result.reason, 'TASK_LISTING_REORG');
  const saved = await record(h);
  assert.equal(saved.fills.length, 2); assert.equal(saved.fills.find(e => e.fill.fillId === committedFill.fillId).status, 'AVAILABLE');
  assert.equal(saved.fills.some(e => e.fill.fillId === failedFill.fillId), false);
  assert.equal(saved.aggregate.quantity, '2'); assert.equal(saved.cursor, null); assert.equal(saved.freshness, 'STALE');
});

test('tombstone capacity exhaustion persists known invalidation and permanently blocks automatic freshness', async () => {
  const h = harness(); await h.consumer.scan();
  await h.store.transactionMany([h.consumer.storageKey], values => {
    const saved = values[h.consumer.storageKey];
    saved.invalidatedAnchors = Array.from({ length: 10000 }, (_, i) => ({ number: i + 100, hash: H(i + 10000) }));
    return values;
  });
  h.blocks.set(10, H(500));
  const result = await h.consumer.readSummary();
  assert.equal(result.reason, 'TASK_LISTING_INVALIDATION_CAPACITY_EXHAUSTED'); assert.equal(result.reconciliationBlocked, true); assert.equal(result.aggregate, null);
  const saved = await record(h);
  assert.equal(saved.fills[0].status, 'INVALIDATED'); assert.equal(saved.aggregate.quantity, '0'); assert.equal(saved.invalidatedAnchors.length, 10000);
  assert.equal(saved.reconciliationBlocked, true); assert.equal(saved.needsRescan, true); assert.equal(saved.cursor, null);
  h.blocks.delete(10); const calls = h.calls.length, observed = h.observerCalls.length;
  for (const consumer of [h.consumer, h.make()]) {
    assert.equal((await consumer.readSummary()).aggregate, null);
    assert.equal((await consumer.scan()).reason, 'TASK_LISTING_INVALIDATION_CAPACITY_EXHAUSTED');
  }
  assert.equal(h.calls.length, calls); assert.equal(h.observerCalls.length, observed);
});
