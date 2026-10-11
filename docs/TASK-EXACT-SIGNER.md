# External exact sign-only injection candidate

This isolated increment provides an optional server-owned adapter for the
existing task service's `verify`, `send`, and `recover` ports. It is local
implementation evidence, not a production signer, custody choice, deployment,
real transaction, independent audit, or general-release acceptance. The installed
`server/main.mjs` remains unconfigured and blocked. Nothing enables arbitrary
calldata, token approvals, a marketplace, or automatic credential provisioning.

## Explicit configuration and signer contract

`createTaskExactSignerAdapter` in `server/task-exact-signer-adapter.mjs` requires:

- a server-owned read RPC provider, also used for the one raw submission;
- an injected `externalSigner.signExactTransaction` function;
- `signerIdentity: { signerId, signerVersion, implementationDigest }` describing
  the separately reviewed external implementation;
- the very same single-writer encrypted store used by the task service;
- explicit decimal `maxPriorityFeePerGasWei`, and `agentId` / `agentVersion`;
- optionally a server-owned clock, primarily for deterministic testing;
- optionally an explicit `plannerFeeRule` for the version-2 composite executor.
  Omission keeps the planner absent. See [the exact planner contract](TASK-EXACT-PLANNER.md).

Pass the resulting adapter as `taskExecution` and its `identity` as
`taskExecutorIdentity`. Existing explicit receipt verifier and observation policy
configuration remain mandatory. No HTTP field can inject any of these objects.
With an explicit `plannerFeeRule`, factory version 2 supplies its own read-only
exact-operation planner. Task authorization covers an in-scope operation without
another human business-action click. With no rule the planning port remains absent;
this does not configure any production infrastructure or custody implementation.

The external port is exactly:

```text
signExactTransaction({ requestId, unsignedSerialized, unsignedDigest, binding })
  -> signedSerialized
```

`binding` contains the original task digest, child digest, chain, actor, nonce,
executor digest and attempt grant policy version. `requestId` deterministically
binds that tuple and the unsigned digest. The signer must sign only these bytes,
without filling or changing nonce or fees, broadcasting, or persisting raw bytes.
An injected object is trusted code: this interface does not sandbox an external
implementation or cryptographically prove its custody, non-broadcast behavior or
claimed provenance. Those are required independent integration/review decisions.
Neither the browser EIP-1193 `eth_sendTransaction` path nor the old testnet signer
is reused. No endpoint, account secret, key, seed, device PIN or API credential
is supplied, stored or configured by this change.

The executor implementation digest binds the local runtime source inventory,
the installed ethers version, explicit priority-fee policy, signer identity and
the optional planner identity (including its normalized versioned fee rule).
The auth artifact separately validates the exact lockfile-pinned production
dependency graph. This metadata is provenance binding, not remote attestation.
Changing source, signer identity or priority policy changes the approved executor
identity; existing grants require revalidation rather than silently inheriting it.

## Closed operation encoding and exact transaction validation

The receipt adapter and signer share the pure
`server/task-operation-encoding.mjs` encoder. It accepts only the nine existing
operations: native/ERC-20/ERC-721/ERC-1155 transfer, create-account, deposit,
standalone-withdraw, complete and return-hop. Dynamic account addresses must first
come from the existing pinned `ControlledAccountClient`; child wire targets are
never account-discovery evidence. The encoder compares target, calldata hash and
value with the canonical child. Arbitrary caller-supplied calldata is not accepted.

