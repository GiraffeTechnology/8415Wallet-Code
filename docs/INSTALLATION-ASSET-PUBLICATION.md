# Installation asset publication


The current CI workflow disables installer/product-kit artifact uploads while retaining every test, build, integrity/origin check and other required validation. A runner-local archive or incidental CI artifact is not an accepted distribution.

Rebuild final distributable packages from the final integrated version after all applicable valid PRs are merged. Download publication additionally requires the complete current `docs/ERC-8415-Wallet-PRD.md` §10.8 sequence: privacy review, the applicable V2/V3 online UI and actual on-chain acceptance, fixes and successful retests. V2 chain composition is N/A; V3 chain composition, asynchronous registration and rollback remain mandatory. Only then publish authorized verified product artifacts with English descriptions, exact source identity and SHA-256 checksums, retaining required notices and accurately labelling component-only distributions. Verify the complete uploaded files before reporting publication complete.


Public accessibility and source attribution do not themselves grant usage permission; consult the applicable license and retained notices.

ERC-8415 and erc8415-kit retain their existing licenses. Preserve all required third-party code, component and font license/copyright notices and valid existing rights. Publication must not rewrite Git history.

Pull requests may be merged only after their exact required CI checks are all successful. A workflow-source change does not stop existing runs using an older snapshot; report those artifacts separately. Publication, source merge and CI are separate from actual online/on-chain and owner-assisted acceptance. Prior green runs and old archives do not override the current complete PRD or its release acceptance criteria.
