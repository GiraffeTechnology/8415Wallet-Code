# Expanded calendar-year display

PRD section 3 requires every formatted time to retain its integer instant. The formatter already preserved uint64 values outside JavaScript Date range, but fixed string offsets cut expanded ISO years incorrectly and shifted the displayed date/clock.

The formatter now separates the ISO date and time at T. Four-digit years remain unchanged; expanded years retain the sign and six digits. The Date-range guard and integer-only fallback remain unchanged, with no date coercion, truncation or protocol finality inference.

Reference: ECMAScript Date Time String Format and Expanded Years, https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-expanded-years .

Five regression cases are authored in tests/format-expanded-years.test.ts, NOT_RUN. Assigned approved Linux owner should run node --test tests/format-expanded-years.test.ts plus existing formatting/temporal/history/render/browser/full pipeline. No syntax/typecheck/test/build/CI/deployment/chain execution occurred in this initial source increment. Existing QA paths and specialist inputs are untouched. Full PRD acceptance remains OPEN.
