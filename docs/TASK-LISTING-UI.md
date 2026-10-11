# NFT listing authorization UI

This is an additive connection to the existing task review page, not a new
marketplace, a design replacement or production execution configuration. The
frozen server listing contract is documented in `TASK-AUTHORIZATION.md`.

## Review and authorization

The authenticated same-origin service supplies the task and the full valuation
policy. The browser independently checks the policy's exact shape, integer and
currency bounds, chain binding, sorted-key SHA-256 digest, and the version-2
reference/budget relationship. The valuation policy does not change the existing
version-1 task digest. The browser never invents a quote source, chooses an
implicit valuation time, or treats a policy/source identifier as a trusted quote.

The existing review rows display the exact NFT identifiers and task quantity,
`gt` versus `gte`, the unrounded USD minimum, `gross` versus `net`, separate
operation/total fee caps in wei, every valuation-policy field and its digest.
Gross is total order consideration before order fees; net is seller consideration
after order fees. Network fee limits remain a separate boundary. The canonical
review disclosure contains the original task policy and the full valuation
policy envelope. No task fields, token metadata or NFT descriptions are translated.
Fixed first-party text uses the existing six-language catalog and live bindings.
Changing locale does not refresh, reset consent or request a new challenge.

The same preparation request carries the displayed policy. The existing single
TOTP approval carries task, executor, observation-policy and valuation-policy
digests plus explicit `priceAt`. Preparation, authorization, continuation,
revocation and interrupted-response refresh refuse policy substitution. No
additional human confirmation is introduced for in-scope child work.

An NFT task with no complete valuation policy shows configuration required and
cannot open a new authorization challenge or submit an approval. Unsupported
`priceAt: settlement` is shown literally and is also blocked; it is never
reinterpreted as `order-review`. Existing version-1 NFT grants remain visible and
revocable without upgrade or automatic continuation of unattempted work. The
original exact-operation preparation, approval and receipt path is unchanged.
A configured policy with no execution adapter can be authorized, but the saved
grant is explicitly blocked and is never represented as executable or submitted.

## Publication, evidence and revocation

Version-2 budgets contain `seaport-order` publication references rather than
transaction hashes. The UI shows `listed-awaiting-evidence`, not a buyer, sale,
payment or completion. Missing settlement observation is explicit. Fabricated
sale receipts, fresh observations, cancellation claims or unsupported observer
configuration are refused by this version of the parser. The page does not call
the transaction receipt route for an order or poll an unavailable settlement
observer. Manual checks use the same task continuation/status route.

Revocation stops future authorized actions and does not cancel an already
published Seaport order. This distinction stays visible after revocation. An
unknown signing/publication attempt retains its operation and can be checked
read-only after revocation; the UI does not request re-signing, repricing or
republication. Order cancellation is a separate action, not part of this UI patch.

## Local evidence and limits

`tests/task-authorization-ui.test.ts` uses the actual browser modules with local
source imports, synthetic DOM nodes and a deterministic clock. Existing
exact-operation, TOTP single-flight, interrupted-response, logout/navigation,
rate-limit, receipt/reorg and cross-tab regressions remain covered. Listing tests
cover both price comparisons and proceeds bases, complete policy rendering,
missing/unsupported policy blocks, version-1 inspection/revocation, version-2
binding/downgrade negatives, order publication, revoked recovery and all six
locales. An in-process test exercises the frozen listing service through the
actual browser client with one synthetic TOTP, including a lost publication
response and read-only recovery after revocation.

This evidence does not establish real-browser pixels, genuine account or device
behavior, a trusted live price feed, signature custody, marketplace publication,
settlement observation, production deployment or independent security acceptance.
No live account, OTP, signer or transaction is used by these tests.
