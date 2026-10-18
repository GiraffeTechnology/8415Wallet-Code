# 8415wallet AGENTS.md

## Current requirements and document precedence — 2026-10-18

The sole current complete product requirements are `docs/ERC-8415-Wallet-PRD.md`:
- Release label: **Beta 2.0**; V2 standalone and V3 linked runtime profiles remain distinct.
- Requirements revision: **2026-10-18 HKT ON/OFF default-value clarification**, matching `config/current-prd.json`.
- Exact UTF-8 bytes: **102490**.
- SHA-256: **b57fcef22ca63eefd2092a645f9e8fbbf4e57513ae109e93cc3a75fe8c3474a3**.
- Includes the full retained foundation, all stages, §9 linked requirements, §10 UI/API requirements, and §§6.5.1 / 10.7.1 historical-observation identity and UI contract.
- ON/OFF controls default to **ON** in the frontend and authoritative backend before the control panel is operational; once operational, the panel changes the settings under their existing authorization rules. Before a corresponding authorization lock is operational, ON means unlocked: authorized tests must not be blocked on its unimplemented permission or approval-signature verification. Record such verification as not evaluated, not passed. This pre-operational rule takes precedence over the operational gate requirement; actual blockchain transaction signatures, task scope and existing effective owner decisions remain binding.
- The preceding 100256-byte PRD (SHA-256 `49607b15c5b146587dac690194d2d9ecb0e396cdb995a7263813d8017594ee96`) is retained in version history and is superseded by the complete current identity above.

The 70,422-byte PRD with SHA-256 `f8e62a6e3fa014b8b5f8b67949309eef3876e7d0a1c4caa1c19ebdc793abd11d` and the 66,713-byte PRD with SHA-256 `7415f8d2d02b4217457e62d369a42815d9b7ea9bfef398066521755b861a49da` are superseded requirement snapshots, not the current complete PRD. An older branch report calling either snapshot latest does not override the canonical document and exact identity above.

Replace the old PRD at that same canonical path with the complete current document. Do not install an amendment-only file, keep an older PRD as a parallel active source, or update a hash while retaining old bytes. Current coverage summaries, release-profile metadata, README links and this execution entry must agree with the exact canonical document. If a provenance manifest is introduced by retained work, its path and hashes must match the final canonical bytes; do not invent a second active PRD. A source or interface partial increment is not a substitute for that document.

On every resume/reconnection and before changing behavior, read this file and the complete canonical PRD. Apply the latest direct authorized instructions to execution ownership and release actions; historical task prose, prior installation permission, earlier green results and old package records grant no current authority. Superseded instructions remain in version history only, not as active execution rules in this file.

Read in order:
1. This current AGENTS.md.
2. The complete `docs/ERC-8415-Wallet-PRD.md`, including its profile-specific acceptance and security requirements.
3. The applicable immutable ERC-8415 specification and interfaces from GiraffeTechnology/ERC-8415.
4. The relevant Ethereum Magicians discussion and separate forum-priority test checklist. Forum suggestions are context, not permission to change protocol semantics or publish private implementation.

For protocol semantics, the ERC is authoritative; application authorization, accepted responsibility flows, user-specific DONE and rollback rules are governed by the current PRD. Do not invent extra completion gates or overwrite the protocol with application terminology. The interface identifiers remain `0x6309e170` for `IRegisterProjection` and `0xf4a7d71b` for `IProjectionSettlement`.

## Execution, evidence and publication rules

