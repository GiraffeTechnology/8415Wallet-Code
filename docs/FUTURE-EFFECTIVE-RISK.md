# Future-effective-time risk wording

PRD section 4.6 requires factual measurements without inventing finality or policy.

The prior risk copy claimed any far-future effective time permanently ended the projection because no later entry could exceed it. Strictly increasing uint64 effective times do not imply that: a larger representable effective time can exist. The terminal representability limit is the uint64 maximum, not the UI's one-year observation threshold.

The risk surface now distinguishes future time from elapsed standing time and states the representability limit without treating a future value alone as proof of an unrecoverable state. Existing threshold, presence flags, SDK reads and authority/transaction behavior are unchanged. No finality is recomputed.

Two display regression cases are authored with a hypothetical memory-reader override; they are NOT_RUN and are not admissible-entry, EVM or public-chain evidence. Assigned Linux validation owner should run node --test tests/riskSurfaces-future.test.ts and the existing complete pipeline. No syntax, typecheck, build, test, deployment or chain execution occurred in this development increment. Full PRD acceptance remains OPEN.
