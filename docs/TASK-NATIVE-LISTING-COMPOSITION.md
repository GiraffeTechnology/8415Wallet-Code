# Native seller-listing composition candidate

This additive server-only candidate composes Wallet's frozen task and listing
child contracts with ArtFi's real native seller-listing port, terms verifier,
official SDK path and read-only listed-order observer. The additive `task-listing-runtime.mjs` now connects it through `auth-service.mjs`
and `main.mjs`, with a fixed installed ArtFi package and authenticated internal
task-journal adapter. It remains disabled without separately approved operational
inputs. See `TASK-LISTING-RUNTIME.md`; no genuine signer or deployment is configured.

## Modules and authority

`server/task-native-listing-composition.mjs` exports
`createTaskNativeListingComposition`. The composition root explicitly supplies:

- A separate durable `bridgeStore` with `readMany` and `transactionMany`.
- `createNativeNftTaskPort` and its fixed native dependency functions, including
  the real internal task-principal journal. The existing session journal route
  `/v1/nft/operations` is not this transport. A bridge bearer token or fabricated
  session does not establish a task principal.
- The existing `createNftSaleTermsVerifier`, `validation`, `readNftRequest`,
  `kernelRequestDigest` and `ethers` implementations.
- `signer.signTypedData(exactRequest, { signal })`, plus explicit integer
  `signerTimeoutMs` from 1 to 60,000. This is a sign-only external custody
  capability; this module creates no key, API credential, account or approval.
- Fixed `quoteSource(valuationPolicy)` and `requestSource(frozenTask)` functions.
  Their results are persisted once per binding. No caller quote or silent
  quote refresh can replace the child-bound quote digest.
- `createListedOrderObserver` and `observationDependencies` containing official
  order types/ABI, reviewed deployment pins, an authenticated read-only provider,
  source ID, `policyId`, and every explicit scan bound. Approved minimum depth
  comes from the same Wallet grant, rather than an unapproved observer default.
- A server-owned clock. Production clocks and native Date.now must agree.

Create the composition, inject `composition.execution` into the Wallet task
service, then call `connectListingAuthorization(service.listingAuthorization)`
exactly once. No request/HTTP endpoint accepts these dependencies. Existing exact
transaction methods and the synchronous store fence keep their prior semantics.

The additive `listingAuthorization` capability resolves an existing durable
approved grant, verifies its original account principal through the existing
server callback and rechecks task, executor, factor revision, valuation policy,
grant version and child. It cannot create a session, grant or TOTP approval.
Its sign/publish path additionally requires the same child to have crossed the
Wallet's durable outcome-unknown boundary. Its read-only path can inspect the
original attempt after expiry or revocation.

`store.withReadGate` uses the exact same queue as grant, credential and revoke
writes. It holds that queue until the callback actually settles. The callback
must never re-enter the Wallet store. The bridge store is checked against this
mistake; the real native journal must also use a separate store/transport.

## Side effects and recovery

1. The user authorizes the unchanged task digest and explicit valuation policy
   with one atomic TOTP. Logout removes the interactive session, not the grant.
2. The background runner prepares one deterministic Wallet operation. ArtFi's
   real port prepares and persists the immutable unsigned native plan.
3. Exact terms, the approved order-review quote, native review digest and
   typed-data/order hashes construct the distinct listing child. The entire
   task quantity is reserved, even if the owner holds more units.
4. Native review records its durable started claim. If that response is lost,
   the same unsigned plan can be recovered only while this exact Wallet child
   is still reserved and the bridge's durable signing claim remains absent.
   The native read-only recovery snapshot itself grants no signing authority.
5. Wallet persists outcome-unknown. The shared grant gate validates the exact
   plan, commits a separate one-use signing claim and immediately dispatches
   the sign-only request. No returned signature is persisted or logged.
6. ArtFi independently checks the actual signature, current owner/balance,
   counter and existing approval. It holds the same grant gate through the
   native submitted CAS and official SDK publication dispatch.
7. `sideEffectDeadlineAtMs` is the earliest applicable task/valuation/quote and
   maximum-age deadline. Native rechecks that deadline synchronously after
   its last journal await. This does not shorten the listing order's expiry or
   promise USD value at future settlement.
8. A positive publication result is an order reference, never a transaction
   hash or proof of a sale. Unknown outcomes retain all units and permanent
   attempt claims. Recovery observes that same order; it never re-signs,
   republishes, reprices or relists.

The signer timeout aborts the provided signal but **does not race or discard**
the signer promise. The grant gate stays held until it settles, including after
abort. A queued revoke cannot be reported as preceding an unresolved side
effect. An abort, transport failure or malformed signature result retains
unknown state. The configured signer must implement bounded abort/settlement;
a transport that ignores abort and never settles can hold the single-writer
queue and requires operational intervention. Native RPC/SDK/journal timeouts
must likewise be explicitly configured and settle their actual operations.

Revocation that wins the gate prevents new signing/publication. Revocation
ordered after publication dispatch does not retract an already-published order.
No cancellation, buy, approval transaction or unlimited approval is added.

## Read-only quantity evidence

`composition.observation(input)` returns the stored frozen terms order and a
captured real observer under `{ observe }`. Supply that object to
`createTaskListingObservationConsumer` with the exact child, order, chain,
source, minimum depth and quantity binding. The consumer persists its own
cursor and stable fill IDs, revalidates historical block anchors, and reports
fresh/stale cumulative quantities and token proceeds. Reorg evidence is
monotonic, including later read failures and concurrent writes. Neither it nor
this composition modifies spending quota. See
[TASK-LISTING-OBSERVATION-CONSUMER.md](TASK-LISTING-OBSERVATION-CONSUMER.md).

The legacy task status still says `listed-awaiting-evidence`; the new consumer
summary is a separate server-only result. An HTTP/background/UI connection for
that summary is not supplied here. Depth is not protocol finality, cumulative
quantity is not a USD settlement guarantee, and publication is not settlement.

## Interface and package boundary

The Wallet module imports only its own `taskContract.ts` and Node built-ins. It
must not import an executor's temporary sibling checkout. The inert installed
runtime probe imports the actual two new Wallet source modules. That proves the
Wallet-side import closure, not installation of the external ArtFi runtime.

Required compatible interfaces are:

- Wallet listing child `8415-nft-listing-child/1`, task grant/budget/reference v2,
  unchanged `8415-agent-task/1` digest and bare-hex valuation SHA-256.
- ArtFi native listing reference `artfi-native-nft-listing-reference/1`,
  `readPublication().recoverySnapshot`, and the mandatory active-boundary
  `VerifiedNftTask.sideEffectDeadlineAtMs`. Original Wallet base64url grant
  references, including `grant:_...` and `grant:-...`, remain unchanged.
- ArtFi order `artfi-nft-sale-order/1`, observer cursor
  `artfi-listed-order-cursor/1`, and existing official Seaport 1.6 ABI/types.

The isolated integration manifest pins actual source bytes and package-lock
versions. The cross-library test loader strips real ArtFi TypeScript and
replaces only the inert `server-only` import marker; it does not replace the
port, engine, validation, terms, observer or evidence evaluator. Production
must import equivalent compiled server modules through its approved build.

## Runtime wiring and deployment inputs

The later local runtime increment supplies the former auth-service/main bootstrap,
Go task-principal transport, and consumer HTTP/background/UI connection. See
`TASK-LISTING-RUNTIME.md` and `TASK-LISTING-RESULTS.md` for the fixed schemas,
installed package boundary, remaining operational inputs and evidence limits.
Those modules are actual code; their presence does not establish deployment,
genuine signer/device access, a public listing or release acceptance.