- Product tests, builds, typechecks, syntax checks, EVM tests and runtime/UI acceptance run only on an already authorized CTyun or Aliyun non-Windows server. Do not run them on a local workstation, Windows or an unrelated sandbox. A generic Linux or hosted CI runner is not evidence of the approved server environment. Preserve existing CI requirements and record their actual runner separately.
- Reuse accurate immutable-source results; rerun affected checks when the source or relevant environment changes. Do not repeat capability probes or green suites without a change requiring them. A single blocked path does not stop independent authorized work.
- Do not retry denied publication, credentials, deployment or other specifically refused actions without the required targeted authorization. Source editing does not authorize credentials, permission expansion, deployment, real-value transactions or protection bypasses.
- CI and merge actions follow the currently assigned owner. Before merge, re-read the current head/base, required checks and real jobs/steps, review state and repository rules. Use the exact expected head and an allowed merge method. No checks, queued/cancelled runs, historical green results or source-only models are not a pass. Draft or outdated-base status alone does not establish requirements conflict.
- A merge or report is not delivery. Keep author reports, independent source review, actual execution, deployed/served version, real transaction receipts and final acceptance separately labelled and version-bound.
- **Installation/product packages remain withdrawn. Do not restore or publish them now.** Temporarily suppress only the CI installer/product-kit upload step while retaining all tests, builds and validations. Final distributable packages are rebuilt from the final integrated version only after all applicable valid PRs are merged; download publication additionally requires the existing privacy, online UI, V2/V3 chain testing, fixes and retest acceptance. Do not reintroduce old archives or infer a release from an incidental CI artifact.
- Changing future workflow source does not cancel a workflow already running with an old snapshot. Report any resulting artifact accurately. Deletion is limited to the specifically authorized targets and does not delete branches, ordinary source, audit history or unrelated evidence.
- Public GitHub technical prose is English. Public source, documentation, bundles, logs and examples must not disclose real tenant/server names, infrastructure IPs, private operational paths, credentials or private third-party design-reference names. Use synthetic examples and generic mainstream-wallet wording. Preserve necessary third-party license notices. Do not change repository visibility, licensing or access settings through an inferred instruction.
- The full implementation belongs in this code repository. The separate distribution/excerpt repository contains only accepted installation packages and approved source excerpts; it is not the EX engine. Wallet requirements do not import EX-only gas, payment-currency or matching restrictions into ordinary wallet operations.

## Product Boundary

8415wallet is a general-purpose application-layer wallet compatible with
existing wallet and asset standards, with native ERC-8415 asynchronous register
projection support. Native ERC-8415 features are additive and do not make the
product exclusive to ERC-8415 assets. Report implemented and tested standards
separately from the broader compatibility requirement.

It is NOT:

- an ERC-3643 wallet clone;
- a marketplace, order book or matching engine;
- a replacement for ERC-8415 protocol semantics;
- an adjudicator of legal title, entitlement or remedy.

For its native ERC-8415 surface, the wallet MUST consume ERC-8415 semantics,
not redefine them. Existing-standard asset flows retain their own interfaces
and must not be required to advertise ERC-8415 support.

Product identity is **8415wallet**; its UI platform domain is
**8415wallet.com**. Tenant deployments are configurations, not separate products. Do not publish real tenant identities.
V2 and V3 are versioned DApp Beta deliveries mapped to the retained v2.2
foundation and additive v3.0 requirements. SDK packages are separate integration
artifacts and do not replace either DApp. Keep the exact implemented/tested
standard and provider matrix in `docs/STANDARDS-COMPATIBILITY.md`, without
claiming exhaustive validation of all existing standards.

The product supports both standalone and linked use. v3.0 is an additive
iteration on the original wallet: retain its readers, views, transaction path
and legacy single-trade clearing. Linked mode adds the agreed responsibility
chain in PRD §9; it must not make ArtFi, Oracle or another wallet mandatory for
standalone use.

---

## Current Beta 2.0 UI, authentication and agent rules

The full clauses in PRD §§6 and 10 govern; this checklist is an execution entry, not a shortened replacement PRD.

