# Stage 5A — responsibility SDK and recovery integration

Draft implementation in progress; NOT typechecked/tested/deployed.
Stacked on Stage 4B, which is stacked on PR #3. No merge yet.

Current source: typed exact consent, controller runtime pins, coherent block
snapshots, fixed action submission, canonical receipt/event reconciliation,
safe recovery journal, linked read-view adapter, shared fixed account/payment
transport. Entry point: `src/controls/index.ts` (experimental; not substituted
for the stable standalone wallet surface).

Account setup/deposit/withdraw and payment client source is now written but
untested. Still developing: full consent/recovery presentation, unified
test/tooling and public-testnet/UI acceptance scripts. Creating this PR is not
stage completion.

No raw-key support, automatic retries or assumption that a hash means success.
Provider timeout leaves the outcome uncertain; reconcile before a new send.
Runtime pins need a trustworthy intended-chain provider and do not prove proxy
implementation stability or legal identity. The authority-backed association
must remain visible to users.

All new commits must remain CI-eligible. Never add CI-skip directives to commit messages or PR metadata.
Workflows and required checks remain unchanged.
Validation must bind the exact candidate and record its runtime environment. Do not equate draft publication or reports with completion.
