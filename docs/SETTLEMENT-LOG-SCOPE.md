# Settlement log scope

Initial Stage 3 / W-16 implementation following PR126.

A reader's filter argument is not proof that its returned logs obey that filter.
The settlement-history builder captures this invocation's contract and requires
every returned log to match that contract, the requested event and token before
folding episodes. Unknown or out-of-scope events reject the read, rather than
silently produce successful empty, partial or cross-token history.

Optional settlement-record read failure still leaves the original log-derived
episode with unknown openedAt. A successfully returned wrong-token record,
NONE status or unknown status is instead an invariant failure, outside that
fallback catch; it must not replace this token's history.

The available note now discloses retention/omitted-log coverage and fallback.
This is not a canonical block-hash proof, a completeness certificate, an atomic
snapshot or independent chain evidence. Existing episode closure semantics,
identity/session wrapper boundaries and no-log unavailable behavior remain.

Eight regression cases are AUTHORED_NOT_RUN. No syntax/typecheck, unit tests,
build, provider, UI or chain execution was performed here. Exact-SHA validation includes settlement
history, temporal/audit exporters and existing reader fixtures. No credential, signer, deployment parameter or transaction path changed.
