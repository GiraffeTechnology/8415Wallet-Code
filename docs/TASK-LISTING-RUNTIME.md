# Server-only seller-listing runtime

This local candidate supplies the production code path through `server/main.mjs`,
`auth-service.mjs`, the existing background runner, the fixed ArtFi native port,
the authenticated internal task journal, and the durable listing-results consumer.
It is disabled unless an operator supplies the complete reviewed configuration.
No signer/custody provider, peer credential, API key, chain endpoint or deployment
is selected, created or activated by this change. Local synthetic tests are not
real-chain, deployed-browser or genuine-device acceptance.

## Fixed installed package and entry

`task-listing-installed.mjs` imports only `@artfi/task-listing-runtime/server`.
The name, version, interface, artifact integrity, manifest hash and exact bundled
package identities are pinned in `task-listing-package-pin.mjs`. The reviewed
artifact is the sole local file dependency,
`vendor/artfi-task-listing-runtime-1.0.0.tgz`; npm installs with lifecycle scripts
and bin links disabled. Its normalized dependencies contain no installation or
prepare scripts. All original licenses and source/normalization provenance are
retained. No sibling checkout, arbitrary module path, browser factory, global
registry or dynamically supplied dependency is used.

The ArtFi package requires Node 22.18.0 or later and the genuine `react-server` condition.
When listing is enabled, the fixed auth entry wrappers add that condition by
restarting the same executable before reading credentials or opening stores.
The default disabled auth route does not load ArtFi and retains its existing
Node requirement. `createAuthRuntime` is the inert reusable server entry; `start`
opens the configured listeners and then starts the existing background runner.
All production wrappers call `startAuthFromEnvironment` explicitly.

The installed import probe imports the actual Wallet modules, then the pinned
ArtFi module and all of its transitive imports under the required condition.
Package verification also checks the entire installed ArtFi inventory against
its pinned manifest. A valid JSON manifest without loadable modules is insufficient.

## Operator JSON boundary

The existing protected auth JSON gains one optional `listing` property. Omit it,
or set exactly `{"schema":"8415-task-listing-runtime/1","enabled":false}`,
to keep listing disabled. Existing login, exact-operation and manual/session
paths do not receive substitute credentials or broadened permissions.

An enabled object has exactly these properties:

- `schema`: `8415-task-listing-runtime/1`; `enabled`: `true`.
- `executor`: `agentId`, `agentVersion`, both explicit public identifiers.
- `observationPolicy`: `minimumConfirmations`, a decimal string from 1 to 1024.
- `artfi`: the strict `artfi-server-listing-config/1` object documented by the
  installed package: one chain, explicit collection scopes, RPC source/timeouts,
  reviewed Seaport deployment/code hashes, fixed SDK timeout, and bounded scans.
  ABI, types, code factories, import paths and unknown fields are not accepted.
- `stores`: `bridge` and `observation`, each containing an absolute `path` and
  private `keyFile`. Both state paths must differ from the credential store and
  each other. Keys are provisioned externally, never generated here. Key files
  contain exactly a 32-byte hex key. Private regular files, safe parent paths,
  owner/mode checks and non-symlink opens are required. The key buffer remains
  alive until its store closes, then is erased.
- `peer`: `id` is the Wallet outbound mTLS SPIFFE URI; `journalUrl` is the fixed
  HTTPS endpoint ending in `/internal/v1/nft/operations`; `tls` supplies private
  `certFile`, `keyFile`, `caFile` and the exact lowercase 64-hex
  `serverFingerprint256`. No cookies, browser session, bridge bearer or trusted
  forwarding header can authenticate the peer.
- `peer.capabilityListener`: explicit loopback `host`, `port`, server `certFile`,
  `keyFile`, `caFile`, the Go caller's distinct SPIFFE `peerId` and
  `clientFingerprint256`. The Go caller's identity is different from the Wallet
  identity in the claim. Certificates must be authenticated by both their CA
  and exact reviewed pin; the incoming URI SAN must match.
- `gateways.quote`, `gateways.request`, `gateways.signer`: fixed credential-free
  HTTPS `url`, bounded `timeoutMs` (1–60000), and the same outbound `tls` shape.
  The signer additionally requires `protocol: "8415-sign-only-http/1"`, an
  explicit `capabilityId` and `version`. This is a protocol boundary for the
  separately approved managed signer, not a custody selection or embedded key.

All keys above are configuration data. Unknown keys, executable values, accessors,
prototype-bearing objects and noncanonical arrays fail validation. URL credentials,
queries, redirects, insecure TLS and arbitrary listen hosts are refused. Missing
operational inputs leave listing disabled with a bounded code; existing auth can
remain available. The public auth capabilities response reports disabled/configured
separately from whether a particular task is executable. A configured backend
still revalidates every grant, quote, plan and side effect. Connectivity alone is
not authorization.

