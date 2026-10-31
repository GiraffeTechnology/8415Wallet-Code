# V2 standalone installation candidate

This kit contains V2 browser UI, the V2 auth/API runtime, and separate protected UI/runtime installers. It does not contain the V3 linked implementation, the private provider bundle, a full source archive, production configuration, accounts, passwords, keys or credentials. The complete product PRD is retained inside the UI archive. Source commit/tree and package hashes must be checked against the independently conveyed handoff, not trusted only because they appear alongside an archive.

## Scope and prerequisites

Node 22.18 or newer is supplied by the existing approved environment. Runtime production dependencies are bundled. Existing hardware-CA verification additionally needs the already-authorized OpenSSL 3 and actual device integration; this kit does not provision them. Ordinary asset task/sale integration uses the reviewed external-provider composition supplied separately by the authorized operator. A missing provider is unavailable, never a successful sale. No private ArtFi provider code is published in this kit.

The operator supplies the exact existing tenant, expected origin, socket and authoritative encrypted store/configuration bindings. Do not create an empty replacement store, overwrite credentials/journals, silently migrate an old mixed-profile runtime, change ports, provision credentials, or activate services merely because package verification succeeds. The V2-specific runtime format is credential store generation 3 and auth-state semantics 6. Downgrades and incompatible prior profiles fail closed.

## Verify and prepare

1. Independently verify the complete kit SHA256 and content-tree pin from its handoff. Use `node scripts/package/verify-v2-delivery.mjs verify <archive> <sha256> <tree>` before writing any extracted payload. Its `extract <archive> <sha256> <tree> <new-private-directory>` command verifies again before writing only to a new protected directory; it does not install. Its archive reader rejects links, traversal, duplicate entries, malformed tar headers and unsupported records.
2. The UI installer is `deploy/dapp-v2/install.mjs`. Its `config`, `plan`, `install`, `upgrade` and `rollback` commands retain explicit tenant/profile/target/pin requirements and never alter services. Only `--profile v2` is accepted. Review its static-serving plan; do not install it into a server automatically.
3. The auth installer is inside the auth archive at `deploy/auth-runtime-v2/install.mjs`. Incoming prepare/upgrade requires independent `--expected-tree` and `--expected-manifest-sha256` pins. It verifies the exact V2 runtime inventory, store semantics and all imports before staging. It does not authorize activation or credential generation.
4. Keep existing origin, keys, credential store, revisions, grants, pending transactions and unknown-outcome journals. Unknown state must be reconciled, never cleared to permit installation. Existing V2-compatible installed-release receipts govern upgrades and rollback; a legacy mixed-profile deployment needs separate reviewed migration and cannot be relabelled V2.
5. After any authorized installation, independently read back actual served UI/backend source identities, API/runtime/store binding, login and recovery, ordinary V2 operations, and the applicable test outcomes. No install or test result is asserted by these instructions.

## Evidence boundaries

The kit is an offline installation candidate, not evidence of deployment, current remote CI, a physical browser/mobile journey, real SMTP delivery, hardware CA success or chain acceptance. V3 chain-composition scenarios are N/A for V2, not passed tests. Preserve ordinary multichain capability limits and exact execution-network checks. No new authority for transactions, credentials, configuration changes, deployment, or notifications is supplied here.
