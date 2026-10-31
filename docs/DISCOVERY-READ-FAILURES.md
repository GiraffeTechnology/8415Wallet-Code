# Discovery read failures

Initial source increment following PR123. No runtime acceptance is claimed.

Account discovery previously caught every ownerOf rejection and skipped the
candidate as "burned, or never really there." This could produce available=true
and an empty or incomplete held list when an RPC/adapter failed. A generic
contract revert also does not establish a particular burn or nonexistence cause.

Discovery now preserves the original ownerOf rejection. The promise rejects
instead of publishing a successful partial report. Log-scan and entry-count
failures already propagate and are covered by authored regression cases.
A successful ownerOf reporting a different owner still populates movedOn; a
reader without getLogs still returns the explicit unavailable report.

Availability tradeoff: a historical transfer candidate whose ownerOf now
reverts (including a possibly burned token) stops this discovery attempt.
The wallet does not guess the reason or silently erase that candidate. Callers
may surface the failure and use explicit token identifiers; this increment does
not provide a burn-proof resolver or a best-effort partial discovery mode.

Seven cases in tests/discovery-read-failures.test.ts are AUTHORED_NOT_RUN.
No syntax/typecheck, application test, build, deployment, provider or chain
execution was performed here. Exact-candidate regression includes tests/discoveryAndCli.test.ts and applicable
caller tests.
No endpoint, credential, signing or financial behavior changed.
A successful scan still carries the existing log-retention caveat and does not
prove an account has no other assets or provide an atomic chain snapshot.
