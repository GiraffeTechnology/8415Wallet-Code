# example-tenant-a authentication preparation (historical PR58 record)
> Deployment names and host addresses in this public document are synthetic
> examples or unresolved placeholders. They do not identify an existing instance
> and must not replace the operator's separately retained approved bindings.


For the current reusable DApp kit, secure first provisioning, tenant-scoped Unix
transport and installation/update/rollback commands, use [AUTH-INSTALL.md](AUTH-INSTALL.md)
and [DAPP-INSTALL.md](DAPP-INSTALL.md). The status, fixed paths/port and unexecuted
claims below describe that earlier preparation snapshot; they are not the
current package or test receipt. Exact-source CI evidence is recorded separately.

Status: SOURCE_PREPARED_NOT_TESTED_NOT_ACTIVATED. This is not a deployment or
acceptance certificate. Existing merged UI remains deployed unchanged.

## Source provenance

Base main: `2fb99c5275a4cc5ed692982498d397ec49fb902d`.
Base tree: `514900f10f3edf6a4b2eb23435b8b3ab41f39564`.
No application, test, listener, operator identity or credential has been created
by preparing these files.

## Concrete, inactive service proposal

The following tenant and host values are synthetic configuration examples.
Recheck service ownership, an available loopback port and target path absence
before installation. Do not replace any unrelated service or shared bridge.

- Origin: `https://example-tenant-a.invalid:8443` (existing UI path `/web/index.html`).
- Runtime source: `/opt/8415wallet-auth-example-tenant-a/current`; immutable release beneath
  the configured runtime root, root-owned and not writable by web clients.
- Account configuration: `/etc/8415wallet-auth-example-tenant-a/auth.json`, root:root 0600;
  parent root:root 0700.
- Operator-owned independent key source: fixed private `store-key` under that
  same directory, root:root 0600, never in source, web, arguments or logs.
- Encrypted state: `/var/lib/8415wallet-auth-example-tenant-a/credentials.enc`, single writer.
- Unit candidate: `deploy/auth-runtime/8415wallet-auth.service`.
- Loopback: `127.0.0.1:<configured-port>`; no public auth listener.
- Proxy snippet: `deploy/auth-runtime/auth-location.nginx.conf`, included ONLY
  within existing example-tenant-a TLS server, never the platform tenant's server.

The source/unit templates are NOT installed or enabled. No disabled service mode
or new health endpoint is invented. `accounts: []` in the public preparation
template deliberately fails validation. No fixture wallet may be used to make
production startup pass. `/auth/capabilities` reports protocol support, not each
account's configured login methods; `/auth/bootstrap` is only CSRF preauth.

Before activation, verify the actual Node 22/24 executable against
the candidate `/usr/bin/node`, dependency installation, service hardening and
systemd credential mount identity/modes.
The fixed service entry supplies the operator-created key in process memory only
and removes the environment entry after opening the encrypted store. It logs no
key. The credential store still enforces its existing single-writer lock; never
delete a live lock or restore an old credential snapshot as routine rollback.

## New secure operator command

`npm run wallet:auth:operator -- --help` documents this newly authored tool;
it is not a previously existing `wallet:auth:init` feature. On an approved trusted
Linux terminal, after the authorized operator verifies the existing tenant's private
parent and protected ownership/mode, the approved operator runs
`node server/operator-init.mjs --initialize --tenant EXISTING_TENANT` as root from
the verified runtime. `EXISTING_TENANT` is an unresolved documentation placeholder,
not a configured default. The tool asks for the
confirmed public username, complete canonical origin, existing listener port,
controlled EOA, Ethereum/Base scope and explicit binding approval, then creates
config once. No live deployment value is supplied by the public template.
The command does not prompt for, generate or read secret values. Existing
config is never overwritten. `--check --tenant EXISTING_TENANT` emits only counts and configuration validity,
never addresses, password hashes or credentials, and does not check or activate keys.

Account bindings do not prove wallet ownership, activate an account or authorize
a mainnet transaction or transfer. The empty preparation template remains a
separate negative-validation fixture. Configuration requires Linux verification
and secure credential provisioning; no activation occurred in this snapshot.
The unique address/chain-pair validator runs before the credential store opens
and in the actual service constructor, rejecting ambiguity across usernames.
Optional password hashes and CA fingerprints remain independently provisioned;
wallet-only initial config does not claim those methods or TOTP are configured.

