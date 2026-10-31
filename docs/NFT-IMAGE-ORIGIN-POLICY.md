# NFT image-origin capability (V2 and V3)

Default: no external image origin is enabled. Missing metadata and an image origin
not enabled by this installation are distinct UI states. No source metadata,
account, agent, URL query or inventory response can enable an origin.

An authorized operator may add `imageOrigins` to the existing verified release
configuration (`--config` for the DApp builder). The value is an array of at most
16 unique canonical HTTPS origins: no wildcard, path, query, fragment, credentials,
non-default port, numeric IP literal or local/internal hostname. The unchanged
public/default release inputs omit this field. This change does not authorize an
operator action or approve any particular external service.

The builder and offline installer validate the release input and update only the `img-src` directive
in staged HTML. The installer hashes the transformed entry in its receipt and verifies CSP/config agreement on readback. It adds exact approved origins alongside existing self/blob
images; script, style and connect directives are unchanged. The browser uses the
same verified release profile for its allowlist. A reverse proxy serving stricter
CSP must use the same reviewed exact image-origin list; this code does not edit a
deployed proxy. The loopback development server uses its existing local
`web/release-config.json`, validates the same schema, and emits matching header
and HTML policy. No credentials or secret configuration are involved.

Even for an enabled origin, the user must explicitly load each image. The button
discloses that the host receives the user's IP. Requests use anonymous CORS and
no referrer; same-wallet-origin metadata URLs, query strings and fragments are
refused. The approved image host must support anonymous CORS, serve the image
without authentication and not redirect to another origin. CSP blocks an
unapproved external redirect. Source metadata is rendered as text, never HTML.
Failures show unavailable rather than replacement artwork. Logout, chain/account
change, navigation, expiry and redraw remove the image source. No image load is
evidence of asset ownership, registry finality or complete inventory.

Evidence is synthetic DOM and pure policy-generation tests, not a live browser
network acceptance. No real image host has been approved/configured or fetched.
