# 8415wallet platform and tenant domains

## Product identity

The product is **8415wallet**. **8415wallet.com** is its UI platform domain.
The product version, tenant and hosting origin are separate configuration facts.
V2 and V3 packages have distinct release profiles; the V3 PRD scope identifies
its additional linked features.

Platform and tenant UI can share reviewed code while keeping configured origins
and operation journals separate.

## Required deployment input

Obtain the exact approved HTTPS URL, including hostname, allocated web port and
entry path, for each target before deployment. Store it in the release/deployment
configuration and use it verbatim in links, redirects, acceptance records and
bookmarks. Do not construct a link from a bare hostname.

Respect the target environment's configured port reservations and existing services.
A deployment needs an explicit web-listener allocation; missing allocation blocks
deployment, not construction of an unconfigured Beta package.


Distinguish a public TLS endpoint from the upstream server listener. An externally
managed TLS front door and its upstream can use different configured ports. Record
the boundaries independently and respect each host's port reservations.

The web origin is the complete scheme, hostname and port. Changing any one
creates a different IndexedDB security boundary. A new hostname, alternate
port, temporary hostname or `www` alias does not inherit outstanding journals.
Resolve the final origin before real wallet use. If an origin already has
unresolved transactions, preserve it for reconciliation and plan the change
explicitly; never erase storage or infer that an empty new journal means no
outstanding transaction exists.

## DNS and certificates

- Use an approved explicit DNS record for each platform or tenant hostname.
  No wildcard tenant allocation or self-service provisioning is implied.
- Publish IPv6 only when the service listens correctly on the confirmed IPv6
  web endpoint. A broken AAAA record can strand mobile clients.
- Serve a publicly trusted certificate valid for the actual hostname; never
  bypass a browser certificate warning.
- Use a certificate-validation method compatible with the configured listeners
  and port reservations. HTTP-01 uses port 80; TLS-ALPN-01 requires port 443.
- An HTTP redirect must target the exact full configured HTTPS URL/port,
  preserving the requested path only within that origin. Omitting a non-default
  HTTPS port redirects to port 443 instead.
- Keep the wallet service isolated from unrelated SSH and network services.

## Isolation and service policy

Serve only the reviewed static DApp and its public release configuration on a
wallet origin. Do not share that origin with an admin console, upload endpoint,
analytics, unrelated site or signer. Staging uses an explicitly separate origin.
The host has no private key, wallet seed, custody service or RPC proxy.

The browser's public configuration must contain no credential, private RPC
endpoint, raw signature or secret. Any contract address/runtime hash in a
public deployment file identifies the exact authorized testnet deployment.
These are pins to verify, never proof of an audit or authority to transact.

Serve JavaScript modules with a JavaScript MIME type. Supply `frame-ancestors
'none'` in an HTTP CSP header in addition to the page's existing CSP. See
[Static deployment requirements](SIN-STATIC-DEPLOYMENT-REQUIREMENTS.md) and
[the versioned Beta handoff](../BETA-DAPP-DELIVERY.md).

## Historical observations

An earlier 2026-10-03 report described DNS delegation, an apex and tenant A record, and a
62-file tenant bundle served on the then-default HTTPS port. Those observations
belong to that historical source and configuration. They do not establish
current online status, the correctness of a reserved-port deployment, or
acceptance of the new V2/V3 artifacts. Recheck the actual configured endpoint
and record its current certificate, response headers and served hashes.
