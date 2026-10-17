# Temporal-query input domains

PRD sections 3/4.3 use uint256 token IDs and uint64 integer Unix-second instants. The temporal-view boundary now validates bigint type and those unsigned domains before any conformance, identity or backend read.

Negative or overflowing values are rejected as ValueOutOfRangeError; numbers, strings and absent values are not silently coerced. Such inputs cannot be interpreted by a permissive memory or remote adapter as a valid uncovered instant. Zero and maximum representable values remain in domain; this does not assert that a chosen token exists or that the projection covers an instant. Future instants are not arbitrarily restricted to the current clock.

Seven regression cases are authored in tests/temporal-input-domains.test.ts, NOT_RUN. The boundary-positive fixture stops at a marked adapter call, not an asset or chain success. Assigned approved Linux owner should run node --test tests/temporal-input-domains.test.ts plus existing temporal/forbidden-inference/RPC/Kit/browser/full pipeline tests. No syntax/typecheck/test/build/CI/deployment/chain execution occurred in this source increment. Already submitted initial paths and frozen specialist inputs are not changed. Full PRD acceptance remains OPEN.
