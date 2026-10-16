# Three-wallet test-first orchestration

This is authored, unexecuted source for WALLET-3W-HOODI-20261015-01, prompt 1.0. No syntax check, Windows/Linux product test, deployment, signing or transaction has been performed for this runner. It uses Node built-ins and must not install tools or create replacement infrastructure.

## Execution boundary

Run only on the existing approved Linux execution surface and exact existing POSIX workspace/cache/temporary/output mappings. Offline `regress` uses a scoped existing execution approval, not whole-environment READY; the other modes retain the full Operations READY and Wallet project-prefix gate. The owner's direct 2026-10-16 instruction permits task writes on the system disk, superseding the former device-ID exclusion. All modes still check realpaths, exact commit/tree/lock hash and a clean checkout. The runner never resets, cleans or stashes user files. A locally authored approval or READY JSON is not authorization.

## Offline regression approval (owner repair for the frozen ae677eaf source)

Wallet2 supplied gate-only evidence `offline-regress-gate.json`, SHA256 `506334f0931eb3beb38353dddf935459131c6d64110e1b0ac318cba7375efa3b`: its Linux Node22/24 probes stopped at OPS_READY_REFERENCE_REQUIRED before git/npm. Its synthetic lock pin was format-only, not a real checkout approval. Those original failures and original source-bound syntax/entry-refusal results remain historical, never transferred to this repair.

For `regress` only, set `offlineApproval.file/sha256` to an independently verified, existing scoped authorization record, with schema `8415wallet-offline-execution-approval/1`, status `APPROVED`, scope `offline-regression-only`, this taskId, resolved original `authorizationRef`, exact `sourceCommit/sourceTree/lockSha256`, approved realpath `paths.workspace/cache/temporary/output`, and nonempty unique `allowedScripts` from the runner whitelist. This is an adaptation of actual existing approval, not a new Ops/global READY demand and not permission to fabricate authorization. Each selected regression must also retain its explicit execution reference and prior-refusal reconciliation. Unknown parameters stay unresolved.

Offline mode does not read or require `opsReady`, `rpcEnv`, project/bucket prefix, wallet bindings, contracts, signers, transaction budgets or DB readiness. It still independently checks actual Git commit/tree/clean state and actual lock bytes before creating output or invoking npm. Child environments still exclude live RPC/signer/DB/auth secrets. The runner cannot clear an existing specific refusal. `chain-read`, `transaction-read`, `preflight`, `verify-artifacts` and `finalize-blocked` do not accept this offline approval in place of their existing full READY gate. This patch does not grant deployment authority.

Regression handoff to Wallet2 (NOT_RUN here): missing/malformed/hash-mismatched offline approval; exact-path/source/tree/dirty/lock mismatch; script outside approved list; valid offline typecheck without RPC/full READY; all online modes still refuse absent full READY even when offline approval exists. Freeze the exact repaired commit and retain the before-fix evidence before execution. No test command was run by the developer.

Use `node scripts/acceptance/three-wallet-acceptance.mjs MODE /approved/path/run.json`. Every mode needs a fresh runId. Existing run outputs are never overwritten. The UNRESOLVED example is an input inventory, not executable approval. Do not insert guessed addresses, endpoints, signer routes, contracts, amounts or budgets.

## Modes and limits

- `preflight`: verify the approved environment and exact source identity; record separate acceptance states.
- `chain-read`: use only the existing HOODI_RPC_URL process binding. Verify Hoodi chain/genesis and capture code, 7702 classification, balances, nonces and existing contract code at one finalized block hash; reread its canonical height last. No endpoint or provider error text is persisted. This does not prove account control, proxy/ABI correctness or Keccak runtime hashes. Those remain independently unverified.
- `regress`: invoke only explicitly selected, reviewed existing npm scripts from the source whitelist. EVM execution is explicitly limited to the Hardhat network. Preserve UTC, exit/signal and raw output hashes; stop on failure with no automatic retry. Persist the failing result and aggregate before exiting nonzero, and explicitly list remaining cases as not run. Child processes do not inherit live RPC, signer, database, authentication or Node-options bindings. Exit zero is not business-case acceptance. Existing Hardhat cache and Chromium/socket refusals cannot be cleared by a manifest flag.
- `verify-artifacts`: independently compare existing output artifact sizes and SHA256 values. Integrity alone is not business or chain acceptance.
- `finalize-blocked`: only an explicit formal escalation with precise blockers and per-case actual results can create the fixed FINAL filename, headed BLOCKED. This mode also requires the approved output environment; it cannot run without READY. It does not produce a PASS report or upload anything.

Real UI/session, Agent/signer, three-wallet flows, receipt/state validation, release-time v2/C2 versus later admitted v3/C3 semantics and negative/recovery cases remain supervised acceptance work. Human passwords, OTP/PIN/device proof and signatures stay human-owned. Unknown transaction outcomes must be reconciled before retry. The runner never signs, broadcasts, deploys, installs, merges or reruns CI.

## Test first is not task completion

`transaction-read` captures already-observed transaction hashes, never sends or retries them. Supply at most 64 unique `observedTransactions` entries with unique `caseId`, lowercase `hash/expectedFrom/expectedTo`, canonical decimal `expectedValueWei/requiredConfirmations`. It checks Hoodi identity, transaction/receipt participants and block binding, canonical block membership, receipt status, execution gas fee and depth behind one finalized head, then rereads canonical block hashes. Null results are unresolved and explicitly forbid replay. Reverts and insufficient depth remain distinct. Raw captures do not validate decoded events, per-transaction balance deltas, contract control, blob/total fees, approved budgets or business acceptance. The expected values must come from existing approved evidence, not invented defaults.

Regression selection is validated as a complete batch before any npm process starts: every case ID must be unique, every script must be allowed and present, and every execution reference must be a nonempty resolved string. This prevents a late invalid entry or duplicate ID from causing a partially executed, ambiguous batch. The reference remains an operator attestation, not new authority.

Keep `three_wallet_acceptance`, `full_prd_delivery` and `production_ready` independent. Complete the test/diagnosis/minimal-fix/regression cycle first, then continue all remaining full-PRD Sections 1-9, Stages 0-5 and W01-24 development. Open phase PRs and start the next independent phase without waiting for CI; actual required CI, review and merge gates still apply. Neither script authorship nor passing tests marks the whole task delivered.

Select the exact test candidate with its owner. This additive source is based on the independently verified PR99 commit/tree and does not overwrite its owner branch or combine PR100/101 stacks automatically. Do not expose private configuration, credentials or protected artifacts in GitHub logs or reports.

Create `8415WALLET-THREE-WALLET-ONCHAIN-ACCEPTANCE-FINAL.md` only for actual complete results or a formal BLOCKED escalation, never a placeholder. Deliver to the user-designated private Drive folder, verify owner-only permissions and full byte/hash/content readback, then revise the same file ID. No polling, timers, routine receipts or forum posting are implemented.

After delivery, archive task-owned deliverables to the existing approved giraffe bucket using its established project prefix and authenticated upload/readback route. Independently verify recovery and byte/hash identity before releasing eligible local artifacts. No bucket, credential, upload route or deletion is guessed or created by this runner. Active production keys/state/journals, shared services, other owners' files and unreconciled evidence are excluded from bulk migration/removal.
