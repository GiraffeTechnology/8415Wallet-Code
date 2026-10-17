# Server task runtime composition

Authentication, task approval, execution, and observation are separate boundaries.
Provider availability is not permission to transact. The service continues to
require its original session, factor, exact grant, budget, nonce and attempt
checks before dispatch. Unknown attempts are reconciled, never blindly resent.

## Trusted startup boundary

`createAuthRuntime` constructs the existing exact signer adapter and read-only
receipt adapter when reviewed server code supplies `exactServerConfiguration`.
The same protected store passed to the authentication service is passed to the
exact adapter. The observation adapter receives no signer or writable store.
The optional planner exists only when an explicit valid `plannerFeeRule` exists;
absence is reported as unavailable, not as successful automatic execution.

`startAuthFromEnvironment` accepts this capability object only as a server-code
argument. It does not deserialize provider/signer functions from JSON, import an
arbitrary module path, or load a default signer. Existing CLI and installed
entries do not yet supply a fixed actual capability binding: they remain
disabled for exact execution. This composition increment is not proof of an
installed signer, a deployed Agent route, or a completed transaction.

The server-owned exact configuration contains `provider`, `externalSigner`,
`signerIdentity`, `maxPriorityFeePerGasWei`, `agentId`, `agentVersion`,
`observationPolicy`, and optional `plannerFeeRule`. The original adapter validates
and captures these capabilities. The external signer is sign-only; raw dispatch
and durable attempt handling remain in the reviewed exact adapter. Never put
signer secrets or implementation factories into browser requests or auth JSON.

## Independent approval channels

The authentication service forwards server-only `taskChannelBindings` to the
task service as `channelBindings`. A configured entry has exactly two fields:
`executorIdentity` and `observationPolicy`.

| Task kind | Execution boundary | Observation policy |
| --- | --- | --- |
| `exact-operation` | Existing exact execution adapter | Exact receipt policy |
| `nft-sale` | Existing listing execution adapter | Listing observation policy |
| `artfi-receipt` | Fixed `artfi:whole-receipt:v1` handler | `null`; never the exact observer |

Bindings must match the configured ports. Unknown channels, accessors, duplicate
executor approval identities, missing bindings, and ambiguous global-plus-channel
configuration fail closed. Legacy global configuration supports only one active
execution channel. It cannot enable multiple ports under one borrowed identity.

The channel is selected from a normalized task, or from the stored grant during
later actions. It is not a request-supplied adapter selector. Approval compares
the matching executor and policy digests. Stored grants and attempted operations
retain their actual identities; removing/changing a channel suspends its grants
rather than reinterpreting them using another port. Recovery checks the original
attempt against the current matching channel and never signs again.

This does not create per-channel nonce namespaces or independent task stores.
Actor/chain/nonce exclusion remains shared. Listing and ArtFi journals retain
their original independent-store and held-gate requirements.

## Remaining installation and ArtFi integration

The exact installed signer/provider reference and original ArtFi executor/journal
composition still need an approved fixed binding. The current standard runtime
composes exact and listing capabilities; it does not yet instantiate the original
ArtFi executor or connect its journal/provider handler. The channel model does
not replace that execution wiring. Do not claim ArtFi execution READY merely
because a fixed handler identity can be represented.

Package closure checks must include both new composition modules and the exact
reviewed dependent source. Installed-entry checks, affected Linux regressions,
deployment readback and real UI-to-Agent acceptance are separate required
evidence. Authored or synthetic cases cannot be reported as real chain results.
