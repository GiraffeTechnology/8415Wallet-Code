# Hoodi three-wallet release/history evidence

Development scope: PRD §§4.2, 4.4, 4.10, 5 (rights and record instants), 6.1/6.5, 9.2/9.4/9.5/9.6 and the specified three-wallet journey. This does not replace all W-01–24 or equate this scenario with W-20.

## Implemented entry

Direct TypeScript module: src/wallet/hoodiJourney.ts.

- captureHoodiRelease(manifest, observation) copies and freezes the then-known v2 release record.
- compareHoodiReleaseHistory(original, laterV3, pinnedRead) queries the SAME asset at the ORIGINAL release instant using an injected block-pinned reader.
- renderHoodiReleaseHistory(report) displays original v2 commitment/time and later v3 commitment/effectiveAt/actual admission separately.
- serialiseHoodiJourney(record) preserves bigint values as decimal strings.

Exactly three distinct opaque tenant bindings and three distinct existing accounts are required. Their actual mapping is private deployment input, never a public built-in roster. Tenant identifiers are lowercase bounded identifiers; neither a synthetic example nor this evidence module grants access. Hoodi chain/genesis are fixed; contract/token/register/profile/accounts are mandatory inputs with no defaults, discovery, private keys or RPC fallbacks. No fourth/fifth actor or payment is invented.

The original release record includes leg/control identity, exact accepted-condition/terms digests, owner and admitted-holder occurrences, actual token owner/result transaction, original v2 entry/admission, and release receipt block/hash/time. Occurrence numbers are NOT derived from address order. This assembler validates consistency, not signatures or occurrence proofs. The existing control/execution adapter must independently authenticate all inputs; a caller-supplied receipt or this report never authorizes release.

## Specified version contrast

Original v2 must have been admitted by release. Later v3 must be the next version, extend v2 commitment, carry strictly later effectiveAt than v2 but effectiveAt <= original release time, and be actually admitted AFTER release. The new query must return that exact v3 entry under the same register/profile/token and original instant. Reader exceptions propagate. The pinned block hash is checked before and after reads; identity and block timestamp are checked. Original evidence is never updated. No late admission revives detached obligations or rewrites completed outcomes.

PinnedJourneyRead is an adapter contract, not proof that an arbitrary injected reader really pins eth_call. The authorized executor must bind every RPC/Kit call to the exact canonical block and collect genesis, code/delegation classification and all applicable receipts. A changed canonical block fails this report; full reorg/receipt verification remains executor work.

## Execution and privacy boundaries

This module has NO signer, sendTransaction, deployment, release, callback, refund or transaction retry path. canExecute is always false. It records an existing decision, not a new one. No synthetic example may be presented as a chain run. Confirmed control/token/payment receipts are collected separately by the authorized executor. No escrow requirement is introduced. Failed optional payment remains separate from responsibility completion.

Applications must require the existing verified wallet login before fetching or showing protected asset/history data. The human-readable summary omits tenant roster and holder identities. The lossless serialization retains protected evidence and MUST remain confined to an authorized evidence sink; it must not be exposed through ordinary UI/downloads. This formatting function is not a login service or UI privacy boundary.

The exact forum target is https://ethereum-magicians.org/t/8415wallet-an-erc-8415-based-wallet-now-available-for-beta-testing/29945/4 . Its content was inaccessible during authoring; no claim is made that the reference was verified.

## Handoff

Twelve test cases supplied in tests/hoodiJourney.test.ts are synthetic AUTHORING ONLY. They were not parsed, compiled or run by development. Existing account/provider/token/control bindings and actual release/v3 receipts are necessary for real-use validation. Missing execution capabilities remain explicit gaps.

The author used GitHub source APIs only; no test, deployment, signing or broadcast was performed in this increment.

## Remaining product integration

- Authenticated desktop/mobile consumption of the report, preserving unavailable and identity-change states.
- Standalone current/history/ownership/finality/gap/risk/freshness composition across direct RPC and Kit.
- Task authorization, continuation and reconciliation entrypoints.
- No-payment and optional-payment linked journeys, rolling-window/detached history and absolute-occurrence presentation.
- Version-bound interface, installation, recovery and acceptance evidence.

No percentage or full-product acceptance is claimed here.
