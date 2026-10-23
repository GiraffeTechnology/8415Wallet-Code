# Read-only task activity and recovery cockpit

Initial development. This adds a consumer entry beside the existing task authorization form, not a replacement for its authorization, continuation or recovery writer.

## User journey

1. Open the existing Tasks page with a server-authenticated wallet session.
2. Expand "Task activity and recovery overview (read only)" and explicitly read the first page.
3. Filter that page by effective status, advance one bounded page, or read a selected task's saved detail.
4. If a child outcome is unknown, reconcile its existing transaction/order through the responsible operator before any retry. The cockpit has no retry, resend, observe, grant or resume control. Use the existing authorization form for its separately reviewed human actions.

Each list request returns at most 50 entries. Cursor and revision remain canonical decimal strings. Revision drift, repeated cursor, duplicate task digest, malformed/oversized response and existing decoder refusal clear the display. Page filters/counts are explicitly page-local, not whole-account totals.

## Security and evidence boundaries

The only request paths are tasks/list and tasks/status through the existing authenticated AccountAuthClient. The existing TaskAuthorizationClient validates the context and task contracts before a whitelist projection is displayed. Login capture/assert/check brackets reads and publication. Logout, account/session changes, navigation away, page hide and hidden document invalidate pending work and erase in-memory results. No timer, background polling, local persistence or new authority is created.

The projection excludes authorization references, raw grants, OTP and arbitrary backend fields. UI renders textContent only and exposes no raw error details. Noncancelled fee ceilings, including unknown outcomes, remain allocated; this is neither actual gas expenditure nor an asset balance. Saved completion/listing state is expressly not a fresh chain observation, settlement proof or finality. An order-reference presence flag is not a sale receipt.

Existing authorization/producer/receipt/lease modules are not changed. No signing, authorization, preparation, resume, execution, cancellation, revoke, observation or broadcast route is invoked by this component. Reading does not itself select or resume a task in the existing writer.

## Delivery status and independent verification

Source-only initial development, stacked on PR97. Eight regression cases are authored, NOT_RUN. No tests, typecheck, build, browser run, CI inspection, deployment or chain read was performed by the developer.

Review should include served-module packaging, real authenticated tenant/origin/account/chain boundaries, session expiry/revocation during each await, late response suppression, cursor revision conflict, page-local filtering and text-only rendering. Authored decoder-injection tests exercise consumer boundaries, not the real server/client, provider or browser. No full-product acceptance is claimed.
