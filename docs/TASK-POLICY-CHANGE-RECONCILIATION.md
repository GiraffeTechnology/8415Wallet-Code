# Owner policy change readback

This contract implements PRD sections 6.3.1, 6.5 and 10.3 for the human-owned
per-operation verification setting. It is not a task grant or an additional
Agent transaction prerequisite. The effective policy, its two-factor audit,
credential schema and execution gates are unchanged.

The standard `createAuthRuntime` and installed service entry expose this
authenticated policy API without a new JSON feature flag. A fresh scope reads
the authoritative ON default; existing owner-saved policy values and audit remain
authoritative. This availability is independent of disabled listing or exact
execution adapters and does not configure those capabilities.

## Version and routes

The existing authenticated, tenant/account/chain-bound, CSRF-protected POST
routes remain `/auth/account/task-verification/{status,prepare,verify,confirm,cancel}`.
Legacy `status {}` and three-field prepare requests preserve their original
exact response shapes for installed strict decoders. A new client explicitly
requests discovery with `{ "protocol": "8415-task-policy-change-wire/1" }`.
Discovery and qualified status responses advertise that exact `changeProtocol`;
prepare advertises it only when its request also includes the same `protocol`.
A client must explicitly decode this version; an old unqualified cancellation
is refused. No server endpoint, signer or credential may be selected in a body.

`status` accepts legacy `{}`, explicit discovery `{ "protocol": "8415-task-policy-change-wire/1" }`, or exactly:

```json
{
  "protocol": "8415-task-policy-change-wire/1",
  "changeId": "<43-character base64url change identifier>",
  "changeDigest": "<64-character lowercase hex digest>",
  "expectedRevision": "<canonical decimal revision>"
}
```

`cancel` requires that exact qualified body. `prepare`, `verify` and `confirm`
retain their existing inputs and exact-change factors. `prepare` additionally
accepts the optional explicit protocol selector and advertises the version only
for that selector. Confirm retains its existing compatible response; the new
client subsequently queries its exact qualified reference to establish the
authoritative outcome, rather than treating that response as a new grant.

## Status additions

Status keeps its existing effective policy and scope fields, `changeCount` and
`lastChange`. Only explicit versioned discovery or a qualified read adds
`changeProtocol`, `pendingChange` and `reconciliation`. A consumed durable
revision suppresses an obsolete pending summary and yields `revision-superseded`
before any transient pending evidence; a matching durable commit wins first.
The persisted policy schema remains unchanged. A pending draft is never effective.

`pendingChange` is null or exactly the following safe summary of the current
session's draft: `changeId`, `changeDigest`, `expectedRevision`, `mode`, `stage`,
`issuedAt`, `expiresAt`. Stage is `identity`, `verifying`, `email` or `committing`.
No password, signature, email code, nonce, factor binding or bearer proof is
returned by this readback. Another session's pending draft is not enumerated.

`reconciliation` is null on an unqualified read. A qualified read returns exactly
`changeId`, `changeDigest`, `expectedRevision`, `state`, `reason`,
`automaticRetryAllowed` (always false), and `committedChange`.

- `committed`: the complete authoritative policy audit contains this exact
  identifier, digest and previous revision. `committedChange` is that original
  audit entry, even if a later policy change is now effective; `reason` is null.
- `pending` or `committing`: the same-scope, same-credential-revision challenge
  still exists. This proves neither a successful save nor a failed save.
  `committedChange` and `reason` are null.
- `not-committed`: an exact live-process cancellation/replacement was recorded,
  or another audited save consumed the expected revision. Reason is `cancelled`,
  `replaced` or `revision-superseded`. This does not authorize automatic retries.
- `unknown`: neither a matching authoritative commit nor conclusive transient
  evidence is available. Reason is `unresolved`, `committedChange` is null.
  In particular, restart or an absent transient draft is not proof of failure.

The committed audit entry has the existing fixed fields `revision`,
`previousRevision`, `mode`, `changeId`, `changeDigest`, `scopeDigest`,
`credentialRevision`, `verifiedFactors` and `changedAt`. Readers keep the
original policy schema's factor and revision checks.

## Cancellation and concurrency

Cancellation returns exactly `changeProtocol`, `cancelled` and `reconciliation`.
Only a matching, not-yet-committing current-session draft yields `cancelled: true`
and `not-committed/cancelled`. A delayed old-tab request never deletes a newer
draft. A committed or committing save returns `cancelled: false` with its actual
state; absence or mismatch is not a successful cancellation acknowledgement.
The HTTP response is 200 for these truthful outcomes. Malformed/unqualified
references are refused; a new prepare while a save is committing is refused
with HTTP 409 `TASK_VERIFICATION_CHANGE_IN_PROGRESS`.

The final exact-slot comparison and deletion have no asynchronous boundary.
The existing atomic policy revision comparison and durable audit remain the
save authority. Internal authentication-revocation cleanup is not an HTTP
session-wide cancellation path and cannot abandon an already-started commit.

## Reload and lost responses

A human client may retain only the non-secret scoped change reference before
sending confirm. After a lost response, query that same reference. Do not resend
confirm or prepare from a browser flag, an old effective value, `lastChange`
alone, a missing draft, or an UNKNOWN result. A genuine committed readback comes
from the complete durable audit, including after encrypted-store restart.
Transient cancellation/replacement evidence is bounded and not durable; once it
is unavailable, return UNKNOWN unless the durable audit proves an outcome.

Synthetic service, loopback HTTP and encrypted-store regression results are
separate from deployed human UI/factor acceptance and live-chain acceptance.
