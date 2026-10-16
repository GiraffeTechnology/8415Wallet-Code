# Stage 5 optional Kit DApp reader

Trace: full Wallet PRD sections 2.1-2.4 and Stage 5. This is an initial browser consumer of the existing KitProjectionApi and KitErc8415Reader, not a new API, indexer or protocol. It composes Kit projection reads with the existing selected direct-chain reader; ownerOf, ERC-165 discovery, chain clock, settlement records/period, authority and logs are not index facts.

The native-page panel requires verified login and the selected same-chain wallet. The operator enters an existing approved same-origin base path; no default path or deployment is invented. It accepts neither imported URL nor API key. It sends credential-omitted, no-store, nonredirecting GET requests only on the adapter's projection routes. Cross-origin and private/authenticated Kit support are deliberately not configured; the latter needs an existing reviewed server boundary, not a credential pasted into this page.

A temporary read-only WalletSession enables both identity checks against the direct chain. Identity disagreement, unreachable/unauthenticated transport and unsupported/uncovered projection answers retain the existing SDK semantics; none is converted into an owner fallback. The normal connection and execution session are never replaced. UI output is text-only, raw backend exceptions remain hidden, and logout/selection/lifecycle invalidation clears results and prevents late publication.

Display reads are sequential current reads, not atomic execution or historical-chain snapshots. No action, attestation, legal identity, production readiness or completed deployment is implied. A bad Kit path does not disable standalone direct-chain operation. Actual approved routes, authentication, indexing health and Kit/chain deployment matching remain runtime acceptance work.

## Validation handoff

Focused regression source: tests/kit-dapp-read.test.mjs; proposed existing authorized Linux command `node --test tests/kit-dapp-read.test.mjs`. It is not added automatically to the current npm test list. This development task has executed no syntax/test/typecheck/build/package/provider/chain command. Bear owns ordinary verification/CI/merge. Include exact-tree browser emit, packaging closure, synthetic DOM late-response/session tests and actual backend observations before any acceptance claim. Private backend configuration, new routes, credentials or infrastructure are not created here.

This PR is an independent initial Stage 5 increment after the watchtower consumer. It is not completion of Stage 5 or the full PRD. The transferred three-wallet test task and frozen PR102 remain untouched.
