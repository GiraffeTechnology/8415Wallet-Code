# 8415wallet AGENTS.md

## Current execution contract — 2026-10-17

This file is the current execution entry for GiraffeTechnology/8415Wallet-Code.
Read this file, config/current-prd.json, and the COMPLETE pinned
docs/ERC-8415-Wallet-PRD.md before implementing requirements. The pin identifies
the approved requirement source, not a runtime or deployment version. Historical
instructions conflicting with this contract are not current execution inputs;
their original text and dated results remain in Git history.

The authoritative complete PRD is the exact PR135 revision:
commit 7b72d5ad47b12385445ee455627b44620327989c,
Git blob 8fcd09294692d916c1ec4950180a188eb8bda266,
70422 UTF-8 bytes, SHA256
f8e62a6e3fa014b8b5f8b67949309eef3876e7d0a1c4caa1c19ebdc793abd11d.
Use its full standalone and linked-mode requirements, including §§6.2–6.5.
Do not replace it with an excerpt, task reminder, old coverage ledger or old base
tree. Preserve newer runtime implementations when integrating this document.

### Ownership and continuous stages

- Wallet owns all Wallet coding, integration, unit tests and post-submission
  corrections. Wallet2 owns genuine on-chain testing, not parallel product coding.
- Bear owns independent review, CI and merge. Do not self-merge or alter CI
  scheduling, credentials, billing or security controls.
- Control coordinates ownership and consolidated delivery; operations owns the
  existing deployment/READY boundaries. Documentation changes authorize no deployment.
- Finish each independent implementation stage and open its PR, then proceed to
  the next independent stage without waiting for CI. Do not reopen completed
  stages, create duplicate work or manufacture micro-stages to appear active.
- Before writes, bind the exact base commit/blob and inspect actual same-path
  dirty/index/in-flight ownership. Only a real same-path conflict pauses that
  path; do not lock all src/auth/UI or stop unrelated work.
- Application, syntax, compiler, build and test execution uses existing approved
  Linux facilities and runtimes. Windows remains source/report only. Do not
  retry a specifically refused operation or route around it.
- GitHub prose is English. Keep private operational data, addresses/bindings,
  secrets and private delivery evidence out of public repository artifacts.

### Owner verification and authorization

The human owner alone may set Per-operation human verification OFF after TWO
independent already-established factors bound to the exact policy change.
Neither an agent, ordinary session, imported configuration nor an approved flag
can set OFF. Do not add a third unrelated approval or recurring confirmation.

Once owner-verified OFF is effective, valid in-scope preparation, signing through
a compatible authorized signer, submission, continuation and receipt verification
must require ZERO repeated human verification. Persist the policy at the
authoritative execution boundary across restart, refresh, source changes and
component handoff. A browser flag or a signer still needing a human prompt is not
implemented unattended execution.

Reconcile still-valid historical grants without asking for the same authorization
again merely because task/source/component versions change. Preserve actual
expiry, revocation, replacement and scope constraints; never reinterpret a
one-use grant as an allowance or enlarge assets, destinations, chains or fees.
An explicit entirety-of-a-specified-asset-balance authorization is asset-bounded,
not a missing numeric budget. Calculate live funds, reservations and actual fees;
do not demand a redundant numeric authorization or create unlimited token approvals.

ON/revocation applies atomically before the next not-yet-submitted operation.
Submitted and unknown-outcome operations keep their nonce claims and reserved
funds until reconciled; never blindly resend or release an unknown claim.
Ordinary account-method management and recovery remain separate and retain their
applicable independent verification. A newly enrolled device cannot attest to its
own trust; User-Agent/IP is not proof. No key, password, OTP, seed, recovery code
or bearer proof belongs in logs, agent prompts or persisted business records.
Existing approved test-asset exemptions remain separately scoped; this document
does not itself enable OFF, create new transaction authority or replace an
existing deployed configuration.

### Authentication, interfaces and evidence

Retain purpose/origin/tenant/account/chain binding, CSRF, one-use proofs and
encrypted credential state. Login, recovery, owner-policy change and task
authorization are distinct purposes. Email OTP is not email-only login; it may
verify an established email for exact owner policy changes. Do not initialize,
replace or expose existing account keys or stores. Use existing implementation
deployment parameters; do not guess RPCs, signer bindings, contracts or credentials.

8415wallet is a general-purpose wallet; ERC-8415 support is additive. Xiongan is
a V2 tenant, not another product. V2 and V3 DApp Betas remain distinct from SDK
artifacts. Preserve existing wallet and asset standards and supported interfaces, the standalone wallet
and optional linked mode. ArtFi, Oracle, another wallet or payment adapter is not
mandatory for standalone use.

Preserve the existing logo/VI and six interface locales: en, zh-Hans, zh-Hant,
fr, es and ja. Fixed UI text may be localized; signed terms, addresses, raw
transaction values, identifiers and source token metadata may not be translated.
Changing locale must not reload, reauthenticate, reset consent or send transactions.

A web origin is scheme, host **and port**. Preserve journals and unknown outcomes
at their original origins; silently moving to a different origin strands them all.
The product entry is 8415wallet.com; read docs/STANDARDS-COMPATIBILITY.md for the
bounded native ERC-8415 and existing asset interface coverage, not universal validation.
Protect keys, databases, evidence, locks, shared
services and other-task dirty changes. At most two usable rollback versions may
be retained in addition to production and active build/acceptance inputs; cleanup
requires exact reference reconciliation and recovery-verified archival, not blind deletion.

Every stage needs implementation, tests, documentation and source-bound evidence.
Report source, local/synthetic tests, packages, deployed identity, genuine
on-chain/UI observations and independent audit separately. NOT_RUN without an
execution is not a product error or PASS. Historical counts, PRs, scripts,
publication and turn completion are not full-product acceptance. Full PRD delivery
includes standalone and linked W-01–W-24 at their specified execution levels.

Read docs/INSTALLATION-ASSET-PUBLICATION.md and preserve LICENSE and third-party
notices. Do not change public visibility/licensing or publish private inputs.
Do not reinstate cancelled Drive polling, recurring comments/reports or timers
from historical instructions. Only explicit current scheduling authorization
controls scheduling.

For native ERC-8415 implementation, also read the protocol specification and
interfaces in GiraffeTechnology/ERC-8415 and the referenced discussion; where
discussion and the ERC disagree, the ERC wins. Frozen ERC-165 interface IDs are
`0x6309e170` for `IRegisterProjection` and `0xf4a7d71b` for `IProjectionSettlement`.
Never alter protocol semantics inside this wallet.

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
    required before general release; it is not a reason to mislabel or withhold
    a functional-testing Beta package.

---

