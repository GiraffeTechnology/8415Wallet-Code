# Custody audit export in the DApp

Initial consumer entry for original PRD section 5, Custody; preserves sections 3, 4.4 and 6.1. It exposes the existing WalletSession.auditTrail implementation without rewriting its SDK, protocol semantics or transaction paths.

## Journey

After verified wallet login, load the existing approved deployment and select its token in the standalone/native page. Choose Read audit preview. The page reads through the existing selected WalletSession, shows the complete public audit JSON as text, and enables a separate Download reviewed JSON action. Download rechecks login and selected wallet/token before creating a local browser Blob. No upload, registry resolution, signature, transaction, credential import or persistent browser record is added.

The native page is the only mounting target. Logout/session changes, token edits, leaving that page, hidden document and page exit clear the in-memory preview and invalidate late responses. A file already downloaded belongs to the user and cannot be erased by logout. Protect it appropriately: publicly readable chain history can still be privacy-sensitive.

## Read and evidence semantics

Existing assetView conformance and immutable identity checks precede projection reads and repeat after export. Entry count must remain unchanged and match the exported entry count. The consumer rejects source/token substitution, undeclared fields, narrowed integers and malformed audit schema. Decimal strings are retained, with every version and gap transition kept in the SDK's original order.

These checks do not make multiple live reads an atomic block snapshot. An unchanged entry count does not prove no ownership/gap change occurred. The panel states this explicitly; the file remains the existing erc8415-wallet-audit/1 schema, not a canonical receipt, legal certification, freshness/finality proof, grant or authorization. Wall-clock exportedAt is not the protocol instant observedAt. Registry references are opaque and no off-chain record is fetched.

A false settlementLog.available is preserved as unavailable, never rewritten as proof of no gaps. A rejected read yields no downloadable partial file. Existing chainIntact and linkFaults are displayed and exported, not silently repaired.

The 512-entry preflight, episode/event bounds and 2 MiB output ceiling are interactive work limits, not protocol history limits. Histories beyond these limits require an existing separately configured SDK/CLI workflow; no truncation or clean partial report is produced.

## Source-only handoff

Stacked on PR98. New modules are web/audit-export.mjs and web/audit-export-panel.mjs; app.mjs has additive mounting only. Existing authorization, producer, receipt, signing, journal and deployment modules are untouched.

Eight regression source cases are authored, NOT_RUN. No tests, typecheck, build, browser, CI inspection, deployment or chain execution was performed by the developer. Bear owns Linux validation, post-submission corrections, integration and merge. Verify actual package inventory/module resolution, authenticated desktop/mobile interaction, download behavior, unavailable history, file limits and lifecycle invalidation on the exact candidate. Synthetic source tests do not prove real UI/provider/device acceptance.
