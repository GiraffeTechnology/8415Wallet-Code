# Optional freshness response boundary

PRD sections 5 and 6.1 require current feed freshness to remain separate from projection finality and unavailable evidence. The display builder now refuses unsupported status labels, non-bigint or negative block age, and successfully returned malformed policy depth values as TransportError.

A policy request that throws remains an optional unavailable depth, preserving the contract-reported freshness with the existing configured-depth caveat. It is distinct from a successful response with malformed depth. No local age/depth recomputation overrides the reported enum; sequential observations are not made atomic by this validation. Feed pairing, no-watchtower behavior and temporal finality remain unchanged.

Five display-adapter regression cases are authored in tests/freshness-response-boundaries.test.ts, NOT_RUN. Assigned approved Linux owner should run node --test tests/freshness-response-boundaries.test.ts and existing freshness/watchtower/posture/browser/full pipeline checks. Fixtures are not physical devices, actual feed attestations or public-chain evidence. No syntax/typecheck/test/build/CI/deployment/chain execution occurred in this source increment. Full PRD remains OPEN.
