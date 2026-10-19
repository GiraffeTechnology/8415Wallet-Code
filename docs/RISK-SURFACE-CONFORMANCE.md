# Risk-surface conformance and capability boundaries

PRD sections 4.6 and 6.1 require projection conformance before presenting projection data and independent settlement discovery.

The risk builder previously detected conformance but continued into projection reads even when projection support was false. Missing advertised settlement adapter methods could also become a zero gap, an unidentified profile or an undefined authority report. The builder now requires projection conformance before those data reads and refuses missing required advertised capabilities as TransportError. Authority capability is needed only when an account is queried.

A projection-only contract no longer triggers settlement history reads; its risk view states that the settlement interface is not advertised rather than saying no gap is open. Existing no-account and no-log disclosures remain. No entitlement, policy, finality, login, signer or transaction authority is introduced.

Seven regression cases are authored, NOT_RUN. Focused regression command: node --test tests/riskSurfaces-conformance.test.ts, followed by existing risk/holder/full pipeline checks. Source inspection is not runtime reproduction. No syntax/typecheck/tests/build/CI/deployment/chain execution occurred here. Complete product acceptance remains OPEN.
