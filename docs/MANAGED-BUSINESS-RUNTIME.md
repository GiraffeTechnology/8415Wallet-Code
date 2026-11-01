# Managed business API composition

The managed service entry retains authentication-only behavior with its existing
arguments. An explicit service-owned `--runtime business` selects the standard
`createAuthRuntime` composition instead of the authentication-only route filter.
An HTTP parameter, login session or imported grant cannot select this mode.

This closes an assembly gap: authentication-only mode intentionally rejects task
preparation before authentication or grant validation. Business mode reuses the
standard task, policy, reservation and observation services and their existing
checks. Preparing a pending authorization is distinct from approving that
authorization and executing a child operation. Missing signer or chain adapters
do not become a universal prerequisite for constructing the authentication API.

Activation requires the exact original state reference and writable transactional
store methods. An initialized instance retains the existing canonical-origin
admission. A genuinely uninitialized original instance can instead use the
managed first-write lifecycle bound to its retained witness, source receipt,
configuration digest, tenant and canonical transport. It constructs no persistent
empty seed. Normal authentication and pending-task preparation still enforce
their existing identity and scope checks; the first genuine transaction writes
the encrypted state with the original key. The original systemd credential route is retained;
no new key argument, key export or ambient credential fallback is introduced.

Business startup identifies the installed source and configured exact/listing
states. It does not certify a logged-in principal, an approved grant, available
custody, successful dispatch, receipt finality or full product acceptance.
Existing saved owner policies, revocations, scopes, reservations and UNKNOWN
reconciliation semantics remain enforced by the standard services.

Requirements: complete PRD sections 6.2, 6.5, 6.5.1 and 10.3. The regression suite
uses an explicitly synthetic temporary encrypted store; its successful API
checks are not acceptance of an operational user's store or execution authority.

The first-write journal is derived beside the protected source receipt, outside
an immutable packaged runtime. It retains that receipt and witness unchanged.
Opening under the original writer lock saves admission provenance only, without
creating a credential file. This supports a clean restart before any genuine
transaction, without falsely reusing the old directory timestamp as a fresh
observation. An unjournaled encrypted candidate is preserved and refused.
Every phase retains the original directory inode, root ownership and private
mode. Recovery measures this identity again under the original writer lock;
normal timestamp changes do not admit a substituted directory.
After the encrypted candidate file and its containing state directory are
synced, its exact ciphertext digest, size and temporary name are saved as
prepared in the separate receipt directory. State replacement and state-directory
sync precede committed metadata. Once first-write durability is attempted, a failed or
uncertain acknowledgement preserves the encrypted candidate. Restart recovery
holds the original writer lock, resumes only that candidate, decrypts/decodes it,
and syncs the state directory even when the destination already exists, then
commits its establishment record. An uncertain sync acknowledgement leaves the
record prepared and cannot release or replay the transaction. A committed record never permits a
missing store to be replaced with an empty one. Subsequent ordinary encrypted
writes retain normal storage and UNKNOWN semantics.

The narrow original-first-write path can use the canonical transport origin
without editing the original configuration: its witness establishes that no
prior durable authority existed, and its journal binds both configured and
effective origins. Existing initialized origin-scoped grants still require the
separate durable continuation mechanism; they cannot select this path. A plain
JSON object is not a first-write admission capability.

## Whole-receipt host composition

The process composition may supply `wholeReceipt` with exactly
`createInstallation`, `journalStore`, `consumerPeerId`, `taskExecutorIdentity`,
`provider`, and `journal`. The existing ArtFi bootstrap owns these original
capabilities and its existing module loading route. Configuration JSON and HTTP
requests cannot supply them. The host supplies its original credential `store`,
`createTaskReceiptRuntime`, and `createReceiptProviderHandler` to that factory.
The journal store must be independent. Its auth options enter the existing
artfi channel composer, and the original handler's four-method
`taskReceiptAuthorization` is connected once without an authority proxy.

The returned service-private `wholeReceipt` exposes operation composition and
authenticated-peer capability consumption to the existing bootstrap. It adds
no HTTP route, listener, loader, identity or credentials. A deployment still
needs its genuine provider, native journal, mTLS transport and peer bindings;
source composition and contract fixtures do not establish those bindings.

Shutdown initiates HTTP listener closure and fences new receipt operations,
then waits for accepted create/read/execute promises, including their result
recording. Capability consumption remains forwarded during that drain.
Installation `stop()` is synchronous and is called only after accepted operations
settle; it is not itself evidence of a drain. UNKNOWN rejections remain the
original errors and never trigger cancellation, resend or reservation release.
The outer process closes its original store and transport only after runtime
shutdown succeeds. The host does not close the externally owned journal store,
provider or transport. Failed connection cleanup stays with the original factory,
including its protection of an unexpected runtime owned by another installation.
