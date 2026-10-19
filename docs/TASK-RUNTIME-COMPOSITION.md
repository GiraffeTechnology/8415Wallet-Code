# Server task runtime composition

Authentication, bounded task approval, execution and observation remain separate.
Provider availability is not a grant. UNKNOWN attempts are reconciled, never
blindly signed again or resent. This document describes source contracts, not
deployment or acceptance evidence.

## Standard and installed startup

All existing CLI/runtime-entry/service-entry paths still enter
`startAuthFromEnvironment`. The standard entry now reads an explicit `exact`
section through the fixed `bootstrapTaskExactConfiguration` implementation.
No `exact` section (or its explicit disabled form) means disabled exact execution.
An invalid section refuses startup; it does not fall back to another wallet.

The deployment schema `8415-task-exact-runtime/1` contains:
`enabled`, `chainId`, separate `rpc` and `wallet` endpoints, `signerIdentity`,
`maxPriorityFeePerGasWei`, `agentId`, `agentVersion`, `observationPolicy` and
explicit `plannerFeeRule` (or null). This Wallet bootstrap is Hoodi-only.
Each endpoint has its exact HTTPS URL, timeout and existing protected
`certFile/keyFile/caFile/serverFingerprint256` references. There are no default
URLs, key files, identities or fee values. These fields are a configuration
contract, not a claim that any particular deployment reference has been recovered.
No arbitrary module, factory, browser endpoint or signer secret is accepted.

The fixed transport reuses existing pinned HTTPS/mTLS protections. Code reuse
does not confer the listing peer's identity or signing permissions. RPC methods
are separated from wallet methods. The wallet port only reads chain/accounts and
calls standard `eth_signTransaction`; unsupported sign-only fails without any
`eth_sendTransaction` fallback. All nonce, gas, fee, access-list and wire fields
are explicit, and returned bytes/recovered actor must match. Only the original
exact adapter performs its sole raw submission after durable claim/hash storage.

Trusted code may still use the existing constructor injection for isolated tests;
enabling both JSON deployment configuration and that injection is refused.
The original protected single-writer task store is shared unchanged. The receipt
observer receives no signer or writable store. A planner exists only with an
explicit valid fee rule. No rule means no automatic planner.

## Independent approval channels

Exact-operation, NFT-sale and ArtFi whole-receipt channels have separate executor
and observation bindings selected from the normalized task/stored grant, never
from a request-supplied adapter selector. Global-plus-channel ambiguity,
unbound metadata and repeated approval identities are refused. The old global
mode supports one active execution channel only. No per-channel nonce namespace,
independent nonce store, automatic grant migration or UNKNOWN replay is created.

Changing runtime source, signer/configuration binding, test-asset pins or policy
changes the corresponding identity. Existing grants require revalidation.
Listing and ArtFi keep their independent journals and held-gate requirements;
exact mint support is not the ArtFi whole-receipt withAction/lease integration.

## Server-owned test-asset scope

`taskTestAssets` uses `8415-agent-test-assets/1`, with explicit single `chainId`,
`origin`, `tenant`, `expiresAt`, `wallets` and `assets`. Each wallet must match
this service instance's existing chain/account binding. Native ETH test exemption
is Hoodi560048 only. A separate inventory may select Sepolia11155111 for its own
task-minted valueless NFTs; this does not enable Sepolia native exemption, mix
projects or change EX quote/freeze/fee-settlement rules.

An asset entry binds `taskId/actor/standard/contract/runtimeCodeHash/issuer/sourceHash/mint`.
A planned mint has only `mint.state=planned`; no future token, block or transaction
is required or fabricated. A confirmed external inventory row must carry actual
transaction/block/token IDs and pass a fixed server evidence verifier.
A label, unsigned UI claim or arbitrary commercial/RWA NFT cannot enroll itself.

The service prepares the approval factor (`totp` or `server-test-scope`),
rechecks it at approval, and persists its source. The UI omits the code field only
for the server-confirmed scope. Wallet control/session proof, task identity,
expiry/revocation, exact transaction, fees, balances, nonce and UNKNOWN protections
remain required. No password or authenticator is required by this task-approval
path in the permitted test scope. Other asset/network policies are unchanged.
An exempt grant cannot outlive its test inventory; withdrawal/expiry suspends it.

NFT code pins are captured in executor/observer identities and checked by the
planner, live execution (including post-sign verification) and receipt binding.
These are chain snapshots, not atomic promises about subsequent chain state.

## Fixed Charity ERC1155 test mint

`artfi-test-series-mint` is a closed exact operation: complete parent-matching
taskId, Hoodi chain, actor, collection contract/runtime code hash and the five
original createSeries fields. It is zero-value and cannot carry arbitrary calldata,
batch ABI, token IDs, RWA proofs or another mint method. The server planned inventory
must match the issuer, source/master hash and permitted distribution wallet.

