# RPC history scan configuration bounds

PRD stages 1 and 3 require usable direct-chain history reads without presenting unavailable history as an empty record.

The reader previously accepted a zero or negative logWindow. Its range loop advances by that value, so zero cannot advance and a negative window moves away from the end. This is a source-level defect; no runtime reproduction is claimed in this development batch.

The constructor now refuses logWindow <= 0 and fromBlock < 0 with the existing ValueOutOfRangeError, before making any provider request. Defaults, positive windows and block zero remain valid. No historical pinning adapter is added: normal instant queries retain the current-chain semantics of the existing transport. The specialized Hoodi reader is unchanged.

Four regression cases are authored in tests/rpcReader-options.test.ts (including the two non-positive window values). Execution, type checking, CI, deployment and real-chain acceptance are NOT_RUN here and remain with the assigned test/review owner. This increment does not complete the PRD or any whole-product acceptance.

Suggested approved Linux owner command: node --test tests/rpcReader-options.test.ts
Run the existing full pipeline separately under its owner; do not infer it from these authored cases.
