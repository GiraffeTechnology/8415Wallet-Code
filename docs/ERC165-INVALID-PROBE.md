# ERC-165 invalid-identifier probe

PRD section 6.1 requires valid ERC-165 discovery before projection display. The official ERC-165 detection procedure requires support for 0x01ffc9a7 followed by a successful false reply for 0xffffffff; a failing second call or an always-true fallback is not conformant.

The discovery helper now follows that response sequence before querying the separate projection and settlement identifiers. A contract revert is distinct from a successful false response at the invalid probe. Transport failures remain transport failures and non-boolean adapter responses fail explicitly rather than being coerced into interface support. Ordinary product-interface reverts remain unsupported, independently for each interface.

Reference: https://eips.ethereum.org/EIPS/eip-165 (Specification, How to Detect if a Contract Implements ERC-165).

This is off-chain response validation through the existing reader port. It does not implement or certify the standard's EVM STATICCALL gas bound, contract correctness, authority or live deployment. No provider endpoint, signer or production state is changed.

Seven regression cases are authored in tests/conformance-invalid-id.test.ts, NOT_RUN. Assigned approved Linux owner should run node --test tests/conformance-invalid-id.test.ts plus existing conformance, interface, RPC/Kit, view and full pipeline tests. Fixtures that answer true to every interface must not be treated as valid ERC-165 providers. No syntax/typecheck/test/build/CI/deployment/chain execution occurred in this source increment. Full PRD acceptance remains OPEN.
