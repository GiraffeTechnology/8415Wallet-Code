# Unverified watchtower continuity configuration records

Initial implementation for original Wallet PRD section 5 Custody and Appendix B item 8. Existing WatchtowerBinding already identifies a configured/computed feed and claimed register; it does not carry a predecessor record. This consumer adds that missing configuration record without changing WatchtowerBinding, chain interfaces, freshness classifications, deployment settings or the existing auth/task/receipt paths.

## Declaration contract

Input is a local JSON document, schema 8415wallet-feed-continuity/1, with exactly:

- projection: chainId (positive canonical decimal string), contract (lowercase nonzero address), registerId (lowercase nonzero bytes32).
- feeds: an ordered array of one through 32 existing feed identities. Each contains exactly chainId, address and assetId with the same canonical formats.

Feeds are ordered by the importer's assertion: oldest first, current asserted feed last. Each position after the first asserts its predecessor is the previous position. This ordering is not verified; it is not a feed sequence number, chain occurrence, migration timestamp, freshness observation or protocol continuity proof. Repeated identities are retained and visibly marked rather than collapsed; returning to an earlier configuration is not silently prohibited or called verified.

There are no URLs, credentials, API keys, provider selectors, executable values, trust roots, approval flags or caller-supplied verification fields. Unknown fields fail closed. The 16 KiB document and 32-record bounds are interactive work limits, not protocol rules. No actual deployment address, feed or migration is invented by this schema.

## Authenticated DApp journey

After verified login, select an existing approved standalone projection and token. In Watchtower feed continuity declarations, select the existing public configuration document and review it. The consumer captures the document before asynchronous reads, compares its projection chain/contract with the selected reader, and uses the existing assetView conformance/pinned-identity path to match registerId. It records that projection identity at the observed chain instant.

Matching projection identity does not verify the register-to-feed pairing or any predecessor edge. All such relationships remain UNVERIFIED_CONFIGURATION in the preview and downloadable review. The consumer never constructs a watchtower reader, queries an imported feed, switches a runtime feed or inherits an old feed's freshness, head or sequence number. A predecessor on another chain remains only an assertion, not a bridge or a cross-chain proof.

A separate explicit download rechecks login and selection, then creates a local JSON Blob. Token/file edits, account/session transitions, navigation away, hidden document and page exit erase the in-memory preview and reject late replies. No localStorage, IndexedDB, service configuration or server write is added. A downloaded file cannot be erased by logout; protect it appropriately. Rendering uses textContent and shows no raw backend errors.

## Source and verification boundary

This initial entry stacks on PR100 and does not change its audit export. App wiring is additive; existing CLI, SDK freshness, authorization, P0 producer/receipt and signing modules are untouched. It is deliberately not a production migration tool or a hardware-device integration.

Eight regression cases are authored, NOT_RUN. No developer test/typecheck/build/browser/CI/deployment/signing/chain execution occurred. Bear owns all post-submission corrections, Linux verification, integration acceptance and merge. Required independent checks include package/module inventory, authenticated native-page preview/download, file limits, stale replies, wrong projection/register, repeated identities, and absence of feed network calls/configuration mutations. Source presence is not physical-device, live-feed, chain or full-product acceptance.