The operator creates/injects the independent 32-byte key through the approved
secret process and systemd LoadCredential. This tool does not generate it. Never
put key bytes in command arguments, shell history, chat, a source checkout or a
public artifact. Deployment must not activate until binding and key steps succeed.

## Local QR and privacy

The only encoded content is the enrollment endpoint's `result.uri`. Canvas uses
four-module quiet space, integer pixels and local modules. It makes no QR request,
creates no URI-bearing DOM attribute/image URL/download, and does not change CSP.
Manual secret/URI text remains the fallback. Confirm, cancel, error, expiry,
session/account/chain changes, logout and page exit clear text bindings, timers
and canvas backing pixels. Late responses recheck session binding and generation
before display. Switching locale changes labels, not QR content or credentials.

Local renderer derives from upstream qrcode-generator `js/dist/qrcode.js`, Git
blob `df13f829bf41f36b82f0ed85751ed3b4c39cfeb8`. Adaptation: remove UMD footer,
append ESM default export and include full MIT license. No dependency resolution
or remote browser loading is required. The independent test-only jsQR decoder
is upstream `dist/jsQR.js`, Git blob `99ea9df26907009e5553233ffe03c529c1521739`,
retained with one added terminal newline and Apache-2.0 license. Its local Git
blob is `4647341e5f87d45f1634c05134bf1a68a739a156`. It is never shipped in public web.
See upstream [renderer](https://github.com/kazuhikoarase/qrcode-generator) and
[decoder](https://github.com/cozmo/jsQR). Vendor review is not security certification.

## Required execution before publication

Run complete `.github/workflows/ci.yml` on BOTH Linux Node 22 and 24, bound to
the exact repair commit/tree: `npm ci` (no ignore-scripts), typecheck, full units,
`test:auth` including new public-config negatives and independent pixel decoding,
browser build, all existing login/privacy/account/i18n/approved UI/recovery tests,
full local EVM, reference CLI, V2/V3 SDK external installs, DApp checks, integrity,
byte-reproducible archives and settlement browser recovery. Do not replace the
pipeline with only the focused new tests. Neither vendor code nor tests were run
in this source preparation.

Real page synthetic journeys must prove desktop/mobile local QR decode equals
the actual server URI, no off-origin request, manual fallback, locale stability,
confirm/cancel/logout/timeout/identity/pagehide pixel and text erasure, stale response
refusal, replay/recovery, unchanged review and no secret screenshot/trace/artifact.
The public static resource list must include `enrollment-qr.mjs` and
`qr-generator.mjs`; stagePublicWeb already stages tracked `.mjs` files. The
development server's explicit list is updated. Update the generated
nginx resource map from the new release manifest rather than silently trusting
old deployed allowlists. No new data/image/CDN CSP allowance is needed.

Exercise synthetic isolated HTTP Host/Origin/tenant/CSRF negatives, duplicate and
unknown binding, missing key/nonempty account gates, concurrent store lock,
configuration restart invalidation, enrollment one-use recovery and failure
cleanup. Secure-terminal CLI file permissions/exclusive-create and systemd
credential/hardening behavior require Linux evidence. No test result is inferred.

## Activation and rollback after review

Validate and install immutable source and lock dependencies, then confirm
public bindings and separately provision secrets through the operator flow.
Validate fixed config, start the unit and only then enable the Host-specific proxy
after `nginx -t`. Correct HTTP probes include `X-Wallet-Tenant:example-tenant-a`; POST also
requires exact Origin, JSON, cookie and CSRF. No `/auth/health` shortcut exists.
The user signs a login-only registered-wallet challenge and, within five minutes,
starts TOTP setup, scans locally, confirms six digits and privately saves eight
recovery codes. No transaction or transfer is required for login acceptance.

If activation fails, remove only the added proxy include and stop only this auth
unit; preserve current UI, origins, shared services, account configuration and
credential state. Never roll credential counters back. Code rollback must remain
compatible with current encrypted state or require authorized recovery. Binding
updates require service restart and revoke sessions, not simply a page refresh.


