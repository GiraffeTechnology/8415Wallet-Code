# Registration lag is not a transfer authorization

Initial implementation of the PRD 4.7/4.8 and 9.3 disclosure boundary, following PR125.

Registration lag alone must not invent a registrar transfer lock. That does not
mean every token can always transfer: independent controls, exact leg acceptance
and active inherited obligations still govern protected forwarding.

Registration meaning now scopes its no-lock statement to lag itself. Existing
state selection, further-hop signals, authority reads and transaction paths are
unchanged. In-flight action copy does not grant a transfer; agreement likewise
does not certify independent conditions. A deadline that has not passed is
reported as a time fact, not a verdict that nothing is wrong with a trade.

Acquisition copy distinguishes a non-gating disclosure from an execution approval
and explicitly states that connection, notification and payment approval do not
prove enforceable protected receipt. This module does not itself validate a
linked leg, take funds, sign, broadcast or replace the independent control.

Seven regression cases are AUTHORED_NOT_RUN. Existing holderViews expectations
for lag-not-blocked, Wait/nothing-to-fix and trade-term boundaries are preserved
with narrower scope; that source review is not a test run. Exact-candidate validation includes holderViews and renderers. No syntax/typecheck, tests, build, UI or chain execution here.
No deployment parameter, credential or signing interface changed.
