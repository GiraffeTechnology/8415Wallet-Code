# Installation asset publication

ArtFi and 8415Wallet repositories remain public for investor review. Controllers must not change repository visibility or schedule an automatic return to private access.

Installation/product packages are currently withdrawn. Do not restore old archives or publish new downloads now. Temporarily suppress only the CI installer/product-kit upload step; retain every test, build, integrity/origin check and other required validation. A runner-local archive or incidental CI artifact is not an accepted distribution.

Rebuild final distributable packages from the final integrated version after all applicable valid PRs are merged. Download publication additionally requires the complete current `docs/ERC-8415-Wallet-PRD.md` §10.8 sequence: privacy review, the applicable V2/V3 online UI and actual on-chain acceptance, fixes and successful retests. V2 chain composition is N/A; V3 chain composition, asynchronous registration and rollback remain mandatory. Only then publish authorized verified product artifacts with English descriptions, exact source identity and SHA-256 checksums, retaining required notices and accurately labelling component-only distributions. Verify the complete uploaded files before reporting publication complete.

Private handoff packages, server configurations, account information, keys, tenant-private data, authentication state and production backups are excluded from public publication. An admitted deployment package is not automatically a public-safe installation asset.

The designated source and delivery owner maintains the proprietary licensing documentation. Deployment controllers must not author separate or conflicting licensing terms. Public accessibility and source attribution do not themselves grant usage permission; consult the applicable license and retained notices.

ERC-8415 and erc8415-kit retain their existing licenses. Preserve all required third-party code, component and font license/copyright notices and valid existing rights. Publication must not rewrite Git history.

The package hold does not suspend independent authorized development or acceptance work, and grants no new deployment or transaction authority. Pull requests may be merged only after their exact required CI checks are all successful. A workflow-source change does not stop existing runs using an older snapshot; report those artifacts separately. Deletion remains limited to explicitly authorized targets. Publication, source merge and CI are separate from actual online/on-chain and owner-assisted acceptance. Historical installation permission, prior green runs and old archives do not override the current complete PRD or this hold.
