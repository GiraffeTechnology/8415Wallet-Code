/** Durable, read-only listing evidence consumption. Composition supplies the
 * actual ArtFi observer and a fixed canonical reader; no HTTP/client evidence,
 * cursor, RPC method, signer, budget or publication authority is accepted. */
import { createHash } from 'node:crypto';

const SCHEMA = '8415-task-listing-observation/1';
const CURSOR = 'artfi-listed-order-cursor/1';
const MAX_FILLS = 10000;
const MAX_ANCHORS = 10000;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) && !/^0x0{64}$/i.test(value);
const digest = value => typeof value === 'string' && /^(?:0x)?[0-9a-f]{64}$/i.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export class TaskListingObservationError extends Error {
  constructor(code) { super(code); this.name = 'TaskListingObservationError'; this.code = code; }
}
const check = (ok, code = 'TASK_LISTING_EVIDENCE_REFUSED') => { if (!ok) throw new TaskListingObservationError(code); };
const uint = value => {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value));
  const n = BigInt(value); check(n < 1n << 256n); return n;
};
const rpcCount = value => {
  check(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) && value.length <= 66, 'TASK_LISTING_CANONICAL_READER_INVALID');
  const n = BigInt(value); check(n <= BigInt(Number.MAX_SAFE_INTEGER), 'TASK_LISTING_CANONICAL_READER_INVALID'); return Number(n);
};
const anchorId = anchor => `${anchor.number}:${anchor.hash.toLowerCase()}`;
const zero = () => ({ quantity: '0', gross: '0', fees: '0', sellerNet: '0' });
const exactInput = args => check(args.length === 0, 'TASK_LISTING_CALLER_INPUT_REFUSED');

/**
 * observer: { observe({ cursor } = {}) }, where observe is the actual function
 * returned by ArtFi createListedOrderObserver. Methods are captured once.
 * canonicalReader: { sourceId, request({method, params}) }, server-owned.
 * binding: taskDigest, childDigest, chainId, orderHash, orderDigest, sourceId,
 * observationPolicyId, minimumConfirmations, requestedQuantity, orderQuantity.
 * No argument is accepted by scan()/readSummary(), including an empty object.
 */
