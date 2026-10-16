# HTTP JSON-RPC response envelope

Initial source increment following PR122; not a deployment or acceptance result.

The HTTP single-request transport now requires a JSON-RPC 2.0 object response
whose numeric id equals the id actually sent. It requires exactly one own
result/error member. Error objects require an integer code and string message.
Malformed envelopes raise TransportError before EVM revert classification.
Null results remain valid envelopes and continue to the existing method-specific
result checks. Structured error data is permitted but is not cast to EVM bytes.

Reference: https://www.jsonrpc.org/specification (Response object and Error object).
The existing latest-state query semantics, endpoint selection and revert heuristic
are unchanged. This does not authenticate a provider, pin a block, validate every
method result, establish chain truth, or authorize transactions.

Regression source: tests/rpc-response-envelope.test.ts, 20 authored cases.
Existing tests/transport.test.ts fixtures now echo the actual request id and
JSON-RPC version; original contract-revert and history assertions are retained.
The absent-result fixture now permits the earlier envelope refusal diagnostic.
All cases are AUTHORED_NOT_RUN here. No syntax check, compiler, unit suite,
network request, Linux runtime or on-chain execution was performed.

Bear should run the exact candidate on approved Linux, including the existing
transport/RPC reader tests and full applicable suite. Other legacy fixtures that
omit protocol members must be corrected rather than weakening the envelope gate.
Specialist inputs and existing test versions are not silently replaced.
