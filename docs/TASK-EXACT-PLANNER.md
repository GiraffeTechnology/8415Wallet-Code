# Read-only exact-operation planner candidate

This optional server-owned planner closes the missing proposal-generation step for
an explicitly configured exact-operation executor. It adds no custody solution,
account selection, real RPC configuration, market sale, transaction permission,
deployment or release acceptance. `server/main.mjs` remains unconfigured.
All collected execution evidence uses synthetic in-process providers and ephemeral
synthetic signing fixtures. Independent security review remains uncompleted.

## Interface and composition

`createTaskExactOperationPlanner({ provider, feeRule, now })` returns frozen
`{ identity, plan }`. `plan({ task, budget, executor, grantPolicyVersion })` accepts
the complete canonical task and budget snapshot and returns a canonical child
proposal, or `null` when any non-cancelled exact operation already occupies the
one-operation quota. Other refusal cases throw fixed error codes. It never reads
or writes a store, requests accounts, signs, broadcasts or selects credentials.
The provider method, normalized fee rule and clock are captured by the factory.

The intended executor integration is the version-2
`createTaskExactSignerAdapter({ ..., plannerFeeRule })` factory. The optional
`plannerFeeRule` defaults to `null`; omission retains the existing no-planner
behavior. It must use the same explicit priority fee as the signer. The factory
constructs the planner itself; callers cannot inject an arbitrary planner and
merely relabel an old signer identity. The new composite implementation digest
binds the signer runtime closure, ethers version, external signer provenance,
priority fee and the planner identity. Planner identity binds its exact executable
source/dependency closure and normalized fee rule. The signer retains and checks
this full composite executor identity in its own plan/verify/send/recover closures.

A source, version or rule change changes the executor identity and suspends old
grants. The existing service does not rewrite/reapprove an already-created task;
a fresh task and explicit authorization are needed. No historical grant transfers
silently. Receipt source identity also changes when its shared encoder changes.
External signer, receipt verifier and observation-policy configuration remain
separate requirements. HTTP JSON cannot configure them or supply a fee rule.

## Explicit fee rule

Every field is required. Numeric values are canonical decimal strings; no wallet
suggestions, floating-point prices, fallback fee policy or hidden defaults exist.

- `schema`: `8415-task-exact-fee-rule/1`
- `ruleId`, `ruleVersion`: explicit nonempty identifiers
- `sampleBlock`: exactly `latest`, `safe` or `finalized`
- `simulationBlock`: exactly `pending`
- `gasPaddingBps`: at least 10000; estimated gas is rounded upward after padding
- `gasLimitCeiling`: positive server gas ceiling
- `baseFeeMultiplierBps`: at least 10000; base fee multiplication rounds upward
- `maxPriorityFeePerGasWei`: explicit nonnegative priority fee
- `maxFeePerGasWeiCeiling`: positive ceiling, at least the priority fee
- `maxChildLifetimeSeconds`: positive lifetime, additionally bounded by the
  contract's hard 900-second child limit and the parent task expiry

No values in synthetic tests are deployment recommendations. The server operator
must independently choose and review a versioned rule for any future deployment.
A zero-base-fee block is permitted only when the explicit priority fee still
produces a positive child max fee. Missing EIP-1559 base fee always refuses.

## Planning sequence and limits

1. Normalize/bind task, complete budget revision, executor and grant version;
   refuse market-sale intent. Any `reserved`, `submitted` or `outcome-unknown`
   entry returns `null` before RPC, even if its fee or observation seems old.
2. Read expected chain and actor pending nonce. Refuse unsafe quantities and
   nonces above the exact signer's safely representable range. Read the selected
   canonical block header, including number/hash, gas limit and EIP-1559 base fee.
3. Pin identity/code reads to that block number. Resolve deposit/withdraw accounts
   with the existing pinned `ControlledAccountClient`, including controller code,
   registration, owner, controller and account runtime checks. Verify controller
   and token code pins, EOA actor/native recipient and control sequence token/code/
   revision as applicable. Use the same closed-list operation encoder as signer
   and receipt paths. No arbitrary calldata or wire-selected account is accepted.
4. Compute max fee as ceil(base fee × multiplier / 10000) + priority. Refuse a
   result above the explicit max-fee ceiling. Gas is bounded by server ceiling,
   sampled block gas limit, parent per-operation fee budget and remaining total
   fee budget. No limit is enlarged or silently reduced into an untested call.
5. Estimate with every transaction field present: actor, target, calldata, value,
   chain, pending nonce, type 2, empty access list, explicit fee fields and bounded
   gas ceiling. Pad upward, require it fits all ceilings, then re-estimate and
   simulate using the final exact gas. Refuse missing/zero/extreme estimates,
   final estimates exceeding selected gas, malformed simulation or ERC-20 false.
6. Recheck pending nonce, sampled block canonicality, chain and current expiry.
   Construct a stable operation ID from task digest, budget revision, composite
   executor, grant version, planner identity and the canonical proposed fields.
   Equal inputs and sampled transaction fields produce equal IDs. A changed
   expiry/nonce/fee creates another proposal, never another authorized attempt.
7. Check the ID against the full history, including cancelled tombstones, and
   return only the frozen proposal. Cancelled definitely-unsent entries free
   quota but retain IDs; cancellation's budget revision makes a new proposal ID.

The service still reserves against the original budget revision, runs receipt
capability and signer verification, and uses its existing durable CAS/nonce/grant
fences. Concurrent plans cannot both reserve. The signer independently rechecks
live chain, pending nonce, account/code/sequence binding and exact simulation, as
well as parent scope and configured planner ceilings before signing. Planning
snapshots are not proof of future success. Contract checks remain atomic.

## Read-only and installation boundaries

The planning port forwards only `eth_chainId`, `eth_getTransactionCount`,
`eth_getBlockByNumber`, `eth_getCode`, `eth_call` and `eth_estimateGas`. All signing,
submission, account-selection and arbitrary RPC methods are refused before the
provider call. The reusable read-port helper exposes this same allowlist without
an escape hatch. Injected provider code itself remains trusted; an in-process
interface is not a sandbox for dishonest code.

Auth packaging includes the exact planner/shared-encoder closure and requires it
at verification. A fresh process imports planner, signer and receipt from the
freshly installed auth stage. Missing modules/dependencies fail closed. SDK
packages stay server-module-free and runtime-dependency-free. Tests and synthetic
fixtures are development evidence and are excluded from public product artifacts.

This increment does not change the unknown-outcome policy: once an attempt is
persisted, it cannot be replaced by another plan, nonce or signature. Recovery is
read-only and never performs a first broadcast. Multi-process coordination,
malicious infrastructure, real signer custody, public-chain/device acceptance,
current-head CI and independent review are not established by these local tests.
