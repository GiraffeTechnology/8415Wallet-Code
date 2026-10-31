# Hoodi report DApp consumption

Initial development layered on PR95 without modifying its submitted module.

web/hoodi-journey-panel.mjs mounts inside the EXISTING wallet-private area through the additive app import. It uses the existing WalletLogin instance, not a new session or a JSON verified flag. File read, provider read and result publication are gated by capture/assert/check. Logout, expiry notifications, account/chain changes and page lifecycle discard input/output and stale asynchronous results. Text is assigned with textContent, not HTML. Backend/raw evidence/error text is not logged or rendered.

Input is a local JSON envelope with exactly original and laterV3, produced from PR95's evidence contract. Protocol integers are canonical decimal STRINGS, parsed losslessly. Maximum input is 64KiB. The current authenticated wallet must match an exact manifest account and Hoodi; a server tenant, when present, must match that wallet binding. This is privacy gating, not permission to release or move an asset.

openHoodiJourneyRead accepts ONLY the existing selected authenticated provider. It checks Hoodi chain and genesis, selects finalized, and uses EIP-1898 blockHash + requireCanonical for all projection eth_call and contract-code reads. Unsupported canonical tags fail: never fall back to latest or another RPC/network. Calls are bounded to 30s and reads only; actual chain changes are rechecked. Structured execution-reverted code 3 remains ContractRevertError. No signing, broadcast, transaction retry or new endpoint is present. Code presence does not prove account control.

The provider adapter is temporal-only: log scans fail explicitly rather than returning empty success. Real receipts, occurrence proofs and original control decisions remain independently verified by the authorized executor. UI adoption is not actual provider acceptance.

Development supplied four provider test-source cases without running/compiling/testing or reading CI. Manual acceptance cases: missing/expired/revoked login; delayed file/provider response across logout/account/chain switch; local/server tenant mismatch; malformed/oversized JSON; unsupported EIP-1898; final block hash change; no signing requests; desktop/mobile wrapping and exact original/late-history prose. Actual deployment and chain evidence must use the exact original bindings.

No private binding, credentials or evidence are bundled. Original PR95 and PR87–94 are preserved.
