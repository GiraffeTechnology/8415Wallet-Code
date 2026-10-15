# Hoodi three-wallet release/history evidence

Development batch for CMD-ARTFI-FULL-DEV-20261016-0011-002. Scope: PRD §§4.2, 4.4, 4.10, 5 (rights and record instants), 6.1/6.5, 9.2/9.4/9.5/9.6 and the specified three-wallet journey. This does not replace all W-01–24 or equate this scenario with W-20.

## Implemented entry

Direct TypeScript module: src/wallet/hoodiJourney.ts.

- captureHoodiRelease(manifest, observation) copies and freezes the then-known v2 release record.
- compareHoodiReleaseHistory(original, laterV3, pinnedRead) queries the SAME asset at the ORIGINAL release instant using an injected block-pinned reader.
- renderHoodiReleaseHistory(report) displays original v2 commitment/time and later v3 commitment/effectiveAt/actual admission separately.
- serialiseHoodiJourney(record) preserves bigint values as decimal strings.

Only the exact three tenant labels Xiongan, Giraffe and Lala are accepted, with three distinct existing accounts. Hoodi chain/genesis are fixed; contract/token/register/profile/accounts are mandatory inputs with no defaults, discovery, private keys or RPC fallbacks. No fourth/fifth actor or payment is invented.

The original release record includes leg/control identity, exact accepted-condition/terms digests, owner and admitted-holder occurrences, actual token owner/result transaction, original v2 entry/admission, and release receipt block/hash/time. Occurrence numbers are NOT derived from address order. This assembler validates consistency, not signatures or occurrence proofs. The existing control/execution adapter must independently authenticate all inputs; a caller-supplied receipt or this report never authorizes release.

## Specified version contrast

Original v2 must have been admitted by release. Later v3 must be the next version, extend v2 commitment, carry strictly later effectiveAt than v2 but effectiveAt <= original release time, and be actually admitted AFTER release. The new query must return that exact v3 entry under the same register/profile/token and original instant. Reader exceptions propagate. The pinned block hash is checked before and after reads; identity and block timestamp are checked. Original evidence is never updated. No late admission revives detached obligations or rewrites completed outcomes.

PinnedJourneyRead is an adapter contract, not proof that an arbitrary injected reader really pins eth_call. The authorized executor must bind every RPC/Kit call to the exact canonical block and collect genesis, code/delegation classification and all applicable receipts. A changed canonical block fails this report; full reorg/receipt verification remains executor work.

## Execution and privacy boundaries

This module has NO signer, sendTransaction, deployment, release, callback, refund or transaction retry path. canExecute is always false. It records an existing decision, not a new one. No synthetic example may be presented as a chain run. Confirmed control/token/payment receipts are collected separately by the authorized executor. No escrow requirement is introduced. Failed optional payment remains separate from responsibility completion.

Applications must require the existing verified wallet login before fetching or showing protected asset/history data. This formatting function is not a login service or UI privacy boundary. Do not publish operational manifests, account bindings, bearer tokens, personal credentials or raw signatures.

The exact forum target is https://ethereum-magicians.org/t/8415wallet-an-erc-8415-based-wallet-now-available-for-beta-testing/29945/4 . Its content was inaccessible during authoring; the explicit supplied task conditions govern this implementation. No alternate forum post or page instruction was substituted.

## Handoff

Ten test cases supplied in tests/hoodiJourney.test.ts are synthetic AUTHORING ONLY. They were not parsed, compiled or run by development. Bear/Xiongan owns Linux tests, CI, all post-submission modifications, audit and merge. Ops READY, existing accounts/provider/token/control/authority bindings and actual release/v3 receipts are mandatory for real use. When Bear cannot SSH, Control itself owns authorized deployment/chain execution, never the Wallet developer.

The author used GitHub source APIs only: no local Windows application generation, no server writes, no CI inspection/rerun, no signing/broadcast, no fixed communication MD writes. Older PR87/89–94 are acceptance-owned and untouched.

## Continuous development queue (24–48 hours, not an acceptance deadline)

1. This batch: complete same-asset evidence contract, original/late-history comparison, read-only report, authored negative cases and integration instructions.
2. Next independent batch: desktop/mobile consumption of this report through existing login-protected asset history, preserving unavailable and identity-change states. Real addresses/RPC/receipts are not needed to author the adapter seam.
3. Standalone foundation: compose current/history/ownership/finality/gap/risk/freshness across direct RPC and Kit without changing their authority; preserve Sections 7–8 and Stage 0–5.
4. Task lifecycle: initial development of remaining authorization/continuation/reconciliation entrypoints, excluding Claude-owned producer/receipt/P0 paths and previously submitted repairs.
5. Linked mode: initial full no-payment and optional-payment journeys, rolling-window/detached history and absolute-occurrence presentation, reusing original controls rather than treating payment as authority.
6. Source-bound interface, install/run/recovery documentation and unexecuted test-source batches. Immediately continue independent functionality after submission; do not wait for a new test result or task-by-task dispatch.

Bear owns requirement coverage and any >80% determination. No percentage or full-product acceptance is claimed here.
