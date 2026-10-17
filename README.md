# 8415wallet

8415wallet is a general-purpose wallet compatible with existing wallet and asset standards, with native [ERC-8415 asynchronous register projection](https://github.com/GiraffeTechnology/ERC-8415) support. Its native projection views show the ERC-721 tradeable position separately from the register-confirmed holder, temporal finality, open gaps and chain freshness. Record agreement does not verify legal identity or title.

## Current requirements and execution

The complete current [Wallet PRD](docs/ERC-8415-Wallet-PRD.md) is pinned in
[config/current-prd.json](config/current-prd.json) to PR135 commit
`7b72d5ad47b12385445ee455627b44620327989c`: 70422 UTF-8 bytes,
SHA256 `f8e62a6e3fa014b8b5f8b67949309eef3876e7d0a1c4caa1c19ebdc793abd11d`.
[AGENTS.md](AGENTS.md) defines current execution ownership and safety boundaries.
Older conflicting execution instructions are superseded, not alternate task inputs;
their original versions remain in Git history.

Wallet owns coding, integration, unit tests and post-submission corrections.
Wallet2 owns genuine on-chain tests; Bear owns independent review, CI and merge.
Complete independent stages and open their PRs, then continue the next stage
without waiting for CI. A document update is not implementation or acceptance.

PRD §6.3.1 requires an owner-controlled ON/OFF switch for per-operation human
verification. OFF requires two independent established factors bound to the exact
change. After verified OFF, still-valid in-scope agent execution must not require
repeated human verification, including after restart or source/component changes.
Historical grants remain subject to actual revocation, expiry and scope, not
automatic re-approval on a version change. An entirety-of-asset-balance grant is
an asset-bounded budget; live funds, reservations, nonces and UNKNOWN safety remain
machine-enforced. This is a requirement, not evidence of current OFF activation,
unattended signer readiness, deployment or passing acceptance.

## V2 and V3 DApp Beta

- **V2 Beta:** the retained wallet PRD v2.2 foundation, sections 1–8: standalone projection and temporal views, dual histories, disclosure, conformance and identity checks, the three protocol settlement transactions, and legacy single-trade clearing.
- **V3 Beta:** the same standalone foundation plus wallet PRD v3.0 section 9: accepted linked responsibilities, permanent completed-prefix detachment, bounded returns, separate optional payments and committed detached history. The acceptance matrix includes W-01 through W-24.
- **Product and platform:** the product is 8415wallet and its UI platform domain is 8415wallet.com. Xiongan is a V2 tenant, identified separately from the product.

Both DApp packages are functional-testing Betas. Genuine wallet/public-testnet, physical-device and W-20 deployment evidence is collected after deployment; it is not silently supplied by local tests. The code is not independently audited. SDK tarballs are separate integration artifacts and do not replace either DApp.

See [DApp packaging and deployment](docs/BETA-DAPP-DELIVERY.md), [PRD coverage](docs/BETA-PRD-COVERAGE.md), and [the Xiongan tenant boundary](docs/XIONGAN-WALLET.md).

## Login methods

Assets and history stay hidden until login. Choose password, an authenticator
code (Google Authenticator / FreeOTP), a local wallet/private-key signature, or
a configured hardware CA token. Authenticator OTP means RFC 6238 TOTP. Email OTP
is not email-only login; verified email is also used for registration, recovery
and exact owner-policy changes under the current PRD.
Password, TOTP and CA methods require the same-origin authentication service and
an independently provisioned account-to-wallet binding. Local wallet signing
still works in a static deployment. Keys stay in the wallet or hardware device;
login never approves a transaction.

[Account authentication](docs/ACCOUNT-AUTHENTICATION.md) covers setup, encrypted
TOTP storage, recovery codes, revocable sessions, hardware-CA adapter requirements
and deployment inputs. The generic CA bridge is implemented and cryptographically
tested; a specific physical device/middleware is not yet accepted. No production
credentials or services are provisioned by the feature. The old immutable handoff
archive is unchanged and does not contain these new login methods.

## Build and verify

Use Node 22.18 or newer and the committed lockfile.

```sh
npm ci
npm run verify
npm run wallet:browser:build
npm run wallet
npm run pack:dapp:all
```

The package manifests record exact source commit/tree, PRD hash, runtime hashes, profile, entry point and build commands. A shared runtime is explicit: V2 enables its standalone feature profile; V3 additionally enables linked responsibility controls.

The local reference server is `npm run wallet:browser:serve`. Its loopback address is for development only. Deployed URLs must contain the confirmed scheme, hostname, port and entry path, taken from the deployment configuration rather than guessed. Never rewrite an origin that an unresolved browser journal was written under.

## Protocol and custody boundaries

- The wallet consumes ERC-8415; it does not change its frozen interfaces or invent a rejection state.
- `ownerOf`, register holder, temporal finality, open-gap contest and optional chain freshness remain separate facts.
- An off-chain read is a snapshot. Integrating contracts should use atomic on-chain reads for dependent actions.
- Standalone use does not require ArtFi, Oracle, a linked wallet, or a payment adapter. The optional Kit adapter accelerates projection reads while chain facts remain chain reads.
- A linked leg completes only when both owner and admitted-holder evidence reach its buyer occurrence or later in the same accepted chain. Completion is an application outcome, not ERC temporal finality.
- Only completed prefixes detach. Later returns stop at the live boundary; optional payment failures cannot reactivate a detached obligation.
- The standalone browser-provider route accepts no private key or mnemonic. The current PRD additionally requires a compatible authorized unattended signer path when owner-verified OFF is effective; an external provider still prompting the human is not evidence of that capability.
- Unknown outcomes remain durable and cannot be silently retried. A direct standard wallet rejection is distinct from a transport failure, lost response or unverified replacement.

## Existing assets and standards compatibility

The external-account companion supports ETH and explicitly configured ERC-20, ERC-721 and ERC-1155 transfers on Ethereum, Base and their supported testnets. It is a separate custody surface from ERC-8415 controlled accounts. It has no automatic NFT discovery, swaps, bridges, arbitrary calldata or delegated keys. Mainnet reach of that surface is not authorization to test with real assets; deployment testing uses authorized testnet assets only.

The normal DApp control manifest and agent-request paths require supported testnets. Direct SDK integrators must enforce their own chain policy; the DApp restriction is not a global SDK mainnet barrier.

Compatibility is a product requirement across existing standards; the native ERC-8415 feature does not restrict the product to ERC-8415 assets. See the [implemented and tested compatibility matrix](docs/STANDARDS-COMPATIBILITY.md) for exact operations, evidence and remaining integration limits. This Beta does not claim exhaustive validation of every standard or token implementation.

## SDK artifacts

`npm run pack:v2` and `npm run pack:v3` create SDK/CLI tarballs; `pack:v2:verify` and `pack:v3:verify` test installation from outside the checkout. The V2 SDK intentionally excludes the linked control/browser surface. The V2 DApp remains a separately built browser deliverable.

## Requirements and historical evidence

- [Wallet PRD](docs/ERC-8415-Wallet-PRD.md): retained V2 foundation and additive V3 requirements.
- [V2 closeout](docs/V2-CLOSEOUT.md): dated semantic evidence and its asynchronous-registrar limitation.
- [Integration boundaries](docs/INTEGRATION-BOUNDARIES.md): protocol, custody and SDK responsibilities.
- [Public evidence](docs/public-evidence/README.md): exact historical runs.
- [Stage delivery history](docs/STAGE-DELIVERY.md): implementation and verification history.
- [September local validation](docs/reports/V3-LOCAL-VALIDATION-20260925.md): historical source-bound results.

Earlier Sepolia receipts and test totals remain evidence for their named versions. They do not validate a newer source tree, artifact or deployed origin. Current CI and build evidence must identify the exact tested commit; publication, merge and hosting do not themselves establish full PRD acceptance.

## Login before viewing assets

The public entry stays open. A verified, origin/account/chain-bound wallet login
is required before protected browser assets, balances, holdings, histories and recovery journals
are loaded or displayed. The browser login session is memory-only. This display
boundary must not be imposed as repeated human login on an already-authorized
agent operation covered by durable OFF after reload or restart;
connecting an account alone is insufficient. See [wallet login and its exact
privacy boundary](docs/WALLET-LOGIN.md). Public blockchain data remains public, and
this client-side gate is not private-API authorization.

## Interface languages

The browser UI supports English, Simplified Chinese, Traditional Chinese, French,
Spanish and Japanese through fixed source catalogs and a compact language control.
Token metadata remains source-original. See [UI localization](docs/UI-LOCALIZATION.md)
for privacy, transaction-value and verification boundaries.
# Authentication deployment preparation

The Xiongan account-service and browser-local authenticator QR preparation is
documented in [AUTH-PROVISIONING-PREPARATION](docs/AUTH-PROVISIONING-PREPARATION.md).
The service/proxy templates are **not activated**; the public template has no
account binding and intentionally cannot start. New regression sources have not
been run in this preparation. Existing UI deployment and test evidence are not
promoted to genuine authentication acceptance.

## Account registration and authentication settings

Ordinary account registration requires verified email ownership followed by an
origin-, tenant-, wallet- and chain-bound EOA proof. Password login can be added
during signup; enabled methods remain independent. Existing accounts can complete
required email migration from authenticated settings without replacing their
credential store or encryption key. Email OTP is limited to registration and
security-reset verification, never email-only login. See
[Email registration](docs/EMAIL-REGISTRATION.md) and
[Account authentication](docs/ACCOUNT-AUTHENTICATION.md).

## License

Licensing notice issued in 2026. Copyright remains with the respective
copyright holders identified in source notices and project records.
All rights reserved for the material covered by [LICENSE](LICENSE).

This repository is public so investors and other readers can review the work.
Public visibility does not grant an additional license to use its covered
material. The original material covered by LICENSE is proprietary. Except for applicable
GitHub platform rights, legal exceptions, valid prior grants, and independently
applicable licenses, copying, modification, redistribution, commercial use, and
deployment require separate written permission from the copyright owner.
Authorized copies of covered material must preserve the required notices,
identify this repository and the source version, and clearly identify
modifications. Attribution alone does not grant permission.

The ERC-8415 specification, erc8415-kit, and independently licensed components
are excluded and retain their own applicable terms. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
