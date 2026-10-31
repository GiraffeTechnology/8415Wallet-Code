# Optional trading observation reporting

PRD section 5 Trading calls for a joint explanation that distinguishes a stale configured feed from ordinary registration delay. The optional watchtower panel now reports a combined interpretation from its existing sequential projection and current-feed observations.

- A resolved agreeing projection with raw final=true and current fresh feed is described as projection-final/feed-fresh, not a completed trade.
- A resolved agreeing projection with raw final=false and current fresh feed remains provisional; no promise is made about the next admission.
- A stale feed is explicitly not current, independently of the projection status.
- Missing, unknown, uncovered or inconsistent observations do not become an optimistic combined conclusion.

No feed/register pairing is verified, no predecessor inherits trust, no past feed freshness is inferred, and contest remains separately rendered. Current freshness does not establish temporal finality. The report grants no transaction, release/refund, financial settlement or legal entitlement. No source/provider/authentication/transaction configuration changes.

Six regression cases are authored in tests/trading-observation.test.mjs, NOT_RUN. Focused regression command: node --test tests/trading-observation.test.mjs (not automatically added to the existing npm test list). Existing watchtower and browser/package checks remain necessary. No test/build/deployment/chain execution is claimed here. Technical source observations retain English as existing raw SDK output; this does not claim full localized native prose or whole-stage acceptance.
