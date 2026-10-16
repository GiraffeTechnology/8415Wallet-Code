# Read-only panel fixed-label localization

Trace: full Wallet interface localization requirement and Stage 5 watchtower/Kit DApp integration. The two new panels use the existing i18n presentation/paint bindings and the existing six-choice selector. A separate immutable catalog supplies English, Simplified Chinese, Traditional Chinese, French, Spanish and Japanese fixed headings, help, input labels, buttons and status disclosures. English remains the default and unknown locale IDs fall back to it.

This increment does not translate raw observation objects, addresses, hashes, protocol enums, token metadata, transaction fields or signed terms. Existing SDK-rendered technical observations remain original source text; full native-renderer prose localization is not newly claimed. Catalog wording is first-party presentation, never imported configuration or provider text.

Language switching only repaints retained text. The shared mechanism does not initiate provider/API reads, reauthentication, navigation, transactions, consent resets or new storage. Input labels bind a separate span so repainting cannot delete or reconstruct their input controls. Dynamic status messages use paint and are unbound with paint on lifecycle clear, preventing a later locale change from restoring a cleared message. Input values and the existing request/lifecycle guards are unchanged.

Authored regression source: tests/readonly-panel-i18n.test.mjs (NOT_RUN). Proposed existing authorized Linux validation command: node --test tests/readonly-panel-i18n.test.mjs. It is not automatically in the current npm test list. Bear retains execution, exact-head CI and merge ownership. Six-language DOM rendering, input identity preservation, clear/locale-switch after logout, late-result invalidation and package closure remain required actual validation; no syntax/test/build/provider/browser command was executed here.

This is a bounded presentation increment, not full-product acceptance. It changes no frozen PR102 runner, authentication/P0 logic, signer, protocol, runtime configuration or deployment parameter.
