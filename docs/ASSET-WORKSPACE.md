# Asset workspace: standalone and optional linked records

Initial product development. Preserves original PRD §§1–8 plus §9; does not replace W-01–24.

The existing DApp had separate read buttons and raw linked/payment output, but no unified, navigable asset workspace. This addition composes existing read surfaces rather than reimplementing projection, kernel or payment execution. No earlier submitted implementation is repaired here.

## User journey

After the existing verified login and original asset connection, open Asset and history workspace inside wallet-private. Enter an explicit Unix-seconds instant, optionally select a responsibility sequence, and request one read. Switch among asset, temporal answer, bounded register history, optional dual histories, responsibility window and optional payments. Next register-history page advances the absolute admission version, never a window-relative occurrence.

Standalone mode needs neither a control nor escrow. A linked sequence with no payment adapter still renders control evidence, active legs, detached records/count/commitment, return boundary and predicate preview. Optional native payments are read by exact leg ID at the linked snapshot block. Detached payment IDs may be supplied through the programmatic API; no window index is guessed. Payment errors do not turn responsibility back into active, returned or completed.

## Interfaces

src/wallet/assetWorkspace.ts provides readAssetWorkspace and readRegisterHistoryPage; src/wallet/renderAssetWorkspace.ts preserves the existing semantic renderers. web/asset-workspace-panel.mjs is mounted through the existing app's captured connected context, with original WalletLogin capture/assert/check before reads and publication. Account/chain/session/page transitions discard outputs and stale responses. No raw backend error text or HTML is published.

History pages contain 1–64 entries in original admission order, exact version cursors and total observed entry count. Pages never silently omit a failed entry. Dual full histories are opt-in, with an entry-count guard of 512 for this UI path; larger chains keep bounded register navigation, while full ownership/settlement reads are explicitly unavailable rather than empty. This is an engineering input guard, not a protocol or active-window limit.

Sections have ready/unavailable/not-requested states; failures remain distinct as transport, contract-revert, uninitialized or invalid/unsupported. No optimistic action or cached successful substitute is generated. All reports have canExecute=false.

Standalone reads retain existing display-read semantics and are NOT claimed atomic with linked snapshots. Linked reads must match exact asset/sequence and block; canonical hash is checked again after optional payment reads. Protocol finality, commercial control outcome, payment lifecycle, freshness and legal title remain separate.

## Delivery boundary

Eight synthetic tests authored, not executed. This increment did not inspect CI, deploy, sign or broadcast. Source-delivery readback is not compilation, browser observation, provider acceptance or product PASS.

Manual Linux/UI acceptance: existing login and connection required; missing sequence/unsupported controls; no-payment versus configured payment; failed payment; detached prefix and active tail; version pagination; unavailable entries; logout/expiry/account/chain change during reads; canonical block changes; mobile layout and full labels. Real provider and receipt evidence remains necessary for runtime acceptance.
