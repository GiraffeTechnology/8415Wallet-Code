# Trading observation fixed-message localization

The PRD's six-language presentation requirement now covers all four joint projection/feed interpretations and their safety caveat. English remains the default, with zh-Hans, zh-Hant, French, Spanish and Japanese fixed first-party text.

Only internal interpretation keys select these messages. Original contract/feed identities, raw protocol output, imported declarations, signed terms and other observations remain exact. The panel keeps raw projection/contest/freshness detail separate. Language changes repaint messages without provider reads or changes to authentication, transaction authority or policy.

Clear, error, logout, selection invalidation and lifecycle paths remove the localized observation bindings so later language changes cannot revive a cleared result. This is presentation work, not a new source binding or a claim of current feed trust.

Three regression cases authored in tests/trading-observation-i18n.test.mjs are NOT_RUN; focused regression command: node --test tests/trading-observation-i18n.test.mjs. This mjs is not automatically added to the existing npm list. Existing watchtower, locale, browser and packaging checks remain required. No syntax/typecheck/test/build/CI/deployment or chain validation occurred in this development increment. Full PRD acceptance remains OPEN.
