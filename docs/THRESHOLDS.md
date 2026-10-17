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
| 6 | 30-day profile bounds chosen locally | Values kept, published as this profile's terms | **Done** |
| 7 | Closed read-method allowlists report a write refusal | Stay closed; the refusal names the method asked for | Specification for the deployment-path writer |
| 8 | Three separate chain lists | Documented together; refusal names the refusing policy | **Done** |
| 9 | Scan and page work caps | Name the cap in the refusal and document it | **Done** |
| 10 | `MAX_JOURNAL_LEGS` alongside the PRD's 128 | Documented as implementation capacity, distinct from the protocol bound | **Done** |
| 11 | A year-long threshold decided what was remarked on | Threshold dropped; the drift is always reported | **Done** |
| 12 | Remaining capacity caps | One reference table; each refusal names its limit | **Table below** |

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

The collision limit reaches the page only as its code: `web/app.mjs` displays
`error.code` and not the message. Showing the number needs one line there, and
that file is on the standard startup wiring, so it belongs to that writer.

## Local, no longer a threshold

| Bound | Was | Now |
| --- | --- | --- |
| Future effective time flagged | 365 days | Any future effective time is reported, with the distance as the fact. The risk surface scores nothing, so no distance decides what is remarked on. |

## This verification profile's published terms

Two bounds in `contracts/reference/RegisterProjectionReference.sol` are terms of
this profile, identified on chain by `VERIFICATION_PROFILE`. They are not ERC
requirements: the ERC leaves the distance an effective time may sit ahead to
the profile, and the contract's own comment says a profile MAY differ. Both
values are unchanged by this audit, and no new universal restriction is added.

| Term | Value | Enforced at | Refusal | Readable on chain |
| --- | --- | --- | --- | --- |
| `MAX_EFFECTIVE_AHEAD` | 30 days | lines 263 and 450 | `EffectiveAtTooFar()` | No view function; source only |
| `MAX_SETTLEMENT_PERIOD` | 30 days | line 421 | `DeadlineTooFar()` | `settlementPeriod()`, line 381 |

The asymmetry is worth knowing: a consumer can read the settlement period from
the contract, and must read the source for the effective-ahead bound.

## Chain acceptance: four policies, four scopes

Three live in `src/agent/taskContract.ts` and one in the authentication
service. A chain can be signed in on and still refuse an operation, which is
why each refusal now names the policy that refused and the set it checked
against. None of these sets is an ERC requirement; the ERC is chain-agnostic
and these are deployment choices.

| Policy | Scope | Accepts | Refusal |
| --- | --- | --- | --- |
| Asset operations | native, ERC-20, ERC-721, ERC-1155 transfers | 1, 8453, 11155111, 84532 | `TASK_CHAIN_REFUSED`, detail `asset operations accept …; asked …` |
| Control operations | create-account, deposit, standalone-withdraw, complete, return-hop | 11155111, 560048 | `TASK_CHAIN_REFUSED`, detail `control operations accept …` |
| NFT listing child | a listing child of an asset operation | the asset set | `TASK_CHAIN_REFUSED`, detail `NFT listing operations accept …` |
| Session | signing in, not operating | a separate set in the authentication service, including a local development chain | that service's own refusal |

`TaskContractError` keeps `code` exactly as it was and carries the policy in
`detail`, so existing consumers that match the code are unaffected.

The exact-chain funding branch carries a different asset set and a fourth
operation policy: it admits 560048 to the asset set and holds the test-series
mint to 560048 alone. That is a property of that tree, not of this one, and is
stated here so the two are not read as one.

## Legs: a protocol rule and an input guard

| Bound | Value | What it is | Refusal |
| --- | --- | --- | --- |
| `MAX_ACTIVE_LEGS` | 128 | The protocol rule, from the PRD, and it must equal the contract's constant | the controller's own refusal |
| `MAX_JOURNAL_LEGS` | 1 048 576 | A guard on untrusted input. Retained history is uncapped on chain, so this only stops a corrupt snapshot making the validation walk unbounded | `CONTROL_LEG_LIMIT` in `src/controls/responsibility.ts`, `LINKED_SEQUENCE_LIMIT` in `src/wallet/linkedChainView.ts` |

They are not two versions of one limit. 128 bounds legs unresolved at one
instant and detached history does not count against it; 1 048 576 bounds how
many leg records one snapshot may carry at all. A real sequence approaching the
second needs a paginated read, not a larger number.

## Capacity reference

Source, unit, scope, provenance and what refusing looks like. Provenance is
**authoritative** when the PRD or ERC states it, **derived** when a type or
format fixes it, **local** when chosen here. The distinction that matters most
in this table is the last column: several of these are defaults a caller may
override, not bounds that refuse.

