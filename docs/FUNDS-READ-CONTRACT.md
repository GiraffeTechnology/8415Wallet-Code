# Authenticated funds read contract

This common V2/V3 adapter implements the read boundary for approved PRD §10.4.
It does not deploy or configure a production inventory, RPC, principal ledger,
credential, valuation feed or transaction executor. Missing adapter configuration
is `FUNDS_NOT_ENABLED` (503), not an empty wallet or a zero balance.

## Server-owned injection

`createAuthRuntime({ fundsReader })` forwards the explicitly supplied process-level
capability to `createAuthService`. The service accepts only a reader exposing
`readForPrincipal(context)`. No HTTP parameter, catalog row, settings scope,
reference balance, grant budget or caller-selected endpoint creates that capability.
Both V2 and V3 `startAuthFromEnvironment({ fundsReader })` preserve the supplied
process-owned capability through startup. The ordinary CLI/systemd entry supplies
no reader by itself: its unconfigured default is deliberately unavailable. The existing authorized
operator must supply and independently verify the actual inventory/ledger binding;
this change supplies no new credentials or configuration permission.

Context is immutable `{ principal, readId }`. Principal contains the authenticated
`tenant`, `origin`, `username`, selected `account`, and selected `chainId`.
The adapter must independently resolve holdings belonging to that principal and
original financial-principal reservations, not neighbors or pooled allocations.
It must verify the chain, current ownership and common block evidence for each
currency's balance and escrow ledger. It must establish inventory completeness;
absence of an entry is not evidence of zero. Adapters must use read-only operations.

The exact source envelope is:

- `schema`: `8415-authoritative-funds/1`.
- `scope`: exact context principal; no additional fields.
- `readId`: exact fresh request nonce, bound by the adapter to this read.
- `observedAt`, `validUntil`: safe integer milliseconds since Unix epoch;
  not future-dated, expiry not before observation. Expiry is freshness, not finality.
- `inventoryState`: `complete`, `partial`, `stale`, or `unavailable`.
- `currencies`: at most 256 existing `CurrencyFundsInput` objects, each with
  at most 4096 original ledger references; see `src/wallet/currencyFunds.ts`.

Currency rows explicitly distinguish wallet-liquid from total-includes-escrow.
The existing model checks exact base-unit arithmetic, currencies/decimals, common
block hashes and unique financial reservation identity. Duplicate identical
reservations count once; conflicting duplicates fail. Unknown principal outcomes
and incomplete escrow enumeration never become spendable zeroes. Source exceptions
are sanitized. No source object or raw ledger is returned to the browser.

The adapter must not refresh timestamps or copy a new nonce onto a previously
unverified snapshot merely to make it look fresh. The service enforces binding and
expiry but cannot prove external ledger correctness from a self-reported object.
Production approval therefore requires evidence for the actual trusted adapter.

## Authenticated HTTP and browser projection

`POST /auth/assets/funds` accepts exactly `{ readId }`, where readId is a 16-byte
hex nonce. Origin, tenant, cookies, CSRF, credential revision, account and chain
come from existing authentication. The credential/session is revalidated after
the asynchronous read; a revoked session cannot receive an authorized result.
This endpoint neither persists reservations nor grants spend authority.

`account.fundsAvailable` reports reader configuration only, not live source health.
`AccountAuthClient.readFunds()` generates the nonce itself and checks the unchanged
session plus the exact response envelope and arithmetic. The response schema is
`8415-currency-funds/1`, with `scope` (tenant/origin/account/chainId only), `readId`,
`state`, `inventoryState`, `observedAt`, `validUntil`, and `currencies`.
Currencies use the existing privacy projection; `canExecute` is always false.

Only a fresh explicitly complete inventory of fully ready rows is `ready`.
Partial enumeration remains `partial`, even if all included currency rows are ready.
Expired inventory is `stale`, and its amounts are suppressed. Unavailable data is
never silently replaced with an empty ready array. A genuinely empty complete
inventory is allowed only on explicit trusted-source evidence.

Each `nftEscrows.nftId` is an opaque authorized source reference; it is not a
contract address/token ID mapping. Each currency row additionally includes `principalRecords`: either null when the
ledger cannot be verified at this read, or unique original-principal records with
`reservationId`, `nftId`, `amountBaseUnits`, `state` (held/released/refunded/unknown)
and `blockHash`. Currency and units are inherited from that row. These records
are deduplicated independently, including all records after an unknown outcome;
the held records reconcile to ready NFT escrow aggregates. Unknown outcomes retain
actual ledger state but suppress computed available amounts. Expired, unavailable
or incomplete evidence is null, never an invented empty event history. These are
current original funding/release/refund states, not fabricated timestamps or
transaction events. Reservation identifiers are owner-authorized opaque references,
not counterparty identities. The UI renders them read-only under the NFT reference.
No metadata, artwork, adjacent-wallet identities, valuations, rollback completion,
real deployment or complete NFT inventory is implied by this endpoint.

## Local synthetic evidence and remaining acceptance

`tests/funds-http.test.mjs` exercises actual loopback HTTP with synthetic account
and server-owned source fixtures: positive balances, duplicate escrow, unknown
outcomes, partial/stale/unavailable inventories, strict caller input, account and
chain binding, exact source context, replay/future time refusal, no-source errors,
privacy/arithmetic decoder guards, missing auth/CSRF and logout during source await.
These tests are not live RPC, real asset, deployed service or production acceptance.
Actual served SHA, authoritative inventory/ledger adapter, runtime/store binding,
production account coverage, UI mounting and versioned package verification remain
separate evidence. No 56-case historical-green suite was repeated.
