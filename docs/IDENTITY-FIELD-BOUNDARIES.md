# Identity-pin field format boundary

PRD section 6.1 requires nonzero immutable registerId and verificationProfile. A TypeScript reader declaration alone does not validate a remote or injected adapter response. Previously only literal ZERO_BYTES32 was refused; malformed or absent values could establish the first pin.

Both fields are now checked for exact 32-byte hexadecimal format and nonzero value before a pin is established or compared. Invalid values raise IdentityChangedError without echoing their raw contents, and cannot replace an existing frozen pin. The profile remains absent only when settlement conformance is not advertised. Source binding, conformance, strict identity comparisons and original valid field values are unchanged; this is not an implementation-code or legal-identity attestation.

Five regression cases are authored in tests/identity-field-boundaries.test.ts, NOT_RUN. Focused validation includes node --test tests/identity-field-boundaries.test.ts plus existing identity/session/RPC/Kit/full pipeline. No syntax/typecheck/test/build/CI/deployment/chain execution or merge occurred in this development increment. Full PRD acceptance remains OPEN.