export function createTaskListingObservationConsumer({ store, observer, canonicalReader, binding: inputBinding, now = Date.now }) {
  check(typeof store?.transactionMany === 'function' && typeof store?.readMany === 'function' &&
    typeof observer?.observe === 'function' && typeof canonicalReader?.request === 'function' && typeof now === 'function', 'TASK_LISTING_CONFIGURATION_REFUSED');
  const b = structuredClone(inputBinding);
  check(plain(b) && Object.keys(b).length === 10 &&
    ['taskDigest', 'childDigest', 'orderDigest'].every(key => digest(b[key])) && hash(b.orderHash) &&
    ['1', '8453'].includes(b.chainId) && ['sourceId', 'observationPolicyId'].every(key => /^[A-Za-z0-9_-]{1,128}$/.test(b[key] ?? '')) &&
    count(b.minimumConfirmations) && b.minimumConfirmations >= 1 && canonicalReader.sourceId === b.sourceId,
  'TASK_LISTING_BINDING_REFUSED');
  check(uint(b.requestedQuantity) > 0n && uint(b.orderQuantity) >= uint(b.requestedQuantity) && uint(b.orderQuantity) <= 1000000n, 'TASK_LISTING_BINDING_REFUSED');
  b.orderHash = b.orderHash.toLowerCase();
  const binding = freeze(b), bindingDigest = sha(binding);
  // The slot binds one immutable task/child. Rebinding that slot is refused,
  // rather than creating a parallel record with a different minimum depth.
  const storageKey = `task-listing-observation:${sha([binding.taskDigest, binding.childDigest])}`;
  const readMany = store.readMany.bind(store), transactionMany = store.transactionMany.bind(store),
    observe = observer.observe.bind(observer), request = canonicalReader.request.bind(canonicalReader), clock = now;
  const timestamp = () => { const t = clock(); check(count(t), 'TASK_LISTING_CLOCK_REFUSED'); return t; };
  const initial = () => ({ schema: SCHEMA, bindingDigest, binding, revision: 0, cursor: null, cursorBindingDigest: null,
    scanBounds: null, fills: [], invalidatedAnchors: [], aggregate: zero(), hasScanned: false,
    needsRescan: false, reconciliationBlocked: false, checkedAt: null, head: null, freshness: 'STALE', reason: 'TASK_LISTING_NOT_OBSERVED' });
  function cursorValid(c) {
    return plain(c) && Object.keys(c).length === 4 && c.schema === CURSOR && digest(c.bindingDigest) &&
      count(c.nextBlock) && c.nextBlock >= 1 && (c.checkpoint === null ||
      (plain(c.checkpoint) && Object.keys(c.checkpoint).length === 2 && c.checkpoint.number === c.nextBlock - 1 && hash(c.checkpoint.hash)));
  }
  function total(fills) {
    const totals = { quantity: 0n, gross: 0n, fees: 0n, sellerNet: 0n };
    for (const entry of fills) if (entry.status === 'AVAILABLE') for (const key of Object.keys(totals)) totals[key] += uint(entry.fill[key]);
    check(totals.quantity <= uint(binding.orderQuantity) && totals.gross === totals.fees + totals.sellerNet &&
      Object.values(totals).every(v => v < 1n << 256n), 'TASK_LISTING_AGGREGATE_REFUSED');
    return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toString()]));
  }
  function assertRecord(record) {
    check(record?.schema === SCHEMA && record.bindingDigest === bindingDigest && sha(record.binding) === bindingDigest,
      'TASK_LISTING_STORED_BINDING_REFUSED');
    check(count(record.revision) && record.revision < Number.MAX_SAFE_INTEGER && Array.isArray(record.fills) && record.fills.length <= MAX_FILLS &&
      Array.isArray(record.invalidatedAnchors) && record.invalidatedAnchors.length <= MAX_ANCHORS &&
      (record.cursor === null || cursorValid(record.cursor)), 'TASK_LISTING_STORE_REFUSED');
    const ids = new Set();
    for (const entry of record.fills) {
      const fill = validateFill(entry.fill);
      check(!ids.has(fill.fillId) && entry.fingerprint === sha(fill) && ['AVAILABLE', 'INVALIDATED'].includes(entry.status), 'TASK_LISTING_STORE_REFUSED');
      ids.add(fill.fillId);
    }
    check(sha(record.aggregate) === sha(total(record.fills)), 'TASK_LISTING_STORE_REFUSED');
    return record;
  }
  async function load() {
    const values = await readMany([storageKey]);
    return values[storageKey] === null ? initial() : assertRecord(values[storageKey]);
  }
  // Retain the evaluator result, but compare stable evidence/economics rather
  // than changing observedAt, confirmation depth or full envelope digest.
  function validateFill(f) {
    check(plain(f) && f.kind === 'NFT_SALE_FILL' && f.state === 'CONFIRMED' && f.verified === true && f.canonical === true &&
      f.finality === 'NOT_EVALUATED' && f.chainId === binding.chainId && f.sourceId === binding.sourceId &&
      f.observationPolicyId === binding.observationPolicyId && same(f.orderHash, binding.orderHash) && f.orderDigest === binding.orderDigest &&
      hash(f.transactionHash) && hash(f.blockHash) && count(f.blockNumber) && f.blockNumber >= 1 &&
      count(f.confirmations) && f.confirmations >= binding.minimumConfirmations && count(f.observedAt) && digest(f.evidenceDigest) &&
      f.authorizationChanged === false && f.budgetChanged === false && f.requestedQuantity === binding.requestedQuantity &&
      f.orderQuantity === binding.orderQuantity && f.sellerNetBasis === 'TOKEN_PROCEEDS_EXCLUDING_GAS');
    const match = /^([1-9][0-9]*):(0x[0-9a-f]{64}):(0|[1-9][0-9]*)$/.exec(f.fillId ?? '');
    check(match && match[1] === binding.chainId && same(match[2], f.transactionHash) && Number.isSafeInteger(Number(match[3])));
    check(uint(f.quantity) > 0n && uint(f.quantity) <= uint(binding.orderQuantity) && uint(f.gross) > 0n &&
      uint(f.sellerNet) > 0n && uint(f.gross) === uint(f.fees) + uint(f.sellerNet));
    const stable = structuredClone(f);
    delete stable.observedAt; delete stable.confirmations; delete stable.evidenceDigest;
    // These are stored separately to retain evidence provenance without making
    // identical fills conflict solely because they were observed later.
    return { ...stable, transactionHash: f.transactionHash.toLowerCase(), blockHash: f.blockHash.toLowerCase(), orderHash: f.orderHash.toLowerCase() };
  }
  function storedFill(f) {
    const stable = validateFill(f);
    return { fill: structuredClone(f), fingerprint: sha(stable), status: 'AVAILABLE', invalidatedAt: null };
  }
  function validateObservation(o, record) {
    check(plain(o) && o.kind === 'NFT_LISTED_ORDER_OBSERVATION' && o.chainId === binding.chainId && o.sourceId === binding.sourceId &&
      same(o.orderHash, binding.orderHash) && o.orderDigest === binding.orderDigest && o.observationPolicyId === binding.observationPolicyId &&
      o.authorizationChanged === false && o.budgetChanged === false && o.resendAuthorized === false &&
      o.cumulativeCompletion === 'NOT_EVALUATED' && o.onchainOrderStatus === 'NOT_EVALUATED' && Array.isArray(o.fills) && o.fills.length <= 1000);
    if (o.scanStatus === 'BLOCKED') {
      check(o.fills.length === 0 && o.verified === false);
      throw new TaskListingObservationError(/^NFT_SALE_[A-Z0-9_]+$/.test(o.reason ?? '') ? o.reason : 'TASK_LISTING_OBSERVER_BLOCKED');
    }
    const c = o.nextCursor, s = o.scan;
    check(['SCANNED', 'NO_NEW_RANGE'].includes(o.scanStatus) && cursorValid(c) && plain(s) &&
      count(s.fromBlock) && s.fromBlock >= 1 && count(s.throughBlock) && s.throughBlock >= s.fromBlock && s.throughBlock < Number.MAX_SAFE_INTEGER &&
      count(s.pages) && s.pages <= 100 && s.coverageScope === 'THIS_INVOCATION_ONLY' && c.nextBlock >= s.fromBlock && c.nextBlock <= s.throughBlock + 1 &&
      (c.nextBlock === s.fromBlock ? c.checkpoint === null : c.checkpoint?.number === c.nextBlock - 1));
    check(record.cursorBindingDigest === null || c.bindingDigest === record.cursorBindingDigest, 'TASK_LISTING_OBSERVER_REBOUND');
    const bounds = { fromBlock: s.fromBlock, throughBlock: s.throughBlock };
    check(record.scanBounds === null || sha(record.scanBounds) === sha(bounds), 'TASK_LISTING_OBSERVER_REBOUND');
    const start = record.cursor?.nextBlock ?? s.fromBlock;
    if (o.scanStatus === 'SCANNED') check(s.pages >= 1 && s.scannedFromBlock === start && s.scannedThroughBlock === c.nextBlock - 1 && c.nextBlock > start);
    else check(s.pages === 0 && s.scannedFromBlock === null && s.scannedThroughBlock === null && c.nextBlock === start && o.fills.length === 0);
    check(o.state === (o.fills.length ? 'CONFIRMED' : 'UNKNOWN') && o.verified === (o.fills.length > 0));
    const entries = o.fills.map(f => {
      const entry = storedFill(f);
      check(f.blockNumber >= s.scannedFromBlock && f.blockNumber <= s.scannedThroughBlock);
      return entry;
    });
    return { entries, cursor: structuredClone(c), bounds };
  }
  async function rpc(method, params = []) {
    check(['eth_chainId', 'eth_getBlockByNumber'].includes(method), 'TASK_LISTING_RPC_WRITE_REFUSED');
    try { return structuredClone(await request({ method, params })); }
    catch { throw new TaskListingObservationError('TASK_LISTING_CANONICAL_READER_UNAVAILABLE'); }
  }
  async function block(tag) {
    const result = await rpc('eth_getBlockByNumber', [tag, false]);
    check(result && hash(result.hash), 'TASK_LISTING_CANONICAL_READER_INVALID');
    const number = rpcCount(result.number);
    check(tag === 'latest' || number === rpcCount(tag), 'TASK_LISTING_CANONICAL_READER_INVALID');
    check(result.chainId === undefined || String(rpcCount(result.chainId)) === binding.chainId, 'TASK_LISTING_CHAIN_MISMATCH');
    return { number, hash: result.hash.toLowerCase() };
  }
  function anchors(record) {
    const values = record.fills.filter(entry => entry.status === 'AVAILABLE').map(entry => ({ number: entry.fill.blockNumber, hash: entry.fill.blockHash }));
    if (record.cursor?.checkpoint) values.push(record.cursor.checkpoint);
    return [...new Map(values.map(a => [anchorId(a), a])).values()];
  }
  async function revalidate(record) {
    const invalid = [];
    let head = null;
    const reorg = () => ({ head, invalid: [...new Map(invalid.map(a => [anchorId(a), a])).values()], reason: 'TASK_LISTING_REORG' });
    try {
      check(String(rpcCount(await rpc('eth_chainId'))) === binding.chainId, 'TASK_LISTING_CHAIN_MISMATCH');
      head = await block('latest');
      const list = anchors(record);
      check(!list.some(a => record.invalidatedAnchors.some(v => anchorId(v) === anchorId(a))), 'TASK_LISTING_INVALIDATED_BLOCK_REFUSED');
      // Check twice and pin the confirmation head: a changed block during this
      // read cannot silently overwrite a contradictory anchor at the same height.
      for (let pass = 0; pass < 2; pass++) for (const a of list) {
        const current = await block(`0x${a.number.toString(16)}`);
        if (!same(current.hash, a.hash)) invalid.push(a);
      }
      const headAfter = await block(`0x${head.number.toString(16)}`);
      if (!same(headAfter.hash, head.hash)) invalid.push(head);
      check(String(rpcCount(await rpc('eth_chainId'))) === binding.chainId, 'TASK_LISTING_CHAIN_MISMATCH');
      if (invalid.length) return reorg();
      check(list.every(a => head.number - a.number + 1 >= binding.minimumConfirmations), 'TASK_LISTING_CONFIRMATION_DEPTH_UNAVAILABLE');
      return { head, invalid: [], reason: null };
    } catch (error) {
      // Once a contradiction is observed, a later timeout, malformed response,
      // chain change or head-read failure cannot restore the old evidence.
      if (invalid.length) return reorg();
      throw error;
    }
  }
  function project(record, reason = null) {
    const fresh = record.freshness === 'FRESH' && reason === null && !record.needsRescan && !record.reconciliationBlocked && record.hasScanned;
    return freeze({ kind: 'TASK_LISTING_OBSERVATION_SUMMARY', binding, revision: record.revision,
      freshness: fresh ? 'FRESH' : 'STALE', reason: reason ?? record.reason,
      saleStatus: fresh && record.aggregate.quantity !== '0' ? 'VERIFIED_FILLS' : 'UNKNOWN',
      aggregate: fresh ? structuredClone(record.aggregate) : null,
      lastKnownAggregate: structuredClone(record.aggregate),
      availableFillCount: record.fills.filter(e => e.status === 'AVAILABLE').length,
      invalidatedFillCount: record.fills.filter(e => e.status === 'INVALIDATED').length,
      reconciliationBlocked: record.reconciliationBlocked === true,
      checkedAt: record.checkedAt, head: structuredClone(record.head),
      finality: 'NOT_EVALUATED', cumulativeCompletion: 'NOT_EVALUATED', onchainOrderStatus: 'NOT_EVALUATED',
      currentOwnership: 'NOT_EVALUATED', currentBalances: 'NOT_EVALUATED',
      usdProceeds: 'NOT_EVALUATED', sellerNetBasis: 'TOKEN_PROCEEDS_EXCLUDING_GAS',
      authorizationChanged: false, budgetChanged: false, quotaChanged: false,
      resendAuthorized: false, relistAuthorized: false });
  }
  async function commit(before, next, knownInvalidations = []) {
    next.revision = before.revision + 1;
    next.aggregate = total(next.fills);
    try {
      const changed = await transactionMany([storageKey], values => {
        const current = values[storageKey] === null ? initial() : assertRecord(values[storageKey]);
        if (current.revision !== before.revision && knownInvalidations.length) {
          // Negative evidence is monotonic, even when this scan loses the CAS.
          // Merge only invalid anchors into the latest durable snapshot. Never
          // merge this scan's uncommitted positive evidence or its cursor.
          const downgraded = structuredClone(current);
          invalidate(downgraded, knownInvalidations, next.checkedAt);
          downgraded.revision = current.revision + 1;
          downgraded.aggregate = total(downgraded.fills);
          downgraded.freshness = 'STALE';
          downgraded.reason = downgraded.reconciliationBlocked ? 'TASK_LISTING_INVALIDATION_CAPACITY_EXHAUSTED' : 'TASK_LISTING_REORG';
          downgraded.checkedAt = next.checkedAt;
          return { [storageKey]: downgraded };
        }
        check(current.revision === before.revision, 'TASK_LISTING_SCAN_CONFLICT');
        return { [storageKey]: next };
      });
      return project(changed[storageKey]);
    } catch (error) {
      if (error?.code !== 'TASK_LISTING_SCAN_CONFLICT') throw error;
      // A losing positive scan never publishes uncommitted data or changes the
      // winner; only observed reorg invalidations have the monotonic merge above.
      return project(await load(), 'TASK_LISTING_SCAN_CONFLICT');
    }
  }
  function invalidate(record, invalid, time) {
    const ids = new Set(record.invalidatedAnchors.map(anchorId));
    for (const a of invalid) ids.add(anchorId(a));
    // Capacity exhaustion must never discard a known contradiction and later
    // revive old evidence. Keep bounded tombstones and permanently block this
    // consumer record from becoming fresh or automatically resuming scans.
    if (ids.size > MAX_ANCHORS) record.reconciliationBlocked = true;
    const all = new Map([...record.invalidatedAnchors, ...invalid].map(a => [anchorId(a), { number: a.number, hash: a.hash.toLowerCase() }]));
    record.invalidatedAnchors = [...all.values()].slice(0, MAX_ANCHORS);
    for (const entry of record.fills) if (ids.has(anchorId({ number: entry.fill.blockNumber, hash: entry.fill.blockHash }))) {
      entry.status = 'INVALIDATED'; entry.invalidatedAt = time;
    }
    record.cursor = null; record.needsRescan = true;
  }
  async function run(scan) {
    const before = await load(), next = structuredClone(before);
    if (before.reconciliationBlocked) return project(before, 'TASK_LISTING_INVALIDATION_CAPACITY_EXHAUSTED');
    let invalidationApplied = false, knownInvalidations = [];
    try {
      const first = await revalidate(before);
      if (first.invalid.length) {
        knownInvalidations = first.invalid;
        invalidate(next, first.invalid, timestamp()); invalidationApplied = true; next.head = first.head;
        throw new TaskListingObservationError(first.reason);
      }
      if (scan) {
        const observed = structuredClone(await observe(before.cursor === null ? {} : { cursor: structuredClone(before.cursor) }));
        const accepted = validateObservation(observed, before), byId = new Map(next.fills.map(entry => [entry.fill.fillId, entry]));
        for (const entry of accepted.entries) {
          const a = { number: entry.fill.blockNumber, hash: entry.fill.blockHash };
          check(!next.invalidatedAnchors.some(v => anchorId(v) === anchorId(a)), 'TASK_LISTING_INVALIDATED_BLOCK_REFUSED');
          const old = byId.get(entry.fill.fillId);
          if (old?.status === 'AVAILABLE') check(old.fingerprint === entry.fingerprint, 'TASK_LISTING_CONFLICTING_FILL_REFUSED');
          // A re-mined transaction may replace invalidated evidence on a new
          // anchor. It occupies the same fillId slot, never a second addition.
          if (!old || old.status === 'INVALIDATED') byId.set(entry.fill.fillId, entry);
        }
        check(byId.size <= MAX_FILLS, 'TASK_LISTING_CAPACITY_REFUSED');
        next.fills = [...byId.values()].sort((a, b) => a.fill.fillId.localeCompare(b.fill.fillId));
        next.cursor = accepted.cursor; next.cursorBindingDigest = accepted.cursor.bindingDigest;
        next.scanBounds = accepted.bounds; next.hasScanned = true; next.needsRescan = false;
        total(next.fills);
      }
      const last = await revalidate(next);
      if (last.invalid.length) {
        // Do not commit any new fill or cursor from a reorg-affected scan.
        Object.assign(next, structuredClone(before));
        knownInvalidations = last.invalid;
        invalidate(next, last.invalid, timestamp()); invalidationApplied = true; next.head = last.head;
        throw new TaskListingObservationError(last.reason);
      }
      next.head = last.head; next.checkedAt = timestamp();
      next.freshness = next.hasScanned && !next.needsRescan ? 'FRESH' : 'STALE';
      next.reason = next.needsRescan ? 'TASK_LISTING_RECONCILIATION_REQUIRED' : next.hasScanned ? 'TASK_LISTING_ANCHORS_REVALIDATED' : 'TASK_LISTING_NOT_OBSERVED';
    } catch (error) {
      // Reorg invalidation above is retained; all other failed scans preserve
      // exactly the prior cursor/fills/aggregate. No partial additions escape.
      if (!invalidationApplied) Object.assign(next, structuredClone(before));
      next.freshness = 'STALE'; next.checkedAt = timestamp();
      next.reason = next.reconciliationBlocked ? 'TASK_LISTING_INVALIDATION_CAPACITY_EXHAUSTED' : /^(TASK_LISTING|NFT_SALE)_[A-Z0-9_]+$/.test(error?.code ?? error?.message ?? '')
        ? error.code ?? error.message : 'TASK_LISTING_OBSERVER_UNAVAILABLE';
    }
    return commit(before, next, knownInvalidations);
  }
  return freeze({ binding, storageKey, scan: async (...args) => { exactInput(args); return run(true); },
    readSummary: async (...args) => { exactInput(args); return run(false); } });
}