Preflight checks original creator role, pause, fixed100 supply and unique artwork/
master mappings against a canonical snapshot; the actual contract enforces its
own atomic checks. The original task budget, shared actor-chain-nonce claim,
exact signature and sole submission order remain unchanged.

A dedicated read-only observer checks original transaction fields and depth,
SeriesCreated, TransferSingle from zero for100 editions, URI and mappings. Actual
token ID comes from matching receipt evidence, not a predicted counter.
The server service—not the observer—atomically persists the actual mint inventory
with the existing grant/operation/nonce observation transaction. It updates its
private eligibility cache only after persistence; failed/reorg observations revoke
availability while retaining history. Restart reads only inventory-declared keys and
re-verifies their chain evidence with the fixed observer.

## Independent ERC721 leaf

PR213's Hoodi test-only ERC721 leaf has its own fixed four-argument mintTestNFT ABI,
issuer/task immutables and paired event/source/owner/URI verification. Complete
taskId and producer-supplied taskIdBytes32 remain distinct exact fields; no hash
derivation is invented. Artifact/deployment evidence is required before admission.
The successor candidate connects this original leaf as the closed
`artfi-test-nft721-mint` exact operation. It remains distinct from Charity1155,
an ERC721 Vault result, or institutional source authority. Wallet authorization
`taskId` must match its parent; `sourceTaskId/taskIdBytes32` is the producer's
opaque original pair. The artifact digest, deployed runtime code hash and both
task identities are separate pins, never inferred from one another.

For this operation only, a planned ERC721 inventory entry includes exactly
`state/deployment/metadataPublication/metadataTimeoutMs`. Deployment uses the
original `8415-hoodi-test-nft-deployment/1` record. Publication uses
`8415-hoodi-test-metadata-publication/1` and exact
`taskId/chainId/uri/sourceHash/assetKind/metadataHash/byteLength`. Timeouts are
explicit and consistent within the instance. Existing transfer-only planned
entries retain the original state-only form; they cannot authorize minting.

The fixed metadata verifier captures these records at server construction. It
uses only their registered complete HTTPS route, with no redirect, credentials,
image loading or endpoint discovery. Original bytes, SHA256, size, canonical ASCII
JSON and the fixed PR214 TEST_ONLY profile must match. These checks explicitly
keep source authenticity and institutional evidence false. No URI is fabricated.

Planner/live pre-sign/post-sign and observer assessment require metadata and
original immutable deployment preflight. Receipt observation binds the original
transaction, fees, canonical depth, paired mint/Transfer events and source/owner/URI
mappings. The concrete ERC721 result joins the existing grant/operation/nonce CAS
inventory transaction. Failed/unknown/reorg evidence never frees a nonce or
replays a signed intent. Restart rechecks declared sources against the current
server deployment and metadata registrations before reusing inventory.

The standard entry derives capabilities only from its server-owned inventory;
HTTP input cannot register deployments, publications or verifier callbacks.
The supplied compiler artifact and metadata bytes remain separate inputs: a
runtime template is not deployed code hash, and ABI comparison is not execution.

## Evidence and remaining integration

All newly authored source regressions remain NOT_RUN until exact-source approved
Linux evidence is collected. Package/source pins and installed checks bind the
candidate, but neither source nor package presence proves actual wallet-method
support, deployment, signing, minting, Oracle integration or116-case acceptance.
Actual existing endpoint/certificate references and signer support still require
deployment reconciliation. No public read-only RPC candidate is a wallet signer.
The independent whole-receipt ArtFi runtime/journal integration remains separate.


## Exact-chain and maximum-cost execution gate

For Hoodi exact tasks, planner, live signer validation and receipt observation require
chain560048 and the fixed genesis block hash, not chainId alone. Other originally
supported chains retain their original chain binding. No alternate RPC is discovered.

The planner checks the actor's balance at its canonical sampled block and again at
pending state against value plus gasLimit times maxFeePerGas. The live signer path
checks the same complete maximum-cost envelope during its original pre-sign and
post-sign validation. A shortage before signing refuses the unsent operation; a
shortage after signing preserves the original signed UNKNOWN reconciliation boundary
and never authorizes automatic broadcast/retry. No funding, fee reduction, quantity
change or new budget is introduced. External chain state can still change after a
read; these checks do not promise atomic balance or economic finality.

All new chain/funding regressions are authored, NOT_RUN until approved Linux execution.


## Candidate verification boundary

The ERC721 successor is authored source, NOT_RUN. Ordinary QA and post-submit fixes
remain Bear-owned. Seven test-only changes between a8fa61f9 and d55c5237 are retained
from the selected parent, not edited by this overlay. No parent CI result is
inherited. No build, deployment, credential configuration, signature or chain
broadcast is performed by this source composition.

