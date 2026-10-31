# Authenticated NFT inventory and detail read contract

This is shared V2/V3 PRD §10.5 infrastructure. It supplies no production endpoint,
credentials, deployment, real asset discovery service or automatic media fetch.
Missing `nftInventoryReader` is `NFT_INVENTORY_NOT_ENABLED` (503), never an empty
wallet. `account.nftInventoryAvailable` reports capability configuration only.

## Authenticated boundary

`createAuthRuntime({ nftInventoryReader })` forwards a process-owned capability
with `readForPrincipal(context)` to the common service. Both V2 and V3
`startAuthFromEnvironment({ nftInventoryReader })` forward the same reviewed
capability. The default systemd entry does not discover or construct a reader;
a real process composition must supply the independently verified discovery
and RPC bindings. No module path or reader can be injected through HTTP or JSON
configuration. POST
`/auth/assets/nft-inventory` accepts **only** `{readId}` (32 lowercase hex digits).
Existing origin, tenant, cookie, CSRF and credential/session validation apply,
including a second credential check after the asynchronous source read. The
principal is server-derived `{tenant,origin,username,account,chainId}`. Caller
parameters cannot supply a provider, discovery catalog, scope or completeness.
`AccountAuthClient.readNftInventory()` generates a fresh nonce, checks the same
session remains active and validates exact response keys, scope, freshness and
all nested privacy DTOs. Unknown outcome does not initiate a transaction retry.

Source envelope: `schema:'8415-authoritative-nft-inventory/1'`, exact `scope`
principal, `readId`, safe millisecond `observedAt`/`validUntil`, `inventoryState`
(`complete|partial|stale|unavailable`), and at most 1024 `records`.
Response uses `schema:'8415-nft-inventory/1'`, excludes username from scope, adds
`state` (`ready` only for fresh explicit complete enumeration), and drops all
records when stale/unavailable. Partial enumeration never becomes a complete
wallet. Source exceptions are sanitized. Duplicate contract/token/chain tuples,
private extra keys, malformed integers and zero-quantity holding rows refuse.
A complete empty list requires explicit trusted discovery evidence.

## Concrete RPC adapter

`createRpcNftInventoryReader({discovery,rpcForPrincipal,detailsReader?,now?})`
uses independent server-owned capabilities; no request URL or frontend provider
is used. `discovery.listForPrincipal(context)` must independently authorize the
principal and return exactly `{scope,readId,observedAt,validUntil,inventoryState,
blockNumber,blockHash,tokens}`. Each token is exactly
`{contract,tokenId,standard,metadata}`. Discovery is NOT the asset-authorization
classification catalog: that catalog does not establish holdings or completeness.
The discovery snapshot block is pinned for all reads. It verifies `eth_chainId`,
canonical block hash, token bytecode, ERC-165 positive/negative probes and the
actual ERC-721 `ownerOf` or ERC-1155 `balanceOf` at that block; non-held candidates
are omitted. Chain and block are re-read afterward. No write RPC, signing,
transaction, account access, metadata URL fetch or store update occurs.
RPC verification does not independently establish enumeration completeness.
An approved adapter must establish completeness for its actual supported coverage,
not merely echo a new nonce onto an old index or relabel a partial token list.

## Exact holding and detail DTOs

A row contains exactly `chainId,contract,tokenId,standard,balanceRaw,blockNumber,
blockHash,metadata,native,escrow,pending`. Integers remain canonical decimal
strings; blockNumber remains canonical RPC hexadecimal. No Number conversion
is used for token IDs or amounts. Only ERC-721/1155 holdings are implemented;
ERC-8415 projection support is separately probed rather than inferred from a
label. Owner/holder identities never enter the DTO.

