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

Activation requires the already initialized original encrypted store, its exact
configured state reference, writable transactional store methods, and a
configuration origin identical to the canonical HTTPS transport origin. The
entry refuses uninitialized-store witnesses and origin migration requirements;
it does not create an empty replacement store or translate existing grants.
First persistence and durable origin continuation remain separate operator work
under their actual authority. The original systemd credential route is retained;
no new key argument, key export or ambient credential fallback is introduced.

Business startup identifies the installed source and configured exact/listing
states. It does not certify a logged-in principal, an approved grant, available
custody, successful dispatch, receipt finality or full product acceptance.
Existing saved owner policies, revocations, scopes, reservations and UNKNOWN
reconciliation semantics remain enforced by the standard services.

Requirements: complete PRD sections 6.2, 6.5, 6.5.1 and 10.3. The regression suite
uses an explicitly synthetic temporary encrypted store; its successful API
checks are not acceptance of an operational user's store or execution authority.
