# Durable seller-listing observation consumer

This local production-candidate increment composes ArtFi's existing read-only
listing observer with Wallet's existing `store.readMany` and
`store.transactionMany` boundary. It does not add a store implementation,
credential, signer, spending ledger, venue call, or publication mechanism.

## Fixed composition interface

`server/task-listing-observation-consumer.mjs` exports
`createTaskListingObservationConsumer` and `TaskListingObservationError`.

```js
const observe = createListedOrderObserver(serverOwnedObserverConfiguration);
const consumer = createTaskListingObservationConsumer({
  store,                                  // Existing Wallet credential store
  observer: { observe },                  // ArtFi returns an async function
  canonicalReader: { sourceId, request },  // Fixed EIP-1193-style read-only source
  binding: {
    taskDigest,
    childDigest,
    chainId,
    orderHash,
    orderDigest,
    sourceId,
    observationPolicyId,
    minimumConfirmations,
    requestedQuantity,
    orderQuantity,
  },
  now: Date.now,
});
await consumer.scan();
await consumer.readSummary();
```

All binding fields are required. Chain IDs are decimal strings `1` or `8453`;
quantities are positive canonical decimal strings. Requested quantity must not
exceed the order quantity, and this bounded consumer supports orders of at most
1,000,000 items. `orderDigest` is the unchanged ArtFi order snapshot digest;
`taskDigest` and `childDigest` bind the already-reviewed Wallet task and child.
Minimum confirmation depth is a positive safe integer. Source and policy IDs
must match the fixed ArtFi configuration. The reader's source ID must match too.
The composition root remains responsible for verifying that the selected task,
child and order are the authorized exact listing and for injecting the real
ArtFi observer, reviewed deployment pins, bounded provider timeout and approved
source. This API does not authenticate a dishonest server-injected observer or
reader.

The factory deep-copies/freezes the binding and captures all dependency methods
once. Neither public method accepts arguments, including an empty object.
Callers cannot supply a cursor, evidence, a `verified` flag, alternate provider,
order, task, depth, or replacement configuration. `scan()` invokes the captured
observer itself using only its own persisted cursor. `readSummary()` checks
existing evidence without invoking discovery. Exposing these methods over HTTP
still requires the surrounding service's existing authentication and task
entitlement checks; this module is not an HTTP route.

## Durable consumption and concurrency

A single namespaced record in the existing store is selected by task and child.
The whole immutable binding is checked on every read and transaction, so changing
chain, order, source or minimum depth cannot create a parallel record in that
slot. The observer cursor's binding digest and scan window are persisted on the
first successful scan and pinned for later scans.

Each fill retains the evaluator's evidence and binds stable
`chainId:transactionHash:logIndex`, order hash/digest, block number/hash and exact
quantity/proceeds. Repeated identical evidence occupies one fill slot. Its
observed time, confirmation depth and envelope evidence digest can change without
creating a new economic fill. Conflicting duplicates refuse the entire scan.
Decimal `BigInt` sums persist quantity, gross, fees and seller net atomically;
fees plus net must equal gross and cumulative quantity cannot exceed the fixed
order quantity. These sums are observations, never changes to the task's budget,
grant, quota or receipt-execution ledger.

Slow provider/observer calls run outside the transaction. A durable revision CAS
inside `transactionMany` commits the cursor, fill set and aggregate together.
Concurrent positive scans may both read but only one revision can commit. A
losing positive scan returns `STALE`, `TASK_LISTING_SCAN_CONFLICT`, and
`aggregate: null`, with no partial data or double count. Known reorg evidence is
monotonic: if its scan loses the CAS, the same transaction merges only those
invalid anchors into the latest durable revision, invalidates matching evidence,
and resets coverage. It never merges the losing scan's new fills or cursor. Retry through `scan()` to consume the current durable cursor.
A persistence failure rejects the call; the underlying store's existing
fail-closed behavior remains in force. Records survive encrypted-store restart.
The existing store is single-writer; this module does not claim multi-replica
file-store coordination.

## Freshness and reorgs

Before and after discovery, and whenever `readSummary()` is called, the consumer
rechecks all available fill block anchors and its cursor checkpoint against the
fixed canonical reader. It checks each anchor twice, pins/rechecks the selected
confirmation head and checks the chain before and after. Only `eth_chainId` and
`eth_getBlockByNumber` are issued by this consumer. The underlying ArtFi observer
retains its own bounded six-method read-only allowlist and full evidence evaluator.

A changed block marks matching historical fill evidence `INVALIDATED`, removes
it from the available totals in the same durable write, and records a block
anchor tombstone. The cursor resets only to the observer's configured initial
range, and the record requires reconciliation. An old tombstoned anchor cannot
be reused, even if the provider later returns that old block again. A re-mined
transaction on a new block may replace its invalidated fillId slot; it never
becomes an additional accounting entry. Evidence on unchanged blocks is retained
and deduplicated during the trusted rescan. A reorg during discovery commits no
new fills or cursor. The prior record becomes stale with invalidated anchors.
Once a contradictory anchor has been read, a later checkpoint/head/RPC failure
or chain mismatch cannot discard that known conflict or restore the old evidence.

Provider unavailability, wrong chain, insufficient current depth, malformed
results, conflicting evidence, aggregate overflow, and observer failure return
stale summaries without advancing the cursor or adding partial fills. The
record is bounded to 10,000 fill slots and 10,000 invalidated anchors, additionally
subject to the existing encrypted store's byte limit. An invalidation that exhausts the tombstone limit still marks matching fill
evidence invalid and resets coverage in the same durable write. It sets
`reconciliationBlocked: true`: no subsequent scan, read, or consumer recreation
can automatically return that record to fresh state, including if the old fork
returns. This fail-closed flag is deliberately not resettable through this API.
Other capacity failures are not success and do not discard the old evidence.
These conservative tombstones are intentionally not an operator reset/relist
mechanism.

`FRESH` means the available aggregate was checked against the selected canonical
source at the returned `checkedAt` and `head`. It is a point-in-time observation,
not a guarantee against a later reorg, provider omission or fabrication.
Consumers must call `readSummary()` again rather than render stored freshness as
perpetually current. A stale result has `aggregate: null`; `lastKnownAggregate`
is explicitly historical/unavailable for current verified claims. On invalidation,
that retained sum already excludes evidence known to be invalidated.

No verified fills still means `saleStatus: UNKNOWN`, including a successfully
scanned empty page. No result asserts unsold status, absence of prior fills,
publication acceptance, cancellation, expiry, current ownership or balances.
`finality`, `cumulativeCompletion`, `onchainOrderStatus`, and USD proceeds are
`NOT_EVALUATED`. The seller net excludes gas. Authorization, spending budget,
quota, resend and relist flags remain false. Expired or revoked execution grants
do not prevent historical read-only observation and do not prove cancellation.

## Focused verification

Run with Node 24:

```sh
node --test tests/task-listing-observation-consumer.test.mjs
```

The focused consumer suite uses a synthetic injected observer and a synthetic
canonical reader. It tests durable cursor recovery, encrypted-store restart,
CAS concurrency and monotonic invalidation merges, duplicates/conflicts, cumulative quantities/proceeds, reorg
invalidation and same-fill replacement, source/depth/binding failures, fail-closed
persistence and absence of unrelated store mutations. These tests validate the
consumer contract, not the real ArtFi observer/evaluator composition. That
end-to-end boundary is tested separately by the composition suite using the
actual ArtFi factory. No real RPC, key access, signing, broadcast, publication,
cancellation, deployment, PR/main change, or genuine-chain acceptance is implied.
