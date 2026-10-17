# Fixed receipt task composition

This additive, installation-only variant uses the existing authenticated Wallet
task preparation, authenticator approval and revocation flow. It never converts
an existing exact-operation or NFT-listing grant into receipt authority.

## Frozen scope

The explicit `artfi-receipt` intent names the fixed handler, account and chain,
escrow/runtime code hash, full sale and correspondence terms, exact segment,
and individual funded/registered/paid slots. Each allowed slot binds its plan
and journal commitment, nonce, calldata hash and exact EIP-1559 fee limits.
Slots are unique and nonce-ordered. Funding and payout each have one permitted
attempt; adding registration does not permit another funding operation.
The fee ceiling covers the sum of the permitted phase obligations. This is not
a larger allowance for old one-operation tasks.

`freezeReceiptTask` rejects extra fields, getters, wildcard targets, duplicate
phases/nonces and unbounded amounts. Local EVM and Hoodi are supported by this
particular ArtFi handler; other chains need their own confirmed contract scope.
The human review retains the full canonical scope, including amounts, parties,
phase limits and recovery policy.

## Composition

Explicitly configure `taskReceiptHandlerId: 'artfi:whole-receipt:v1'` and a
reviewed executor identity in `createAuthService`. No default provider,
credential, route or service activation is added. The service exposes the
non-enumerable server-only `taskReceiptAuthorization` capability.

- `receiptAuthorization.withAuthorization(claimed, wire, action)` revalidates
  the approved grant, registered principal, credential revision and frozen wire.
  Its durable phase and global actor/chain/nonce claims precede the callback.
  The existing store write queue stays held until the callback actually settles.
- `createReceiptProviderHandler` accepts that capability, the exact new grant
  binding and an already approved provider. Its identity and sendTransaction
  methods satisfy the fixed ArtFi executor dependency. Provider methods are
  captured at construction; account, chain, code, nonce and simulation are
  checked again before the one provider send. Personal provider confirmation
  is not bypassed.
- `receiptAuthorization.readState(claimed)` is read-only recovery. It reports
  submitted/unknown state after expiry or revocation but grants no new send.

The grant store and ArtFi native operation journal must be distinct.
A callback must not re-enter the grant store while its read gate is held.
Revoke ordered before the gate blocks dispatch; revoke ordered after an
already invoked action cannot undo it. Unknown/lost results retain the
permanent nonce and phase obligation. Never release them on timeout or resend
to obtain a receipt.

Calldata is independently reconstructed from the exact receipt tuples and
segment commitment. Only fund, confirmRegistration and paySeller exist in this
adapter. Calldata/proof/signature and private signing material are not stored
in the Wallet phase journal.

## Evidence boundary

Phase submission markers are not chain finality or economic settlement.
The ArtFi source-bound journal/reconciliation must establish actual effects
and reorg handling. The generic Wallet resume/exact-operation/listing paths
cannot execute this variant. Refund/rollback transactions are not silently
added to these three selectors.

Synthetic contract tests do not prove a genuine provider, deployed account
binding, personal authorization, live transaction, or joint acceptance.
A real run still needs the matching new human grant, approved existing target
and provider, and the exact ArtFi native-journal composition. Missing these
pauses only the dependent real dispatch, not independent development.