1. Preserve the existing public homepage and actual served multilingual entry. Support homepage Login and direct `8415wallet.com/<wallet-name>` Login. Accept wallet/tenant name, email or wallet address as identifiers without a public tenant list, autocomplete roster or membership disclosure. An identifier/provider connection is not authentication.
2. New wallets have reachable verified-email, password and authenticator initialization, and management/change/recovery entries for supported methods. Unset methods cannot demand their own nonexistent old credential. Keep server-side verification, session revocation, account/origin/chain binding, CSRF, one-use proofs and protected credential storage. Email OTP uses `noreply@8415wallet.com`; email identification or OTP is not an invented standalone login method. Preserve supported wallet-control and hardware-proof flows without claiming untested device support.
3. Only humans use the Web UI. Agents operate exclusively through authenticated APIs and never use human login, browser/provider UI, settings controls or UI automation as their execution path.
4. Distinguish overall Allow Agent, asset-scope authorization, operation permissions and Per-operation human verification. The asset tree is ALL → broad category → subcategory → individual asset. ON grants its descendant asset scope; OFF at a non-leaf expands choices, while leaf OFF grants none. Overall Allow Agent OFF disables operation. Operation permissions have their own inheritance/explicit overrides; do not confuse these semantics.
5. Only the human owner can save agent/settings changes. Every ON/OFF, scope or operation-settings save requires secondary authentication bound to the exact proposed revision. Per-operation verification OFF requires two independent established factors; after that, already authorized in-scope API operations proceed without repeated human prompts. This never grants an agent the right to configure settings, expands scope or removes machine authority checks. See §§6.3.1 and 10.3; do not add a third approval or recurring re-verification gate.
6. Keep grants bound to principal/agent, account, chain, task/child identity, operations, assets, destinations, amounts/fees, expiry and revocation. Persist authoritative revisions, nonce claims, reservations and UNKNOWN outcomes. Read a whole-balance authorization as an exact asset-bounded amount at preparation, not unlimited approval or a reason to demand redundant numeric consent. Reconcile before retry; never duplicate submission or release an unknown reservation.
7. Show ordinary assets and separate NFT browsing with category, list/thumbnail and selected-item ascending/descending sorting. Per currency show total, unreleased escrow and available = total − unreleased escrow; escrow details belong under the corresponding NFT. Do not invent a converted aggregate total or turn unavailable data into zero.
8. Pending shows each NFT separately along the full accepted chain, including later completed positions. Green means changed, gray unchanged, white untraded; orange markers locate NFT/funds approximately by proportion. Expose no preceding/following wallet names or addresses through UI, DOM, API or exports. For user occurrence i, forward display DONE is ownerPosition >= i AND holderPosition == i; freeze it. Rollback DONE is owner == holder at the verified return boundary under the coordinated mechanism. These rules are not ERC temporal finality, and no extra finality/escrow/migration approval gate may be invented.
9. Human transfers/receive/history remain ordinary wallet interactions. RBAC is an institutional-wallet entry only in this increment: unopened scope is a no-op, without a coming-soon badge or simulated authentication. Enabled errors remain truthful. Service enablement is enforced by the backend, not a frontend flag.
10. Preserve the actual served language choices, order, switching and persistence. All added labels/errors/statuses cover those supported locales. About text is separately authored, hardcoded per language; no translation module/service. Do not translate signed terms, raw identities, hashes or protocol values. Preserve existing branding and accessible keyboard/touch/non-color state cues.
11. Beta 2.0 design is distinct from actual UI port, current runtime connection, deployment and test acceptance. Integrate the latest approved runtime instance and bind UI/backend/API/served versions. V2 inability to form a transaction chain is N/A, not failure. V3 chain composition, asynchronous registration and rollback are mandatory. Forum tests are prioritized separately without replacing the complete suite or adding optional watchtower service prerequisites.

## Historical observation: original authority and actual source

