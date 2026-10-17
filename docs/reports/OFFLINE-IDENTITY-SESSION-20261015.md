# Offline identity and session acceptance — 2026-10-15

## Exact source and integration

Parent: PR #87, `695d9e23c671dd98a0591e4624ff40125a62c245`, complete tree `9e308710d03e0bc841bd037fdaa97540b3d4303d`.
This candidate retains PR #87's implementation and all 47 Kit tests, adding narrow fixes. PR #86's stop/reservation/drain code is unchanged. Other branches are not modified.

- Capture identity options/method bindings at construction; reject malformed configured chain identity rather than silently disabling profile comparison.
- After an awaited chain read, prefer any already published immutable pin before comparison/publication. A deterministic microtask race previously accepted two different identities.
- Bind WalletSession sends to its captured account, chain and contract; pass a detached frozen request to asynchronous signers.
- Keep the EIP-1193 signer's account private and immutable across provider awaits.
- Pin and recheck source identity before/after asynchronous reads; freeze published identity and reject malformed nonzero bytes32 values without poisoning retry.
- Add local authorization/session/nonce/recovery concurrency regressions, with a standard npm test entry for the new authorization file.
- Refresh product-source hash pins, preserving the policy and existing entries.

## Reproduction and unique tests

Environment: Linux, Node v24.19.0, existing installed dependencies. No dependency install or credential setup.

```
node --test tests/kitReader.test.ts tests/kit-identity-gate.test.ts tests/identity.test.ts tests/session.test.ts tests/session-identity-races.test.ts tests/signer.test.ts tests/task-receipt-offline-boundaries.test.mjs tests/responsibility-recovery-review.test.ts tests/responsibility-execute-review.test.ts
npm run typecheck
```

Final affected run: **165 passed, 0 failed, 0 skipped**, exit 0. TypeScript check passed over the materialized TS source and test tree.

| Layer / file | Unique tests | Evidence boundary |
|---|---:|---|
| Kit reader existing + PR87 (`kitReader.test.ts`) | 47 | Memory reader / fake Kit transport |
| Added identity matrix (`kit-identity-gate.test.ts`) | 36 | All 10 projection entries; mismatch, transport retry, concurrency, drift, configuration, malformed data, publication race |
| Contract identity (`identity.test.ts`) | 17 | Source drift before/during reads; immutable pin; malformed/retry |
| Wallet session (`session.test.ts`) | 24 | Watch-only, sender/chain/contract isolation and existing projections |
| Session/signer races (`session-identity-races.test.ts`) | 3 | Synthetic asynchronous signer/provider |
| Signer (`signer.test.ts`) | 15 | Stub EIP-1193 provider |
| Authorization (`task-receipt-offline-boundaries.test.mjs`) | 13 | Actual service + MemoryCredentialStore; synthetic effects. Nonce competition, queued expiry/clock/revision change, five session fields, challenge replay/cancel, unknown outcome reconciliation |
| Recovery (`responsibility-recovery-review.test.ts`) | 7 | Actual session/CAS; receipt responses mocked |
| Execution (`responsibility-execute-review.test.ts`) | 3 | Actual session → ControlClient → synthetic EIP-1193 provider; one claimant/send, stale CAS and unknown final persistence |

The counts are unique file/test cases from one final command. Earlier red/green iterations and independent review probes are not added again. Independent review also covered simultaneous first pin and dual-backend drift.

## Failure evidence retained

Initial legacy Kit regressions failed before repair. Exact PR #87 against the added 35-case identity matrix passed 33 and failed 2 (mutable options and configured undefined profile). Its publication race was separately reproduced with a deterministic microtask schedule. Session scope (5), session/signer mutation (2), source pin (6), and malformed pin (6) regressions failed before their fixes. Logs remain in the offline evidence bundle, with hashes in its manifest.

PR #86's previously verified 60-test authorization/runtime result is reused for unchanged stop semantics; it is not included in the 165 or rerun for reporting. Stop/nonce/fee-budget behavior is not claimed as newly implemented here.

## Limits and remaining acceptance

The remote candidate is constructed from the complete parent Git tree. Local unchanged materialized files are checked against exact blobs. Historical release ZIPs, two Python bytecode files and the vendored runtime TGZ are not materialized; they are preserved remotely. All dependencies used by the affected run are present. Full npm test, package/build/install verification and EVM suites are not claimed.

No live wallet, real signing/broadcast, on-chain transaction, human UI, browser journey, installed HTTP/service wiring, private ArtFi provider integration, credential configuration, deployment or merge was run. Synthetic provider success does not prove those acceptance layers. Exact-head remote CI must be evaluated separately before merge; local success is not CI success.
