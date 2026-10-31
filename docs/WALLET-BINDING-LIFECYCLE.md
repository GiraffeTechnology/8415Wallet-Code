# Same-account wallet authentication binding

This increment implements authentication lifecycle, not an asset transfer, new asset
account, changed Agent scope, deployment or full product acceptance. It retains the
complete PRD without amendment. Different-address signer replacement remains unsupported.

## Exact flow

`walletBindingManagement: "same-account-v1"` advertises the capability. Authenticated
account state reports `walletBinding: {account,chainId,bound}` for the selected account.

- `wallet.unbind` uses the established combined method-change flow, including the
  previously verified email OTP and retained existing authenticator/recovery checks.
- `wallet.initial` rebinds only the same already-owned selected account/chain. It
  requires an established password as the independent method, verified email OTP,
  then a new wallet signature over `walletMessage` returned by confirmation.
- The signature binds action, account, chain, origin, tenant, credential revision,
  old/new binding hashes, request, nonce and expiry. Login/registration signatures,
  signatures by another address, replay, expired and stale revisions are refused.
- A replacement address or chain is not accepted as an input. Asset membership and
  all Agent scope records are left unchanged. The other owned wallet bindings are
  retained; a binding for account B cannot serve as account A's authentication method.
- A previously explicit disabled-wallet setting stays disabled after rebinding; the
  existing separate enable-method operation is required to enable it. Rebinding does
  not silently reactivate other owned signers through the shared method setting.
- Serialized commit advances the credential revision and invalidates sessions/proofs.
  Every selected account retains an enabled independent sign-in method. If no existing
  supported independent factor remains, the separate recovery process is required.

## Persistent representation and compatibility

`walletBindings: {version:1,identities:[{account,chainId}]}` overrides configured
sign-in bindings. An empty list is an explicit tombstone, not permission to fall back.
Every identity must still be in the unchanged asset membership; malformed state fails
closed. Login and policy-factor checks consult the selected effective binding.

The encrypted envelope and AAD use generation 4 (`8415wallet-auth-store/4`); payload
schema is `8415wallet-credential-state/4`. Ordered required capabilities are
`credential.assetControlPolicies/1`, `credential.caBindings/1`,
`credential.walletBindings/1`. Once written, generation 4 is retained. Existing
unmodified generation-3 readers reject it. Package owners must declare auth state
semantics `8415wallet-auth-state/7`, include `server/wallet-bindings.mjs`, accept only
reviewed historical packages for inspection, and reject downgrade to earlier semantics.
No real credential store migration is performed by this source change.

## UI and evidence limits

Separate unbind/rebind buttons appear in authentication method management for the
current account. Rebinding has no alternative address input. Six locale catalogs carry
the exact same safety explanation. The new signer flow checks selected provider account
and chain before and after signing; dismissal, navigation or context change discards a
late result. Unknown completion requires sign-in/readback, not an automatic retry.

Focused synthetic HTTP, encrypted-store and deterministic DOM tests cover lifecycle,
proof boundaries, restart, selected-account scope, concurrent commit, cancellation and
provider identity. These are not hardware-wallet, browser, live-runtime or production
acceptance, and do not establish different-address replacement support.
