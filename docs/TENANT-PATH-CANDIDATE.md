# Path-tenant routing candidate — not deployed

This review-only renderer does not modify an installed instance. It is not
production acceptance, a restored authentication service, or a new release.

## Contract

An explicitly configured isolated tenant `example-one` uses canonical entry
`https://8415wallet.com/example-one`. Relative source modules remain under
`/example-one/web/` and browser compilation under `/example-one/dist/browser/`.
The existing TLS origin/listener is preserved. No listener, DNS, certificate,
credentials, service startup, store initialization, or upstream migration occurs.
The trusted registry must contain an `origin` exactly matching the explicit HTTPS
origin supplied to the renderer, including any configured non-default port. There
is no default port selection or fallback. The canonical example above is not a
deployment instruction; a path requirement is not permission to change origin.

The service-owned `basePath` is exactly `/` plus its configured tenant. The raw
HTTP request must be `/<tenant>/auth/<operation>`; no percent-decoding, dot-segment
normalization, alternate case, query, fragment, repeated slash, or forwarded-prefix
selection occurs. `Host`, origin policy, `X-Wallet-Tenant`, CSRF and fixed service
session checks remain enforced. Endpoint names are validated before URL construction.
Node agent login uses this same contract without browser or settings automation.

Path-mode cookies have tenant-specific names, retain `__Host-`, Secure, HttpOnly,
SameSite=Strict and `Path=/`, and omit Domain. Duplicate target cookies are refused.
The broad Path is required for `__Host-`; it is not a tenant isolation claim.
Server sessions/preauth/challenges stay in the fixed service's own maps; credentials
retain `tenant:username` keys, and tasks/proofs retain their original tenant scope.
No automatic remapping or new authoritative store is introduced. Existing root
`/auth/` configurations and their cookie names remain unchanged when basePath is empty.

## Two meanings of `/name`

The pre-existing default service resolves a *verified account's* walletName to
`/name`; that account still has tenant `default`. A separately configured tenant
also requesting `/name` is a collision, not permission to move the default account.
`renderTenantPathCandidate` requires a private registry identifying isolated-tenant
owners, the original default account names and an authoritative snapshot digest.
Duplicates, reserved names, default-account collisions and missing data fail closed.
The registry inputs must be independently obtained from the authorized owner;
syntactically valid names/hashes in a unit test are not actual registry verification.
No generic tenant lookup, public directory, wildcard provisioning or arbitrary
per-name endpoint selection is added. The renderer is pure review output only.

## Same-origin limitation and storage

Path boundaries are **not browser security origins**. All tenant pages must run
only the unified reviewed static code. No tenant-authored HTML, JS, service worker,
untrusted executable media or runtime configuration replacement is permitted.
The web server must expose only the approved static artifact, never the source tree,
credential files or arbitrary symlinks. A malicious script on this origin could
make same-origin requests to another path; cookie names alone do not prevent that.

Policy pending references already use digests over tenant/origin/user/account/chain/
agent scopes; avatar records include origin/profile/tenant. Those existing scopes
are retained. Locale is an intentionally shared non-authority preference. Browser
operation journals previously rely on origin plus chain/controller/actor, not tenant.
For all modules served under a tenant prefix (independently of the current page
URL) these journals now refuse with
`CONTROL_TENANT_JOURNAL_MIGRATION_REQUIRED` **before opening any database**.
This does not delete, import, relabel, or replace any old UNKNOWN record with an
empty journal. Transaction functionality on the new path is **not complete**.
Direct static HTML entry paths are also refused by the review-only nginx output.
Original-account journal attribution, explicit migration/reconciliation and tests
are required before that hold can be removed. Existing default account `/name`
using the original `/v3/web/` bundle keeps its existing journal behavior.

## Remaining acceptance

- Independently verify the private route ownership registry and account snapshot,
  existing service/socket, tenant/origin, original encrypted state and exact config.
- Preserve and reconcile original operation journals before any migration/dispatch.
- Source and precise packaging dependency changes have passed independent review
  for local candidate building only. The exact source allowlist is regenerated.
  This local-build approval does not authorize publication or deployment. Actual
  newly built UI/auth/outer archive closure verification remains required.
- Test nginx syntax/static closure and real reload/login/browser paths on the
  existing authorized environment. This work has not run nginx, deployed code,
  restored services, performed chain transactions, or claimed browser acceptance.
- Verify current served source/package identity and N06/X02/X03/X04 separately.