Metadata is `{state,name,description,imageUrl}`. Unavailable means all values
are null. Available text is bounded and must be rendered as text, not HTML.
Only conservative HTTPS URLs without credentials, query strings, fragments,
IP literal/local hosts or encoded paths are admitted as data. **No image or URL
is automatically fetched.** Syntax validation is not DNS/IP safety approval;
a future proxy/fetch needs its own allowlist, redirect and DNS defenses and
explicit scope. Unavailable artwork stays a placeholder.

Native is `{state:'unavailable'|'not-applicable'}` or a ready DTO containing:
- `registerId`, `verificationProfile` (nullable if unavailable in the supported
  protocol reader), `instant`, contract-returned `finality`;
- `entry:{version,effectiveAt,supersededAt,recordCommitment,previousCommitment,
  registryReference}` from existing register-entry semantics, uint64 instants;
- `gap:{state:'none'|'unsupported'}` or open gap with `settlementId,openedAt,
  deadline,snapshotHash`;
- `settlement:{state,settlementId}` using NONE/unsupported distinction and
  existing OPEN/ADMITTED/CANCELLED/SUPERSEDED semantics. No new protocol state.
Only verified ERC-721 projection readers can produce ready native data.
Freshness, protocol finality, commercial completion and legal title remain distinct.
The DTO never resolves registryReference or treats record alignment as legal title.

Escrow is unavailable or `{state:'ready',inventoryState:'complete'|'partial',
records:[{reservationId,currency,amountBaseUnits,state,blockHash}]}`. Currency is
existing `{chainId,kind,contract,decimals}`; state is `held|released|refunded|unknown`.
Exact original financial-principal records must be independently associated with
this NFT and authenticated account, not selected by guessing an opaque nftId.
The common block must match; duplicate reservation IDs refuse. Partial ledger
coverage and unknown states are retained explicitly, not summed into zero or
spend authority. No payer, payee, holder or neighboring wallet is serialized.

Pending is unavailable or `{state:'ready',progress}`. `progress` must be the
existing authorized, durable forward-progress service projection, checked by
`validateForwardProgress`, not newly inferred from holdings or register delay.
It must match the exact NFT and its own verified user occurrence; frozen historic
DONE is preserved at its earlier verified block. Nonfrozen progress must share
this holdings block. The original service remains responsible for milestone
validation and durable freeze; the inventory reader must not invent or rebuild
that record. Its existing funds/rollback not-evaluated fields remain truthful.
V2 must not claim linked execution merely because the common decoder can inspect
a privacy-safe DTO. No linked algorithm is imported by this contract.

## Trusted detail association

Optional `detailsReader.readForPrincipal({principal,readId,asset,blockNumber,
blockHash})` supplies native/escrow/Pending. Asset includes exact
`{chainId,contract,tokenId,standard}`. Its exact output is
`{scope,readId,asset,blockNumber,blockHash,native,escrow,pending}`. All bindings are
checked before merge; data is copied and nested schemas validated. This port is
server-only; receiving a valid-shaped object is not proof of external truth.
Actual authorized native reader, original ledger mapping and existing durable
Pending service must be supplied and independently verified by the runtime owner.
No adapter leaves data as guessed, zero or empty-ready when those sources fail.
Without that detail capability, the RPC adapter returns truthful unavailable
states; it does not permanently forbid later verified ready details.

## Evidence boundary

`tests/nft-inventory-http.test.mjs` runs real local HTTP with synthetic auth and
trusted-source fixtures: ready holdings/details, disabled source, missing auth/
CSRF, strict requests, tenant/account/chain/read nonce binding, partial/stale/
unavailable, lossless integers, duplicate rows, privacy leakage, media guards,
logout and account/chain switching. `tests/nft-inventory-reader.test.mjs` verifies
the concrete adapter's synthetic read-only RPC transcript, reorg/wrong-chain
refusal, ownership, ERC-1155 quantity, detail association and unavailable behavior.
These tests are neither real RPC acceptance nor production discovery/ledger/
register evidence. Actual served SHA, runtime/store binding, approved discovery
coverage, metadata provenance and profile UI acceptance remain separately required.