PRD §§6.5.1 and 10.7.1 are mandatory for both server and UI integration:
- Keep original grant executor/verifier/policy, scope, expiry/revocation and historical attempt fields unchanged. The actual observing verifier is a separate provenance fact.
- Preserve the strict legacy observation/1 decoder and original authorization-context equality checks. Add an explicit versioned exact-key observation envelope for compatibility; never accept arbitrary extra fields or replace the approved verifier with the new observer.
- Bind observation evidence to the exact durable historical operation/task/child/actor/chain/nonce/transaction/executor/policy tuple and to an independently resolved, authenticated service-owned read-only source capability and revision. Self-declared compatibility or an identity copied from the evidence being checked is not authority.
- Atomically revalidate attempt, source-capability and observation revisions before persistence. Save evidence and its actual source together across status/list/resume/reload. An unavailable refresh retains old evidence with its old source and time, never a new source stamped onto stale evidence.
- Display Approved verifier and Observed by separately. Keep evidence freshness/availability, operation outcome and grant authority distinct. Loading retains old evidence only within the same authenticated account and operation; logout/account/operation changes clear the previous view/cache and discard late responses. First load without accepted evidence displays No verified observation available, with no invented observer, timestamp or result.
- Refresh is an authenticated read only. Compatibility inspection cannot renew a grant, sign, send, retry, release a nonce/reserved budget or alter agreed DONE/rollback semantics. No verifier selector, trust override or recurring human approval is added. The human UI never becomes an agent execution prerequisite.
- Cover strict legacy matching, admitted newer source, tuple/source/schema/revision attacks, stale replay, reorg/replacement/unavailable data, restart, concurrency, logout/context switching and zero write-side effects in actual approved-server tests. Source/design changes are not test results.

---

## Layer Placement

ERC-8415 is a faithful record and audit trail across an asynchronous
boundary: a mirror, not a tribunal. Four layers:

1. identity — the premise that a final on-chain owner and the
   register-confirmed holder refer to the same underlying right. The protocol
   **does not, and cannot, verify this equivalence**. The wallet MUST say so
   wherever it reports that the two agree: agreement between records is not
   verified legal identity, and letting a user infer otherwise is the same
   category error as reading reorg safety as registrar finality, one level up;
2. faithful record — append-only entries and the ERC-721 ownership
   sequence they sit alongside;
3. diagnosis — `holderAsOf`, `isFinalAsOf`, `openGapOf`, and whether the two
   sequences align at an instant;
4. remedy — cancellation, escrow, timeouts, refunds, unwinding.

The wallet **presents** layers two and three to a user, and **supports but
never imposes** layer four. It states what is recorded and what is still
open; the parties' own terms decide what to do about it. Executing explicitly
accepted release, conditional return and refund terms is permitted. A
commercial obligation is application state, not new ERC state.

---

## Core Semantic Rules

For a conforming ERC-8415 asset, the wallet MUST read and render distinctly:

- `holderAsOf(tokenId, instant)` — the confirmed holder at an instant;
- `entryAsOf(tokenId, instant)` — the entry whose effective interval covers it;
- `isFinalAsOf(tokenId, instant)` — whether a later admission can still change
  that answer;
- `currentEntry`, `entryAt`, `entryCount` — the append-only entry walk;
- `openGapOf(tokenId)` and the gap's `openedAt` — whether a change is in
  flight, and from which instant it makes the token contested;
- `ownerOf(tokenId)` — the tradeable position, shown as a separate fact;
- `registerId` and `verificationProfile` — what this is a projection of, and
  under which proof rules;
- `isSettlementAuthority(tokenId, account)` — who may move the answer.

Instants are `uint64` seconds since the Unix epoch, on the same scale as
`block.timestamp`. Formatted time is a display concern only; every query
carries the integer.

### The protocol temporal finality rule

An instant is final if and only if it is at or after the first entry's
`effectiveAt` and strictly before the latest entry's `effectiveAt`.

The wallet MUST take this from `isFinalAsOf` and MUST NOT recompute it,
approximate it, or cache it across a block in which an entry was admitted.

### What "registration pending" means to a user