| Bound | Value | Unit | Scope | Provenance | Refusal behaviour |
| --- | --- | --- | --- | --- | --- |
| `MAX_ACTIVE_LEGS` | 128 | legs | unresolved at one instant | authoritative | controller refusal |
| `MAX_JOURNAL_LEGS` | 1 048 576 | leg records | one snapshot | local | `CONTROL_LEG_LIMIT`, `LINKED_SEQUENCE_LIMIT` |
| `COLLISION_SCAN_MAX_TOKENS` | 32 | tokens | one interactive scan | local | `COLLISION_TOKEN_BUDGET_REFUSED`, carrying `limit` |
| `COLLISION_SCAN_MAX_ENTRIES` | 2048 | entries | one interactive scan | local | `COLLISION_ENTRY_BUDGET_REFUSED`, carrying `limit` |
| `REGISTER_HISTORY_MAX_LIMIT` | 64, default 16 | entries | one history page | local | `WORKSPACE_PAGE_LIMIT_REFUSED`, stating range and value asked |
| Evidence file | 65 536 | bytes | one uploaded evidence file | local | `EVIDENCE_FILE_TOO_LARGE`, stating the bound |
| `MAX_DOCUMENT_BYTES` | 32 768 | bytes | one task or child document | local | `TASK_SIZE_REFUSED`, stating the bound and the size received |
| `MAX_PAGE` | 100 | records | one Kit API page; also the default | local | `MALFORMED_PAGE` with a message naming the bound that failed |
| `MAX_ATTESTATION_WINDOW` | 86 400 | seconds | one attestation's validity | local | refused, stating at most that many seconds |
| `DEFAULT_BODY_LIMIT` | 65 536 | bytes | Kit API request body | local | a **default**: `createApi(options, bodyLimit)` overrides it |
| `DEFAULT_TIMEOUT_MS` | 10 000 | milliseconds | one Kit or adapter request | local | a **default**, caller-settable |
| `DEFAULT_LOG_WINDOW` | 10 000 | blocks | one RPC log query span | local | a **default**; a non-positive override is refused as `ValueOutOfRangeError` |
| `MAX_STORE_BYTES` | 4 MiB | bytes | one stored record | local | service refusal, in a file held by another writer |
| `MAX_FILLS`, `MAX_ANCHORS` | 10 000 each | records | one listing observation | local | service refusal, in a file held by another writer |
| `MAX_EFFECTIVE_AHEAD` | 30 days | seconds | an admitted effective time | local, profile term | `EffectiveAtTooFar()` |
| `MAX_SETTLEMENT_PERIOD` | 30 days | seconds | a gap deadline | local, profile term | `DeadlineTooFar()` |

Every bound above now states itself when it refuses, except the two service
bounds in files held by another writer: `MAX_STORE_BYTES` and the fills and
anchors caps. Those are recorded rather than changed, and the minimal
integration is to add the number to the existing refusal text, exactly as the
rest of this table now does.

## Derived, not a judgement

`UINT64_MAX`, `UINT256_MAX`, word and hex widths, the 253-byte domain bound and
the JavaScript date range are fixed by a type or a format and are not listed as
decisions.

## Conformance against the PRD at 7b72d5ad

Section 6.3.1 states that an authorization expressed as the entirety of a
specified asset balance is a defined asset-bounded limit, not a missing numeric
budget, and that execution must calculate available funds, reserved amounts and
actual fees without asking for a redundant numeric authorization.

The task policy cannot express that. In `src/agent/taskContract.ts`, `fees` is a
closed field list requiring both `perOperationWei` and `totalWei`, each a
decimal string in [1, 2^256) — `uint(value, true)` refuses `0`, and there is no
sentinel for the whole balance (lines 41-46 and 151-153). A child is then
refused when `gasLimit x maxFeePerGasWei` exceeds `perOperationWei`
(`TASK_CHILD_FEE_LIMIT`, line 246). So the only expressible limits are a number
guessed in advance, which stops work when real fees exceed it, or a number so
large it is effectively unlimited, which the same section separately rules out.
The refusal name attributes this to a fee limit rather than to the absent
asset-bounded form, which is why it reads as a missing budget.

The resolution is not a new schema field. The budget is the wallet's relevant
asset total for the chain, read and filled in, less whatever is still
committed: no number is guessed in advance, and no unlimited sentinel is
introduced. Reservations that are submitted or of unknown outcome stay
committed, because an unknown outcome may already have spent its fee.

What that needs is the chain read for the asset total and the call that fills
the result into the policy at authorization time, both on the execution path
held by another writer, which still checks actual funds before signing because
a read is not a claim on external state. Recorded here for that coordination
rather than changed here. No threshold was relaxed in the meantime.
