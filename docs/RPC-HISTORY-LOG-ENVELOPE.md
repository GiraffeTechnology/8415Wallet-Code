# RPC history log envelope refusal

PRD stage 3 history must distinguish unavailable or malformed provider data from genuine events.

Source inspection found that missing blockNumber/logIndex were silently replaced with zero and missing data with empty bytes. This could manufacture an event coordinate or payload. The RPC reader now refuses incomplete/malformed log envelopes, wrong-contract results, removed logs and results outside the requested window as TransportError. An invalid result fails the entire read instead of returning an accumulated prefix.

Valid zero indices and empty data remain valid. Address matching is case-insensitive; topic words, byte data and hexadecimal quantities are checked without manufacturing defaults. Topics are copied. No new block-hash provenance, snapshot atomicity, provider honesty or reorg-proof history is claimed. Existing current-state instant reads and the specialized Hoodi adapter are unchanged.

Eleven authored regression cases in tests/rpcReader-log-envelope.test.ts are NOT_RUN. Syntax/typecheck/tests/build/CI/deployment/chain validation remain with the assigned execution owner. Suggested approved Linux focused command: node --test tests/rpcReader-log-envelope.test.ts. Existing history/ownership-history/full pipeline must also be checked by that owner. No completed stage or product acceptance is inferred.
