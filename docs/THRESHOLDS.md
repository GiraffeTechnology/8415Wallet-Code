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
| 5 | Evidence panel refuses every defect as one message | Name which rule refused; never the file content | Pending |
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

The collision limit reaches the page only as its code: `web/app.mjs` displays
`error.code` and not the message. Showing the number needs one line there, and
that file is on the standard startup wiring, so it belongs to that writer.

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
| Evidence file | 65 536 B | `web/hoodi-journey-panel.mjs` |
| Bounded JSON inputs | 32 768 / 16 384 / 4 096 / 1 024 B | `src/agent/taskContract.ts`, `src/controls/*`, several services |
| Effective time ahead of the clock | 30 days | `contracts/reference/RegisterProjectionReference.sol` |
| Settlement period | 30 days | `contracts/reference/RegisterProjectionReference.sol` |

## Derived, not a judgement

`UINT64_MAX`, `UINT256_MAX`, word and hex widths, the 253-byte domain bound and
the JavaScript date range are fixed by a type or a format and are not listed as
decisions.
