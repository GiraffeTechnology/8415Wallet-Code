# Admitted-history boundary invariants

PRD stage 3 requires append-only admission history and truthful invariant diagnostics. The prior link walk checked consecutive versions only after the first entry and checked interval closure only when a successor existed. Thus a first version other than one or a latest entry with a nonzero supersededAt could evade the corresponding boundary diagnosis.

The walk now checks first version == 1 and latest supersededAt == 0, including a single-entry history. It retains the received values and reports faults instead of correcting, dropping or recomputing them. No holder, finality, completed commercial action, chain snapshot or legal-right conclusion is derived.

Four regression cases are authored in tests/history-boundaries.test.ts, NOT_RUN. Focused regression command: node --test tests/history-boundaries.test.ts plus existing history and full pipeline regressions. These intentionally inconsistent memory-reader fixtures are not accepted contract state or real-chain evidence. No syntax/typecheck/test/build/CI/deployment/chain execution or merge is performed by this development batch. Full PRD acceptance remains OPEN.
