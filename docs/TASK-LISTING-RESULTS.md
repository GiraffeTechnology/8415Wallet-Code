# Listing results in the task service and UI

This increment connects the existing durable seller-listing observation consumer
to authenticated task reads, the existing bounded background runner and the native
six-language task UI. It adds no marketplace, signer, grant, RPC endpoint, key,
order-cancellation operation or budget-release path.

## Server composition

`createTaskListingResults` in `server/task-listing-results.mjs` takes only
server-owned configuration:

- `store`: a durable observation store, separate from the grant/bridge/native stores;
- `observationSource`: the bound native composition's `observation` method;
- `canonicalReader`: the fixed source ID and read-only reader;
- `observationPolicyId`: the fixed ArtFi observer policy ID;
- `now`: the service clock.

Pass the returned `{ read, scan }` object as `listingResults` to
`createTaskAuthorizationService`. The service captures the methods once. A
public request cannot supply this object, evidence, quantities, cursors, provider
methods or a source/depth override.

The result factory rebinds the immutable Wallet task and child to the actual
ArtFi order, including actor, chain, NFT, requested quantity, native plan and
operation, reviewed order hash and typed-data digest, valuation digest and quote
evidence digest. It constructs the original durable consumer, including the
unchanged ArtFi canonical order digest. A fresh consumer object reopens the same
persisted task/child slot; it does not reset the cursor or duplicate a fill.

`listingInput` supplies the original attempt executor/grant version, immutable
valuation and observation policy. Revocation's later grant version is not used
to impersonate the earlier signing attempt.

## Reads and continuation

- `tasks/status` and each entry in the existing bounded `tasks/list` page call
  only the consumer's `readSummary`. They revalidate persisted canonical anchors
  but never invoke fill discovery, planning, signing or publication. Internal
  freshness/reorg metadata is durably updated by the consumer.
- The service checks the authenticated owner before the read and again after
  asynchronous source work. A lost session or changed owner entitlement cannot
  release task results after the read.
- For an existing submitted listing, one `tasks/resume` or background step calls
  at most one consumer `scan`. The underlying observer's fixed page/range/candidate
  limits apply. There is no scan-until-complete loop in a read or continuation.
- An observation never changes the grant, budget, reservation, order submission,
  operation quota or signing/publication journal.
- Existing submitted orders continue to be observed after logout, task expiry or
  grant revocation. These states do not authorize a new signature, publication,
  replacement, reprice or cancellation.
- `listing-observed-at-depth` is deliberately not a terminal background state.
  The existing bounded backoff continues to revalidate it for later reorgs.

`withAuthorization` additionally permits the server-only `prepare` and `observe`
read-gate purposes needed by the native journal adapter. Preparation still needs
an active grant and current valuation window. Observation grants only access to
an already-approved task; it does not call `requireActive`, renew it or enter a
sign/publish branch. This is not an HTTP authorization API.

## Public result and presentation

The version-2 task view retains its separate publication/authorization facts.
When configured, `listing.result` contains `{ state, summary }`, where `summary`
is the durable consumer's validated `TASK_LISTING_OBSERVATION_SUMMARY`.

| Result | Meaning |
| --- | --- |
| `listed` | Publication was recorded and the current bounded observation has no verified fills. This is not proof of an unsold order. |
| `partial` | The durable canonical fill quantity is positive but below the requested quantity at the authorized depth. |
| `observed-at-depth` | The requested quantity has been observed at the authorized depth. |
| `unknown` | The order has not been observed, or current evidence is unavailable/stale. |
| `reorg` | Evidence was invalidated or needs reconciliation following a detected contradiction. |

The completion field uses `listed-awaiting-evidence`, `listing-partial`,
`listing-observed-at-depth`, `listing-unknown` and `listing-reorg`. No listing
result uses the exact-transaction `completed-at-observation-depth` state.

The UI normalizes all returned bindings, quantities, accounting sums, freshness,
flags and result-state consistency before rendering. Current quantity, gross,
fees and seller net are displayed only from a fresh durable aggregate. A stale
or invalidated result has no current aggregate. Historical raw evidence remains
explicitly stale; hidden or closed UI views clear current freshness and totals.
The browser cannot increment quantities from a client hint or publication
acknowledgment. Repeated reads never add a fill.

The raw consumer fields remain `NOT_EVALUATED` for ERC/economic/legal finality,
cumulative commercial completion, on-chain order status, ownership, balances
and USD proceeds. Confirmation depth is only a point-in-time canonical-chain
observation. Token-proceeds amounts use base units and seller net excludes gas.
The six fixed catalogs explain these boundaries without translating canonical
identifiers or source facts.

Legacy exact-operation results, older version-1 NFT-sale grants, task revocation
semantics and the unsupported-adapter fail-closed UI remain unchanged.

## Focused verification

No complete old package suite or live RPC is required for these checks:

```sh
node --test tests/task-listing-results-service.test.ts tests/task-authorization-ui.test.ts tests/task-listing-authorization.test.ts tests/task-background-continuation.test.ts
npm run typecheck
npm run wallet:browser:build
```

A separate cross-module composition test uses the actual ArtFi native
port, evaluator and observer, a synthetic publication/signing fixture, the durable
consumer, task service and actual browser client. It covers authorized publication,
logout/revocation, quantity deduplication, encrypted restart and reorg invalidation.
The fixtures prohibit real network access and contain no real keys or credentials.
They do not establish production adapter/RPC acceptance.
