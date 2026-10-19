# Finality explanations and observed entry boundaries

PRD 4.3 requires finality wording to explain the protocol boundary without
guessing an answer. This initial source increment follows PR124.

The raw reported boolean remains unchanged; entry bounds never synthesize a
replacement isFinalAsOf answer. Existing display enum values remain compatible.
Labels now qualify reported answers when the supplied observations conflict:
true before the first entry or at/after the latest, false within a known final
interval, or first effective time later than latest. Missing bounds are explicitly
unverified, not prose asserting an unknown interval as established fact.

The legacy provisional enum also carries a false answer whose coverage cannot
be established; its label/explanation explicitly avoid calling it a proven
covered provisional interval. Consumers must not discard reported/label/explanation
and infer a holder or execution authority from the enum alone.

Contradictions refer to observations, not a proven malicious contract: sequential
reads may disagree. This pure display function does not pin blocks, requery or
certify snapshot consistency. Normal known-boundary wording and unavailable
behavior remain. No legal or commercial completion claim is introduced.

Nine regression cases are AUTHORED_NOT_RUN. No compiler, syntax check, tests,
build, browser or chain execution was performed here. Exact-candidate
verification includes temporal/finality rendering callers.
Deployment parameters, providers and signers are untouched.
