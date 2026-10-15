# Three-wallet test-first orchestration

This is authored, unexecuted source for WALLET-3W-HOODI-20261015-01, prompt 1.0. No syntax check, Windows/Linux product test, deployment, signing or transaction has been performed for this runner. It uses Node built-ins and must not install tools or create replacement infrastructure.

## Execution boundary

Run only on the existing approved Linux execution surface, after Operations supplies an independently verified READY receipt and exact existing non-system POSIX workspace/cache/temporary/output mappings and Wallet project prefix. The runner checks device IDs against the root filesystem, realpaths, exact commit/tree/lock hash and a clean checkout. It never resets, cleans or stashes user files. A locally authored READY JSON is not authorization.

Use `node scripts/acceptance/three-wallet-acceptance.mjs MODE /approved/path/run.json`. Every mode needs a fresh runId. Existing run outputs are never overwritten. The UNRESOLVED example is an input inventory, not executable approval. Do not insert guessed addresses, endpoints, signer routes, contracts, amounts or budgets.

## Modes and limits

- `preflight`: verify the approved environment and exact source identity; record separate acceptance states.
- `chain-read`: use only the existing HOODI_RPC_URL process binding. Verify Hoodi chain/genesis and capture code, 7702 classification, balances, nonces and existing contract code at one finalized block hash; reread its canonical height last. No endpoint or provider error text is persisted. This does not prove account control, proxy/ABI correctness or Keccak runtime hashes. Those remain independently unverified.
- `regress`: invoke only explicitly selected, reviewed existing npm scripts from the source whitelist. EVM execution is explicitly limited to the Hardhat network. Preserve UTC, exit/signal and raw output hashes; stop on failure with no automatic retry. Persist the failing result and aggregate before exiting nonzero, and explicitly list remaining cases as not run. Child processes do not inherit live RPC, signer, database, authentication or Node-options bindings. Exit zero is not business-case acceptance. Existing Hardhat cache and Chromium/socket refusals cannot be cleared by a manifest flag.
- `verify-artifacts`: independently compare existing output artifact sizes and SHA256 values. Integrity alone is not business or chain acceptance.
- `finalize-blocked`: only an explicit formal escalation with precise blockers and per-case actual results can create the fixed FINAL filename, headed BLOCKED. This mode also requires the approved output environment; it cannot run without READY. It does not produce a PASS report or upload anything.

Real UI/session, Agent/signer, three-wallet flows, receipt/state validation, release-time v2/C2 versus later admitted v3/C3 semantics and negative/recovery cases remain supervised acceptance work. Human passwords, OTP/PIN/device proof and signatures stay human-owned. Unknown transaction outcomes must be reconciled before retry. The runner never signs, broadcasts, deploys, installs, merges or reruns CI.

## Test first is not task completion

Keep `three_wallet_acceptance`, `full_prd_delivery` and `production_ready` independent. Complete the test/diagnosis/minimal-fix/regression cycle first, then continue all remaining full-PRD Sections 1-9, Stages 0-5 and W01-24 development. Open phase PRs and start the next independent phase without waiting for CI; actual required CI, review and merge gates still apply. Neither script authorship nor passing tests marks the whole task delivered.

Select the exact test candidate with its owner. This additive source is based on the independently verified PR99 commit/tree and does not overwrite its owner branch or combine PR100/101 stacks automatically. Do not expose private configuration, credentials or protected artifacts in GitHub logs or reports.

Create `8415WALLET-THREE-WALLET-ONCHAIN-ACCEPTANCE-FINAL.md` only for actual complete results or a formal BLOCKED escalation, never a placeholder. Deliver to the user-designated private Drive folder, verify owner-only permissions and full byte/hash/content readback, then revise the same file ID. No polling, timers, routine receipts or forum posting are implemented.
