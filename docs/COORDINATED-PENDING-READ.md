# V3 coordinated Pending read contract

This is a read-only V3 integration, not a transaction executor, authority grant,
release approval, production deployment, or on-chain acceptance report.

## Sources and interpretation

The complete canonical PRD remains `ERC-8415-Wallet-PRD.md`, SHA-256
`3a4ac57c8cfec42b51799a26cf89ac91bc7218a14265c95e62493d5d6a95a39f`.
Sections 9.2, 9.5 and 10.6 govern this view. Native payment states come from
`NativeResponsibilityPayments.payment`; actual terminal outcomes come from
`ResponsibilityController.legTerminalOutcome`. Neither a journal state nor
registration lag implies return, refund, settlement or authority.

`createRpcCoordinatedForwardProgressReader` composes existing history discovery,
unique principal entitlement and milestone validation. At one canonical block,
it resolves the authenticated principal's unique occurrence, reads pinned native
payment state and controller terminal state, checks payer/payee against the
controlled account owners, and revalidates entitlement and canonicality. It
supports only the already implemented native payment adapter. Missing payment
pin is explicit unknown, not zero or unfunded. The bounded payment-record read
limit is resource availability, not a new protocol limit.

Unfunded is admitted only from the pinned adapter's empty record. An accepted
leg cannot still have Reserved state (reservation is consumed atomically).
SettlementDue/Settled require Completed; RefundDue/Refunded require Returned.
Controller terminal records are used even after a completed leg detaches.

## Public DTO and freeze boundaries

Strict `8415-forward-progress/1` remains unchanged. `/2` adds `coordination`
(block number/hash, source revision, entire-chain known/scale end), and replaces
funds/rollback with exact-key projections decoded by `web/coordination-view.mjs`.
No private controller reader or execution import enters that public decoder.

The original forward display milestone stays frozen at its historical block.
Coordination is independently anchored and can advance while forward is frozen.
Fund records include only the authenticated occurrence's incoming/outgoing leg,
position, amount, state and factual location. They expose no leg identifiers,
private source data, account names, addresses, payers or payees. Settled funds
are at the seller position; refunded funds at the original buyer position.
Held/due funds have no invented wallet-location marker. Do not collapse original
payer refunds into one pooled marker at the NFT return boundary.

Rollback identifies the terminal Returning/Returned suffix of the accepted
sequence, excluding permanently completed prefixes. `tokenState=returned`
requires all actual return hops and owner at that boundary; holder position is
shown separately. `fundsState=pending` preserves funded/refund-due partial
failure. `fundsState=not-required` means verified empty payment records, not
missing configuration. Overall rollback DONE requires actual NFT return,
admitted holder at the same boundary and every corresponding funded payment
refunded. It creates no new condition on rights or execution.

Rollback DONE freezes its independent observation. Each later read re-reads and
compares that exact canonical observation; reorg/unavailability is refused, not
silently rewritten. Forward and rollback persistence use existing credential
and record CAS. No new credentials, transaction retries or budget releases occur.

## Integration and evidence limits

The existing trusted V3 runtime supplies provider/controller pin and optionally
a native payment pin. This source adds no browser-selectable endpoints or config
credentials. V2 must not import this reader; it can retain `/1` not-evaluated.

Inherited H8 coverage remains **positive canonical block-end discovery only**.
No found historical DONE is not complete intra-block history. Ambiguous repeated
owned occurrences and unavailable source coverage remain unavailable; this work
does not claim to solve those existing source limitations.

New tests cover real authenticated loopback HTTP with synthetic source/store and
actual payment ABI/runtime verification with entitlement/history transport
doubles. No external RPC, real transaction, deployed runtime, physical device,
production store, security audit or UI/browser acceptance is established.

The V3 `auth-service.mjs` source factory now selects the coordinated wrapper;
source options are supplied only by existing service composition. Alternatively,
`withRpcCoordinationReader(trustedHistoryReader, options)` attaches the same
canonical financial reader to an existing service-owned full-history reader.
It captures that reader's methods; it does not reinterpret incomplete history as
complete. Missing intra-block proof cannot be repaired with ordinary block-end
`eth_call` alone. Existing logs/receipts authenticate event order and detached
records but do not by themselves reconstruct every post-transaction owner,
admitted holder, account-entitlement and runtime snapshot. Such a source needs
independently verified transaction-bound state reconstruction and explicit
coverage, not an optimistic `historical: []` fallback.