ArtFi's separately provisioned `OPENSEA_API_KEY` must already be available to its
controlled process. Missing provider/venue setup fails closed. This change does
not add its value to JSON, command arguments, logs, manifests or stored operations.
Private files and network permissions are deployment inputs requiring the owner's
separate authorization; this candidate does not modify any running service.

## Gateway wire protocols

Every call uses the configured mTLS connection, POST, a bounded JSON body, an
actual settling timeout and an exact fixed destination. Gateway calls require HTTP 200. The journal transport preserves bounded HTTP
error responses, notably the authenticated 404 used to create a new operation.
Redirects, bodyless success responses, malformed JSON, aborts and lost replies
fail closed. No automatic
write retry is performed.

- Quote request: `{schema:"8415-listing-quote-request/1", valuationPolicy}`.
  Return the existing exact quote-evidence object. It is validated against the
  grant's approved price-at policy and persisted once with the listing child.
- Native request: `{schema:"8415-listing-native-request/1", task}`.
  Return the existing `NftRequest` object. The real native port and sale-terms
  verifier enforce seller, chain, NFT, quantity, expiry, fees and price.
- Sign request: `{schema:"8415-sign-only-http/1", capabilityId,
  capabilityVersion, request}`. `request` contains the exact task binding,
  child digest, typed-data digest, typed data and dispatch deadline. Return
  exactly `{schema:"8415-sign-only-result/1", typedDataDigest, signature}`.
  The typed-data digest must match; the real native engine verifies the returned
  signature before publication. Signature material is never persisted or logged.

The executor implementation digest binds the installed module manifest, signer
capability/version metadata, peer identities, reviewed gateway destinations/pins,
native configuration and observation policy. Changing those inputs requires a
new explicit task authorization; old grants are not silently upgraded.

## Internal journal authority and deadlock avoidance

The Go internal endpoint accepts no body principal as authority. Its real mTLS
peer verification is separate from the ephemeral Wallet capability. The adapter
uses the production `nftTaskJournalDigest` for Go-compatible canonical request and
plan hashes, including its Unicode/HTML escaping rules. It does not use the
legacy native review digest for this wire contract.

For each get/create/update, Wallet enters the existing durable grant read gate,
or reuses the currently held review/publish gate. A one-use random capability
binds the verified principal, Wallet peer, action, deterministic native operation
ID, immutable plan and exact request. When a child exists, native plan ID and
review digest must also match that approved child. Capability lifetime is at most
10 seconds, and it ceases to exist as soon as the actual request settles or the
gate exits. The stop state is permanent. Lost replies do not permit capability
reuse or a second signature.

Go consumes the capability at the distinct mTLS-only endpoint
`/internal/v1/task-journal-capabilities/consume`, with exactly
`{capability,peerId,action,nativeOperationId,planDigest,requestDigest}`. The response
is the corresponding verified claim plus principal, wallet, chain ID and issue/
expiry times. This endpoint reads only the ephemeral registry and rechecks the
already held snapshot. It never reacquires the credential/grant store, avoiding
Go callback deadlock while the originating request is waiting under that lock.
Mismatched authenticated requests burn the one-use token. Ordinary auth/browser
routes expose no mint or consume capability.

Bridge, observation, credential and Go journal stores stay separate. Read-only
observation remains available for a revoked/expired original attempt, but it
cannot plan, sign, publish, relist or release the permanently reserved quantity.
The existing runner continues bounded scans; the complete results UI presents
fresh/stale fills and token proceeds without claiming protocol finality or future
USD settlement. See `TASK-LISTING-RESULTS.md`.

## Local evidence and remaining inputs

New synthetic coverage exercises the actual auth HTTP/TOTP/logout path, installed
ArtFi port and journal adapter, one-use held capabilities, official SDK dispatch,
durable observation, reorg downgrades, and lost-signature recovery after encrypted
store reopen and runtime recreation. It also covers true local mTLS handshakes,
wrong pins, malformed/no-body responses, permanent shutdown, default disabled auth,
strict config, construction cleanup, original-key restart and zero-key rejection.
All test certificates/keys and network boundaries are temporary synthetic fixtures.

Production acceptance still requires approved peer certificates and destination
permissions, externally provisioned store keys, the reviewed managed signer and
its protocol endpoint, quote/request services, RPC/OpenSea access, deployment pins,
and genuine deployed UI/device/chain evidence. No deployment, transaction, public
market listing, credentials, PR, push or release publication occurred here.