An open gap means a **previous transfer** has not yet been recorded by the
register. The wallet MUST present this as the normal state it is, never as a
failure, an error, or a blocked action.

Registration is serial and physical: a token can change hands on chain every
few minutes, while the register records each hop one at a time — a→b, then
b→c, then c→d. No standard removes that lag, and the wallet MUST NOT imply one
could. Where the wallet can tell that further hops are outstanding behind the
one being registered, it SHOULD say so, because "how far behind is this" is
the question a holder actually asks.

The correct user action is to wait. If the register exceeds its agreed
commitment window, that is a signal the previous transfer may itself have an
issue, and the remedy lies in the **trade terms between the parties**, never in
the protocol. The wallet reports that the window has passed; it does not
advise on what to do about it.

Acting on terms the parties already agreed is a separate thing and is
permitted: 8415 Clearing releases or returns a trade by reading the register
against a condition written before the trade began. What stays forbidden is
the wallet choosing the remedy, scoring the situation, or recommending a
course of action.

### Three orthogonal signals

Never collapse these into one badge:

- **final / provisional** — can a later admission still change this instant's
  holder;
- **contested / not contested** — is a gap open whose `openedAt` is at or
  before this instant;
- **reorg-safe / fresh / stale** — the optional watchtower freshness layer,
  which measures on-chain reorg exposure of a head, not registrar finality.

Finality does not depend on whether a gap is open. Freshness is not finality.

**Stale is not pending.** A stale attestation and an open gap look alike to a
careless reader, and conflating them makes a silently dead register
indistinguishable from ordinary delay. The wallet MUST keep them apart, and
MUST report a stale feed as stale whatever `isFinalAsOf` says about the instant
in question.

---

## Forbidden Inferences

The wallet MUST NOT treat any of the following as ERC temporal finality:

- `ownerOf` being equal to the confirmed holder;
- confirmation depth, block age, or a `FRESH_FINAL` / `REORG_SAFE` freshness
  classification;
- a proof having verified;
- a gap having closed, by admission or by cancellation;
- a settlement having been cancelled.

The wallet MUST NOT:

- infer the confirmed holder from `ownerOf`, ever, including as a fallback
  when a projection read fails;
- present a provisional answer as settled — the ERC names this the most
  likely integration error, because `entryAsOf` answers either way;
- invent a rejection event. The protocol has open/closed gaps, provisional
  and final instants, and admitted entries. Cancellation ends a contest and
  settles nothing; the projection is unchanged and the prior entry stays in
  force;
- display the register's contents. The chain carries a `recordCommitment` and
  a `registryReference` locator, never the record. Resolving a reference
  requires entitlement to read the register;
- claim projection data for a contract that does not advertise the matching
  ERC-165 identifier;

- present agreement between `ownerOf` and the confirmed holder as verified
  identity of the underlying right;

- cache a point-in-time read across a transaction. `holderAsOf`,
  `isFinalAsOf` and `openGapOf` can move between a read and an action that
  depends on it. Where the wallet builds a transaction from such a read it
  MUST say the read is a snapshot, and its guidance to integrators MUST name
  the on-chain atomic read — calling these inside the same transaction as the
  dependent action — as *the* recommended shape, not one of two options. That
  closes the window rather than narrowing it;

- rely on the protocol to prevent a `recordCommitment` or `registryReference`
  from being reused on a different token. Uniqueness is enforced per token
  only, and one register entry can back the confirmed-holder claim on two
  tokens while every single-token invariant still holds. Detecting and
  surfacing such a collision is explicitly this layer's job, and a
  single-token view MUST NOT be presented as ruling it out;

- assume a watchtower feed identifier is linked to its predecessor across a
  migration. The contract keeps no such link; tracking continuity is this
  layer's job.

---

## Vocabulary Discipline

Use protocol-defined terms for protocol UI, model identifiers and docs:

