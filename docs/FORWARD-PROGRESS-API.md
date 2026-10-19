# Authenticated forward-progress read model

This source increment wires a privacy-safe V3 linked-progress projection into the existing authentication service. It is not a linked execution API, a financial settlement decision, or evidence of a deployed reader. V2 standalone linked-chain cases remain not applicable; configuring this V3 service is not a V2 acceptance prerequisite.

## Route and authentication

`POST /auth/assets/forward-progress` uses the existing exact tenant/origin, verified session, CSRF and credential-revision checks. It accepts only:

```json
{
  "asset": { "chainId": "560048", "contract": "0x1111111111111111111111111111111111111111", "tokenId": "7" },
  "sequenceId": "0x2222222222222222222222222222222222222222222222222222222222222222"
}
```

These are synthetic identifiers, not approved execution parameters. The account and own occurrence never come from the request. Extra fields such as `verified`, `complete`, another account or `ownOccurrenceId` are refused. The chain must match the authenticated session. Login does not entitle a principal to arbitrary assets: the server-owned trusted reader must authorize the requested asset/sequence and the principal's own occurrence before returning evidence.

## Trusted reader integration

`createAuthRuntime` and `createAuthService` accept an optional **server-owned** `forwardProgressReader`. Default is null; no endpoint, credential, account or reader is invented. When absent, this route returns a non-success `FORWARD_PROGRESS_NOT_ENABLED`, never an empty balance or simulated completion. The human UI must not send a request when the authoritative rollout leaves this feature unopened. No service is enabled by adding this source.

The injected port has two methods:

- `readForPrincipal({principal,asset,sequenceId})`: independently authorizes the principal's own occurrence, reads verified asset/sequence/revision/block-bound chain and admitted-register evidence, and returns `{snapshot,evidence,ownOccurrenceId,historical}`. Historical input is bounded to 128 source-verified snapshots and must be canonical for the same asset, sequence and occurrence. Current and historical owner/holder positions are never ranked by numeric addresses.
- `validateMilestone({principal,asset,sequenceId,ownOccurrenceId,milestone})`: independently revalidates the canonical provenance of a candidate or persisted DONE milestone. It returns true only on actual successful verification. It must not trust caller flags or infer admitted holder from ownership. A false/unavailable result returns an error and retains the durable record for reconciliation.

There is no default implementation of these entitlement/canonical-history checks in this increment. An actual source adapter must meet the port before enabling it. Injected synthetic readers in tests are not production proof. The source remains unsupported for a user's detached occurrence when the available verified snapshot/history cannot represent it; do not invent a zero position or claim that historical retrieval is complete.

## Durable display milestone

The display predicate is `ownerPosition >= userPosition && holderPosition == userPosition`, distinct from CP-01's commercially completed prefix and ERC temporal finality. If a refresh missed that instant, a verified historical snapshot can establish it. The earliest supplied valid historical milestone is selected; its scale, NFT marker, holder marker and source provenance freeze together.

The existing encrypted store atomically checks the current credential revision and the original progress record before committing a new record. The record key binds tenant, origin, registered username, account, chain, asset, sequence and server-resolved occurrence by digest. Parallel readers use an exact-record CAS. A conflict returns `FORWARD_PROGRESS_REVISION_CHANGED`; the client may repeat this read after obtaining the current state. This is never permission to replay a transaction.

After DONE, later positions do not move the persisted marker or reopen an obligation. Recreated service instances reuse the original store record. Every subsequent response requires current session validity and canonical milestone revalidation. A revoked session, stale source, malformed evidence or unverified/reorged milestone cannot produce optimistic success. Real encrypted-store restart and chain reorg acceptance remain separately required.

## Privacy and limits

The response is a fixed whitelist containing asset identity, sequence, lossless integer positions and ratios, source revision/block, independent owner/holder tracks and record revision. Neither raw source snapshots, occurrence IDs, adjacent wallet names/addresses, account identity nor credentials are returned. The same whitelist is reapplied to stored records after reload.

The scale includes the full verified chain plus its untraded tail, not merely the current user's prefix. `canExecute` stays false. Funds and rollback remain `not-evaluated`: this display service cannot establish release/refund/return completion. Missing or ambiguous evidence is unavailable, not zero. This route cannot sign, broadcast, grant permissions, change owner settings, detach responsibility or release principal.

## Validation status

Nine service/package regression definitions cover frozen continuation, missed-refresh history, canonical revalidation refusal, disabled/caller-forgery paths, wrong source/unavailable evidence, session revocation, concurrent CAS, privacy and installed-source import closure. Four separate real loopback HTTP authentication/grant regression definitions exercise API-only login and task authorization; they also assert that an unconfigured progress service is not enabled by login. All new definitions are **NOT_RUN** until executed on the approved Linux runtime against the exact successor source. Static source review, metadata hashes and a private virtual tree are not runtime or full-product acceptance.
