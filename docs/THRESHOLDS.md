# Wallet thresholds: provenance, visibility and decisions

Every numeric bound that can refuse an operation, with where it lives, what it
bounds, what a refusal looks like, and where the number came from. A bound is
**authoritative** when the PRD or the ERC states it, **derived** when a type or
format fixes it, and **local** when it was chosen here.

This file is written alongside the fixes it records, not ahead of them. The
status column states what is true now, not what is intended.

## Decisions taken on the audit

| # | Item | Decision | Status |
| --- | --- | --- | --- |
| 1 | Deployment config refuses ~30 defects with one code and no field name | Per-condition codes naming field and bound, plus a documented field reference | Specification for the deployment-path writer |
| 2 | Hoodi genesis is a compiled-in constant with no config key | Becomes a required config field, still verified against block zero | Specification for the deployment-path writer |
| 3 | Funding shortfall reports no amounts | Add a read-only preflight that reports the computed cost; the gate itself unchanged | Specification for the deployment-path writer |
| 4 | Login, challenge, attempt and rate budgets are compiled in | Become config fields, defaults exactly today's values | Specification for the deployment-path writer |
| 5 | Evidence panel refuses every defect as one message | Name which rule refused; never the file content | **Done** |
| 6 | 30-day profile bounds chosen locally | Values kept, published as this profile's terms | Pending |
| 7 | Closed read-method allowlists report a write refusal | Stay closed; the refusal names the method asked for | Specification for the deployment-path writer |
| 8 | Three separate chain lists | Documented together; refusal names the refusing policy | Pending |
| 9 | Scan and page work caps | Name the cap in the refusal and document it | **Done** |
| 10 | `MAX_JOURNAL_LEGS` alongside the PRD's 128 | Documented as implementation capacity, distinct from the protocol bound | Pending |
| 11 | A year-long threshold decided what was remarked on | Threshold dropped; the drift is always reported | **Done** |
| 12 | Remaining capacity caps | One reference table; each refusal names its limit | Table started below |

## Authoritative

| Bound | Value | Where | Source |
| --- | --- | --- | --- |
| Legs unresolved at once | 128 | `src/controls/responsibility.ts`, `src/wallet/linkedChainView.ts` | PRD section 9 and AGENTS.md |

## Local, now refused by name

| Bound | Value | Refusal | Where |
| --- | --- | --- | --- |
| Tokens per collision scan | 32 | `COLLISION_TOKEN_BUDGET_REFUSED`, carrying `limit` | `src/wallet/collisions.ts` |
| Entries per collision scan | 2048 | `COLLISION_ENTRY_BUDGET_REFUSED`, carrying `limit` | `src/wallet/collisions.ts` |
| Register-history page | 1 to 64, default 16 | `WORKSPACE_PAGE_LIMIT_REFUSED`, stating the range and the value asked | `src/wallet/assetWorkspace.ts` |
| Evidence file size | 65 536 B | `EVIDENCE_FILE_TOO_LARGE`, stating the bound, distinct from a missing file | `web/hoodi-journey-panel.mjs` |
| Evidence integer fields | decimal strings | `EVIDENCE_INTEGER_INVALID`, saying JSON numbers are not accepted | `web/hoodi-journey-panel.mjs` |
| Evidence envelope shape | exactly `original` and `laterV3` | `EVIDENCE_ENVELOPE_INVALID`, naming both keys | `web/hoodi-journey-panel.mjs` |
| Evidence session binding | account, chain 560048, tenant | `EVIDENCE_SESSION_MISMATCH`, naming what must match | `web/hoodi-journey-panel.mjs` |

Those four are tagged refusals, so only wallet-authored text can reach the
page: an untagged failure, including any error from the pinned read, still
shows the generic message and a regression holds that apart.

The integrated `web/app.mjs` displays the typed `CollisionScanError.code` and
its numeric `limit`. Untyped provider failures retain the generic refusal; their
message text is never used as a trusted threshold.

## Local, no longer a threshold

| Bound | Was | Now |
| --- | --- | --- |
| Future effective time flagged | 365 days | Any future effective time is reported, with the distance as the fact. The risk surface scores nothing, so no distance decides what is remarked on. |

## Local, still compiled in and not yet named

Each row refuses or truncates something, and none of these numbers appears in
the PRD or the ERC.

| Bound | Value | Where |
| --- | --- | --- |
| Journal legs | 1 048 576 | `src/controls/responsibility.ts`, `src/wallet/linkedChainView.ts` |
| Attestation window | 86 400 s | `src/kit/engine/proof/attestationProfile.ts` |
| Kit page size | 100 | `src/kit/api/routes.ts` |
| Kit body limit | 64 KiB | `src/kit/api/server.ts` |
| Kit and adapter client timeout | 10 000 ms | `src/kit/sdk/js/client.ts`, `src/adapters/kit/kitApi.ts` |
| RPC log window | 10 000 blocks | `src/adapters/rpc/rpcReader.ts` |
| Store size | 4 MiB | `server/store.mjs` |
| Fills, anchors | 10 000 each | `server/task-listing-observation-consumer.mjs` |
| Bounded JSON inputs | 32 768 / 16 384 / 4 096 / 1 024 B | `src/agent/taskContract.ts`, `src/controls/*`, several services |
| Effective time ahead of the clock | 30 days | `contracts/reference/RegisterProjectionReference.sol` |
| Settlement period | 30 days | `contracts/reference/RegisterProjectionReference.sol` |

## Derived, not a judgement

`UINT64_MAX`, `UINT256_MAX`, word and hex widths, the 253-byte domain bound and
the JavaScript date range are fixed by a type or a format and are not listed as
decisions.

## Conformance against the PRD at 7b72d5ad

Section 6.3.1 states that an authorization expressed as the entirety of a
specified asset balance is a defined asset-bounded limit, not a missing numeric
budget, and that execution must calculate available funds, reserved amounts and
actual fees without asking for a redundant numeric authorization.

The existing numeric runtime fields can be filled from a real current-balance
read; they need not be guessed or replaced by an unlimited sentinel. For the
explicitly authorized existing Hoodi ETH test, the execution side records the
actual account/chain/block/time and balance B in wei, then sets both
`fees.perOperationWei` and `fees.totalWei` to B as canonical decimal strings.
This is a cap, not an instruction to spend B. Zero spendable balance cannot
fund gas and is not replaced by another wallet's balance.

`assessChildScope` compares maximum child fees with the per-operation cap.
`reserveTaskBudget` retains noncancelled fee reservations against the total cap;
server CAS binds operation and nonce claims, preserving submitted/UNKNOWN
history. `verifyTaskExactFunding` independently requires the pending balance to
cover the exact outgoing value plus gasLimit times maxFeePerGasWei before a
sign/send. Those checks remain mandatory and must be read together; numeric
budget input alone is neither live funding evidence nor a transaction result.
The executor must reconcile existing reservations and unknown outcomes before
selecting the next send. No cross-wallet/asset balance aggregation is allowed.

A general durable asset-bounded policy expression and PR135 owner-OFF runtime
remain separate implementation work, not prerequisites for the already
expressible and authorized independent native ETH test. This source document
contains no live balance, deployed identity, signer or chain acceptance evidence.