- open gap / closed gap;
- provisional / final;
- admitted;
- confirmed holder;
- tradeable position (`ownerOf`).

Do not use Pending / Confirmed / Rejected as state names. They are not
protocol states and read as a rejection event the ERC does not define.
Separately named application outcomes such as released/detached or
returned/refunded are permitted for commercial obligations and must never be
presented as ERC gap states.

---

## Application Boundary

Architecture:

```
User
 |
Wallet UI
 |
ERC-8415 SDK port  (Erc8415Reader)
 |                        \
 |                         Native Infrastructure Kit — projection reads
 |
 direct chain reads — conformance, ownerOf, the clock, settlement, logs
 |
ERC-8415 conforming ERC-721 contract
```

The wallet is the product; the Kit is backend infrastructure it may read
through. The wallet depends on the SDK port, never on a transport, and never
on a second source of truth alongside it.

The kit adapter is a projection accelerator composed with a chain reader,
never a replacement for one. `ownerOf`, `supportsInterface` and
`block.timestamp` are chain facts and are never served from an index: an
index answering for both the position and the confirmed holder would assert
the equivalence this standard denies, and an indexer vouching for the
contract it indexes is circular.

Where two backends answer for one deployment, they are cross-checked on
`registerId` and `verificationProfile` — both specified immutable — and a
mismatch is reported, never resolved by preferring one. A backend that cannot
answer raises a transport error; it is never rendered as a fact about the
register.

Do not create protocol changes inside the wallet project.

Do not introduce projection-history rollback, veto or override semantics.
An application conditional return is a new authorized token transfer and may
execute only accepted terms within the active responsibility boundary; it
cannot erase history or cross a completed leg. The wallet has no
write path into the projection: it does not admit entries, and it exposes
`beginSettlement`, `finalizeSettlement` and `cancelSettlement` only as
operations the user's own key performs against the contract, with the
authority check shown beforehand.

---

## Degradation Rules

Conformance is discovered, not assumed:

- projection conformance without settlement conformance means the token has
  no gaps and no contested instants — show that as a property of the
  contract, not as "no gap open";
- `entryAsOf` and `holderAsOf` revert for an instant preceding the first
  entry. That is "the projection does not cover this instant", not an error;
  `isFinalAsOf` returns false there and does not revert;
- when a read fails, show the failure. Never substitute a neighbouring
  instant's answer, a cached answer, or `ownerOf`.

---


## Linked-mode execution requirements (CP-01 resolved, 2026-09-25)

1. v3.0 extends the original PRD; do not remove the standalone wallet or
   relabel legacy single-trade escrow tests as linked-mode acceptance.
2. Responsibility depends on condition/execution controls, NOT escrow. Keep
   token transfers, admitted history and control-owned obligations distinct.
   Payment is an optional separate adapter. An escrow record, amount or released
   payment is never authority for acceptance, completion or return. The token
   rests with the recipient wallet; no payment is required to model responsibility.
3. A downstream recipient accepts executable, scoped conditions for its own
   leg and every still-active upstream obligation. Demonstrate enforcement
   across alternate transfer paths; a message or revocable allowance alone
   is insufficient.
4. For S→B, commercial completion requires BOTH verified owner and admitted
   holder positions at B or later in the same token's accepted chain. Position
   means a proved occurrence/leg index, never numeric address order. Bind the
   observations to chain, asset, leg and accepted terms; refuse missing or
   ambiguous evidence.
5. Once the control confirms AB completion, detach AB permanently. If payment
   exists, settle it separately to A once; payment failure must not revive AB.
   For A→B→C→D with owner=D/holder=B, AB can complete without BC or CD.
   With owner=D/holder=C, AB and BC can complete in prefix order. A later
   callback cannot return the token across AB to A.
6. Completion does not require owner==holder, either still being B, all
   descendants completing, an extra confirming entry or a chosen historical
   `isFinalAsOf=true`. Continue to display raw ERC final/provisional results;
   commercial completion and protocol temporal finality are distinct.
