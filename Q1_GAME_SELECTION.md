# Q1 game selection and event matching repair

## Verified causes

On merged main `87d67a4`, Q1 game choices came only from successful analysis responses, were narrowed to the selected slate/game, and were cleared on a scope change. A failure or zero-result analysis could therefore remove all individual choices. The interface also retained Sunday-only wording after choosing all games.

The provider matcher required exact full-team spellings, a spaced ` @ ` separator and string IDs. Numeric IDs, casing/punctuation/abbreviation variants and `Away at Home` names could reject valid events. Match counts were also derived from valid side prices, conflating a known game with a missing or rejected quote.

## Changes

- Load a free, verified NFL schedule catalog independently of odds, historical/player eligibility, provider verification and analysis success. Missing, malformed or legacy odds cache does not hide a valid free schedule. The selector is present before fetching odds and remains after provider failures.
- Default Q1 to **All upcoming games**, including Thursday, Saturday, Sunday and Monday games when actually scheduled in the existing verified 21-day window. Keep Sunday-only as an explicit scope. Scope messaging follows the selected value; the full-game panel now also describes its own all/Sunday scope correctly.
- A selected individual game controls cached analysis, explicit refresh and both Q1 ticket options. It overrides a leftover Sunday date constraint. The full catalog is not replaced by a single-game result. Unknown choices produce no substitute picks; a game removed from the verified schedule requires a new selection.
- Normalize exact known NFL full names, unambiguous city/nickname aliases, punctuation, casing and abbreviations. Parse `@`/`at` orientation. Normalize safe numeric provider IDs for internal feed joins. Do not fuzzy-match unknown teams or guess reversed `vs` orientation.
- Use exact NFL IDs or explicitly namespaced ESPN IDs where available, with verified UTC kickoffs and checks against any supplied teams. A bare provider number is never assumed to be an ESPN ID. Conflicting duplicates, mismatched explicit IDs, ambiguous schedules and unknown names remain rejected.
- Preserve the existing **60-second maximum kickoff tolerance**, explicit-timezone parsing, verified pregame cutoff and <=30-minute price/source freshness. Never roll a past cached event into a future week or substitute full-game markets for Q1.
- Separate event-match counts from valid-price counts. Show reached/invalid/future kickoff row counts and per-event normalized IDs/teams/UTC times/method/rejection reason.
- A latest provider failure still blocks regular generation. Cached research remains explicitly stale and non-actionable; API-fresh/eligible counts stay zero even if individual timestamp metadata passes. Catalog reload and preview never retry paid odds.
- Optional Odds API Q1 selection uses NFL Eastern dates (including Sunday-night UTC rollover) and maps canonical game selection to its provider schedule when explicitly used. No new paid request or fallback is introduced.

## Verification

Node 22, repository root:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Final results: **208 tests passed, zero failures; TypeScript passed; production build passed; all seven production browser workflows passed.** External provider traffic in browser tests was intercepted using explicitly isolated synthetic contracts, not live sportsbook verification.

New unit/integration tests cover weekday catalogs without odds or with corrupt cache, string/numeric/namespaced IDs, normalized names, UTC offsets, unchanged tolerance, ambiguous/conflicting records, selected-game generation, Eastern Sunday boundaries, stale data and provider failure. A synthetic regression recreates **148 rows = 140 genuinely reached kickoffs + 8 future-unmatched records**, keeping those causes separate rather than fabricating new dates.

Production browser coverage checks catalog choices before any odds acquisition, Phoenix Thursday/Saturday/Sunday/Monday labels, all/Sunday toggling, isolated selected-game ticket generation, provider-failed stale previews, selector reload after failure, invalid game IDs, phone/tablet layout, no added paid requests or ticket/forecast writes. Existing six-pick, explorer, saved-ticket, grading, comparison and Q1 workflows remain in the suite.

Screenshots are explicitly labeled synthetic fixtures, not live coverage:

- [Tablet](docs/screenshots/q1-game-selector-tablet.png)
- [Phone](docs/screenshots/q1-game-selector-phone.png)

## External limits

This workspace cannot inspect the private Codespace SQLite board or credential. Its exact 140/8 records are not claimed verified. If the recorded kickoff has genuinely passed, or current markets/history/injury evidence are missing, those props remain ineligible. Restored game choices do not imply provider Q1 coverage or current prices. No keys, existing records, database paths or PWA configuration were changed, and no real paid odds calls were made during verification.
