# Product contract excerpts for source tests

These are verbatim product-only excerpts. They are not the internal execution entry, an operational configuration, or a replacement for external delivery checks.

The sole current complete product requirements are `docs/ERC-8415-Wallet-PRD.md`:
- Release label: **Beta 2.0**; V2 standalone and V3 linked runtime profiles remain distinct.
- Requirements revision: **2026-10-19 HKT multichain core requirement**, matching `config/current-prd.json`.
- Exact UTF-8 bytes: **111167**.
- SHA-256: **3a4ac57c8cfec42b51799a26cf89ac91bc7218a14265c95e62493d5d6a95a39f**.

For protocol semantics, the ERC is authoritative; application authorization, accepted responsibility flows, user-specific DONE and rollback rules are governed by the current PRD. Do not invent extra completion gates or overwrite the protocol with application terminology. The interface identifiers remain `0x6309e170` for `IRegisterProjection` and `0xf4a7d71b` for `IProjectionSettlement`.

8415wallet is a multichain, general-purpose application-layer wallet compatible with
existing wallet and asset standards, with native ERC-8415 asynchronous register
projection support. Native ERC-8415 features are additive and do not make the
product exclusive to ERC-8415 assets. Report implemented and tested standards
separately from the broader compatibility requirement.

Product identity is **8415wallet**; its UI platform domain is
**8415wallet.com**. Tenant deployments are configurations, not separate products. Do not publish real tenant identities.
V2 and V3 are versioned DApp Beta deliveries mapped to the retained v2.2
foundation and additive v3.0 requirements. SDK packages are separate integration
artifacts and do not replace either DApp. Keep the exact implemented/tested
standard and provider matrix in `docs/STANDARDS-COMPATIBILITY.md`, without
claiming exhaustive validation of all existing standards.

A web origin is scheme, host **and port**, so the address a wallet is served on
is part of its origin. Every IndexedDB operation journal belongs to that origin,
including an operation left in `outcome-unknown` — the record the recovery path
exists to find. Moving a served wallet to a different scheme, host or port
strands them all.