7. Only completed prefixes detach. Preserve history and the unresolved tail,
   including concurrent tail extensions and repeated address occurrences.
   The chain is a rolling window: the bound is on legs UNRESOLVED at once (128),
   and detached history never counts against it, so ABCDEF… keeps extending as
   AB, BC… detach behind it. Any limit MUST be enforced identically off chain and
   on chain — a kernel that permits a leg the controller refuses hands the
   execution adapter a proposal that cannot execute.

   A completed leg is NOT carried on chain. Its state is deleted at detachment;
   the chain keeps only a constant-size commitment over every leg that has left
   and the fact that it terminated, and the record goes to the off-chain register
   via its detachment log, to be asked for and checked against that commitment.
   This is the same division the projection uses — a commitment and a locator on
   chain, the record at the register — so chain state stays proportional to what
   is still open. A read of a detached occurrence MUST say it detached, never
   return a zeroed record. The opening account and the boundary — whoever the
   last detached leg handed the token to — still resolve, because the window
   starts there and a return stops there.

   Digests over inherited conditions MUST cover the active window only, or each
   forward costs gas in proportion to every forward before it, and a detached
   leg MUST NOT be nameable again as a completion target or return boundary.
8. A control-authorized callback affects only active dependencies. For unresolved
   AB, propagate B→C→D and return D→C→B→A. In funded scenarios, refund each
   original payer after its required return using separate payment records.
   If AB detached, BC's return boundary is B. No reactivated obligation is allowed.
   Payment adapters must separately prevent substituted recipients, pooled
   principal and double settlement/refund.
9. Revalidate and serialize at execution; persist confirmed progress and
   resume bounded hops after failure. Protocol delay, RPC failure or a
   cancelled gap cannot invent an unaccepted callback condition.
10. CP-01 is closed as a product decision by the rule above. Do not reopen it
    using the superseded proposed completion profile. Implementation,
    enforcement and W-01–W-24 evidence remain required.
11. Develop responsibility controls as an independent module, not a wrapper
    around escrow. The local kernel is an uncommitted proposal generator, not
    verified consent or account enforcement. Its input facts are a trust boundary.
    Signing/execution must use authenticated atomic adapters and alternate-path
    protection. Functional Beta testing on authorized testnets may collect the
    remaining deployment and device evidence. Independent security review remains
    required before general release. Functional testing, source readiness and
    package publication remain distinct; the current withdrawal, final-version
    rebuild and acceptance order above govern all new downloadable packages.

---

## Completion Requirement

The standalone reading foundation is complete only when a user can see, for any token and any
instant, and without conflating them:

- the tradeable position and the confirmed holder, side by side;
- whether the answer at that instant is final or provisional, and why;
- whether that instant is contested by an open gap;
- which entry admitted the answer, with its commitment, version and
  registry reference;
- what register this projects, under which verification profile, and who may
  move the answer.

Full product delivery requires independent standalone use and, for V3, PRD §9's
linked-mode W-01–W-24 scenarios, including real selected account enforcement,
independent controls without escrow, optional funded flows, detachment,
callback/refund, recovery, independent security audit and deployed UI evidence. Report
baseline, local EVM, public-testnet and UI results separately; a documentation
change or one completed leg is not full acceptance.

## Served origin and stored state

A web origin is scheme, host **and port**, so the address a wallet is served on
is part of its origin. Every IndexedDB operation journal belongs to that origin,
including an operation left in `outcome-unknown` — the record the recovery path
exists to find. Moving a served wallet to a different scheme, host or port
strands them all.

Settle the serving address before a deployment carries genuine wallet use, and
treat a later move as data loss rather than as a configuration change.

Which address a given environment serves on, and which ports are reserved there,
is deployment configuration rather than a product requirement; it belongs in that
environment's deployment document.

