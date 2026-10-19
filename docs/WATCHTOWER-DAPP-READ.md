# Stage 5 optional watchtower DApp read

Trace: retained full Wallet PRD Stage 5, section 5 Trading/Custody and Appendix B. This adds a missing DApp consumer of the existing RpcWatchtowerReader, buildFreshnessView and renderFreshness. It does not replace their enum, ABI, finality logic or the selected WalletSession. Standalone use remains independent of a watchtower.

The login-protected native page accepts the existing strict feed-continuity declaration schema (16 KiB maximum), verifies its projection identity against the selected token, and explicitly reads only its asserted-current feed through the already-selected same-chain provider. No imported URL, credential, auto-connect, chain switching, polling, feed registration, signing, transaction, persistence or runtime configuration change is added.

The projection query and current freshness are rendered as distinct blocks. FRESH_FINAL remains the contract's raw ordinal rendered by the existing SDK as reorg-safe, never as registrar finality. STALE remains distinct from a provisional historical answer. Pairing and all predecessor links remain UNVERIFIED_CONFIGURATION; no feed predecessor is queried or used as fallback. A failed observation clears both panels; it is not an empty successful response.

The panel checks verified login before reads and publication, and guards provider calls against selection/session/lifecycle changes. It clears output on logout, token edits, summary invalidation, hidden-page/navigation events and page restoration. No raw provider exception text is displayed. All user-source data is rendered as text. The same declaration can be reviewed/exported through the separate existing continuity panel; this observation does not promote that review into verified lineage.

Reads are sequential live reads, not one block-pinned atomic snapshot and not the watchtower status at the historical query instant. No cryptographic attestation verification, bytecode trust assessment, legal identity, remedy advice or transaction authority is claimed. Deployment-specific watchtower bindings must come from the existing approved configuration; none is supplied here.

## Validation handoff

Authored test source is `tests/watchtower-read.test.mjs`. The focused regression command is `node --test tests/watchtower-read.test.mjs`; it has NOT_RUN status and is not automatically included in the current npm test script. Required follow-up includes typecheck/browser emit, exact-source regression selection, package inclusion, synthetic DOM logout/late-response cases, actual provider/device observations and independent review. No syntax check or product test has been executed by this development task.

This is a bounded initial Stage 5 consumer increment, not completion of Stage 5, full PRD, or production deployment.
