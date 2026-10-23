# Canonical static ABI decoded values

Initial Stage 1 / W-16 increment following PR128.

The shared read codec now refuses non-0/1 booleans, nonzero high bits outside
uint8/uint64, dirty address high padding and dirty bytes4 trailing padding.
Payloads must be hexadecimal whole 32-byte words and meet the declared minimum
length. Malformed values cannot silently become finality, ERC-165 or plausible
address answers. Valid values preserve bigint precision and existing casing
normalization.

Reference: Solidity Contract ABI Specification, types and formal encoding:
https://docs.soliditylang.org/en/latest/abi-spec.html#formal-specification-of-the-encoding

Compatibility is explicit: bare hex / 0X input and extra complete return words
remain accepted. This is not a complete strict-ABI payload decoder, dynamic
decoder or validation of trailing words against an unknown schema. Encoding and
selectors are unchanged. No provider authentication or chain truth is established.

Twelve regression cases are AUTHORED_NOT_RUN, including a mocked RPC read consumer.
No compiler, syntax check, tests, build, UI, provider or chain execution here.
Exact-candidate validation includes existing codec/RPC/Kit, event and signer consumers. This file also contributes to the server exact-signer
source digest: rebuild and review the changed runtime
identity and source-closure pins before any deployment/acceptance. Do not silently
replace an approved executor or the exact input tied to prior test evidence.
