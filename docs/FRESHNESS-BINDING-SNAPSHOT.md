# Stable labels for optional feed observations

PRD section 6.1 requires displayed facts to retain their source binding. The freshness builder now captures the selected asset, provenance and claimed register before the first await, and publishes a frozen copy of the source label. Caller mutation cannot relabel an earlier feed read or turn configured provenance into computed provenance.

The reader's declared chain/address is checked after freshness and policy reads, including optional policy failure. A change refuses the observation; policy error handling cannot hide source drift. This checks declared adapter identity only: it is not cryptographic provider authentication, an on-chain register/feed link, state atomicity or protection against an unobserved transient change between checks.

Eight regression cases are authored in tests/freshness-binding-snapshot.test.ts, NOT_RUN. Assigned approved Linux owner should run node --test tests/freshness-binding-snapshot.test.ts and existing freshness/watchtower/browser/full pipeline regressions. No syntax/typecheck/test/build/CI/deployment/chain execution occurred in this source increment. Frozen specialist inputs and Wallet2's v1.2 intake repair paths are untouched. Full PRD acceptance remains OPEN.
