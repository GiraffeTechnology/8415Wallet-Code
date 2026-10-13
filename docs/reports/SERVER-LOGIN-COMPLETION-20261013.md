# Server-backed login completion boundary

The final asynchronous provider account/chain read could complete after server-session expiry, a backward clock change or an origin change. Three new regressions reproduced an incorrect LOGIN_VERIFIED result. The repair rechecks completion time and origin before publishing the session, preserving the original expiry and existing logout/revocation behavior.

## Executed validation

Linux Node 24.18.0:

- Before repair: the three new regressions failed (missing expected rejection).
- `node --test tests/account-login.test.ts tests/wallet-login.test.ts tests/account-login-ui.test.ts tests/wallet-login-ui.test.ts`: 168 passed, 0 failed, 0 skipped after repair.
- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- A delayed read finishing one millisecond before the original expiry succeeds without renewing it.

These are synthetic handler/DOM and cryptographic contracts, not genuine browser, physical-device, hosted CI or production acceptance. Account/chain bindings, enabled methods, credential storage, challenge formats and transaction authorization are unchanged. No real signing or chain transaction was performed.

## Continuation

Review this repair independently. Preserve failing evidence, existing artifacts and the separate late-v3 work. Production deployment and real three-account login remain uncompleted; do not initialize credentials, rebind accounts or replay unknown transactions as part of this source correction.