The adapter constructs explicit type-2 EIP-1559 bytes, with an empty access list,
the child's exact nonce, gas limit and max fee, and the explicitly configured
priority fee (which must not exceed the child's max fee). It does not estimate,
fill, reduce or enlarge those fields. Nonces outside ethers' safely representable
integer range fail closed. Current chain, pending nonce, EOA actor, target code,
control/token pins, dynamic account binding and applicable sequence/token/revision
binding are checked. The exact transaction is simulated; an ERC-20 false result
is refused. These are snapshots, not promises that a transaction will succeed.
Control contracts retain their atomic checks and protocol finality is not inferred.

Returned bytes are parsed with `ethers.Transaction.from`. Valid canonical signed
serialization, recovered actor, unsigned serialization and unsigned digest must
all match. Type, chain, target, data, value, nonce, gas, max fee, priority fee and
empty access list are also compared explicitly. A signer cannot substitute its
own nonce or fee policy and obtain a broadcast through this adapter.

## Durable claim and broadcast ordering

1. The existing service runs receipt capability and execution verification, then
   atomically marks the reservation `outcome-unknown` and makes its nonce claim
   permanent, using its existing grant/credential/budget CAS checks.
2. `send` verifies the same operation again and atomically installs one internal
   `exactSignature` claim on the existing operation record. The claim checks the
   current grant policy, credential revision, executor, expiry, operation and
   permanent nonce. A concurrent or restarted send cannot claim/sign again.
   Before invoking the signer, a serialized synchronous read boundary rechecks
   that authority and claim. A revoke queued while claim persistence completes
   therefore wins before signing starts; the signer result is awaited outside
   the store queue.
3. The external signer returns signed bytes. Exact validation computes the
   transaction hash. A second atomic update stores the hash and unsigned digest
   in that operation record before any broadcast. It expands the latest record
   and preserves other fields; no credential or existing store key is replaced.
4. Live checks repeat after signing. The final grant/credential/expiry/nonce/hash
   check and synchronous invocation of the sole `eth_sendRawTransaction` happen
   inside the store's `withReadSnapshot` serialized read boundary. This method
   performs no persistence and does not hold its queue while awaiting the network.
   A revoke queued before that callback blocks broadcast. One ordered after RPC
   invocation cannot undo the already initiated external request.
5. Only an RPC result equal to the computed hash is returned as submission. The
   service independently records its normal `submitted` transition. A lost or
   contradictory response, or failure recording submission, remains unknown.

An ordinary `await readMany()` followed by a send is insufficient for step 4:
a queued revoke can commit before the awaiting continuation resumes. The new
read boundary closes that store-local ordering gap. Its callback must remain
synchronous and must not re-enter the store. Compatible custom stores must
provide the same single-writer serialization semantics; multiple independent
stores, processes, replicas or external signer users are not a coordinated nonce
or revocation boundary. RPC invocation is the local ordering point, not proof of
remote network arrival, mining or transaction completion.

The boundary rejects a Promise returned by its callback, but it cannot roll back
side effects that a misconfigured callback already performed. It is a trusted
server-only interface, not a sandbox for arbitrary asynchronous code. An unhealthy
store refuses the boundary before invoking that callback.

The AES store envelope, key, existing grant/operation/nonce key derivations and
account-factor data stay unchanged. Claim and signed-hash persistence failures
produce zero broadcasts; uncertain persistence poisons the existing store.
Signed raw bytes exist only in the current send call's local memory. They are
not logged, returned to HTTP callers, persisted, or included in public artifacts.
Only synthetic, newly generated fixture accounts are used by local tests.

## Recovery and crash limits

`recover` never calls the signer or a write RPC. It finds the persisted original
hash, independently fetches that transaction by hash on the expected chain,
reconstructs its signature and full type-2 transaction, recovers the actor, and
compares the exact unsigned bytes and resulting signed hash. A hash in the local
journal alone is never submission evidence. A matching RPC observation establishes
submission only; the existing bound receipt verifier must separately observe
effects, canonicality and approved depth. Neither submission nor depth is ERC
temporal or economic finality, and no quota is refunded.

Crashing after a claim but before a hash, or after signing/hash persistence but
before broadcast, remains `outcome-unknown`. Recovery does not sign again,
silently broadcast saved bytes, retry the raw send, release a nonce, or infer
that a missing transaction means it was never sent. This conservative boundary
can leave an unbroadcast operation permanently occupied. A versioned,
independently reviewed signed-ready/first-broadcast continuation protocol is
explicitly out of this increment. Replacements with a different intent and no
matching original observation retain the earlier unknown-outcome limitation.

## Verification limits

Focused tests use synthetic factors, ephemeral local wallets, in-process RPC
fixtures and isolated encrypted stores. They cover field/signature mutations,
wrong actor/chain, service concurrency, claim replay, storage failures, revocation
and factor changes, interrupted sends, read-only recovery, shared encoding and
installed runtime dependency closure. No public chain or genuine signing
infrastructure is contacted. Node 24 is locally available; exact Node 22.18
validation remains unrun locally and must be collected by the separate exact-head
CI/runtime gate. Existing unrelated suites are not rerun or inherited as evidence
for this new increment.
