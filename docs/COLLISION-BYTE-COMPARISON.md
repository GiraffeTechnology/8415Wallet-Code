# Cross-token collision byte comparison

PRD section 4.9 compares commitments and opaque registry references across the explicitly supplied token set. Hexadecimal letter case does not change the represented bytes32 value.

The scan now checks both comparison fields are exact 32-byte hexadecimal strings and uses lowercase comparison keys. It does not mutate source entries or resolve opaque references. A malformed field fails the whole scan instead of yielding a partial or apparently clear report. No zero/nonzero policy is added by this lexical check; protocol validity beyond these comparison fields is not certified by it.

Token/entry budgets, identity rechecks, repeated-token refusal, per-token occurrence identity and sequential-read scope are unchanged. No global uniqueness, snapshot atomicity, entitlement, legal identity or transaction authority is inferred.

Five regression cases are authored in tests/collision-byte-values.test.ts, NOT_RUN. Focused regression command: node --test tests/collision-byte-values.test.ts plus existing collision-boundaries/browser/full pipeline checks. No syntax/typecheck/tests/build/CI/deployment/chain execution occurred in this development batch. No frozen PR99/PR102 inputs are replaced, and full PRD acceptance remains OPEN.
