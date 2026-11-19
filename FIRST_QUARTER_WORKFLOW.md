# Issue #11 — First Quarter Parlays

The default page now has a prominent, tablet-friendly **First Quarter Parlays** section with **Best 1Q Triple** and **Aggressive 1Q Triple**. Both are three-leg research tickets, separate from the existing six-pick generator. One NFL game is sufficient; no six-leg position composition or multi-game rule is imposed. The second ticket must contain different selections, rather than repeat the first under a different label.

## Using the section

- **Generate 1Q Tickets from cache** reads the existing independent FanDuel board using the server-side `FANDUEL_API_KEY`. It makes no odds-provider request. Page loads check local configuration/cache status only.
- Only actual rows with `period=q1`, supported passing/rushing/receiving-yard stats, open markets, valid side prices and exact verified event/team/kickoff matches can qualify. Full-game, second-quarter, unsupported and ambiguous rows cannot become Q1 quotes. The full-game mapper retains its default period and continues ignoring quarter prices.
- **Fetch shared FanDuel board for Q1** is explicit opt-in and uses the existing `refreshBoard` implementation, five-minute cache, credential scope, request coalescing and cooldowns. It neither bypasses the TTL nor changes pagination, credentials or provider request policy.
- If the current provider snapshot contains no supported verified Q1 markets, the section clearly reports **provider unsupported/unavailable** and leaves both ticket cards empty. It never substitutes full-game prices or automatically calls a different paid provider.
- The expandable **Optional Odds API Q1 access** retains the existing `ODDS_API_KEY` flow. It runs only after an explicit action and clearly states that separate credits may be used. The older button in the optional Live API workspace explicitly selects that provider so its event IDs remain consistent.

## Verification and research safeguards

Each selected player must have a unique current roster/team/position match, explicit Active status and current verified team injury coverage. Questionable, Doubtful, Out, Inactive and other unavailable or unknown statuses are excluded. An injury-list absence is never represented as guaranteed health or final game-day participation.

Quote freshness and upcoming kickoff are checked before candidate construction and again at ticket generation, including time spent awaiting historical sources. The display marks a previously generated snapshot stale when its quotes expire or kickoff arrives. No stale data is relabeled live. Original observation timestamps, source as-of time and reported delay are displayed; the independent provider's free tier may be delayed five minutes.

Historical Q1 values come only from verified first-quarter play-by-play splits, anchored to dated player games before prediction time. Full-game statistics provide identity/date anchors, **not replacement Q1 yardage or quarter averages**. Ambiguous historical player IDs cannot provide Q1 projections. Free play-by-play downloads reuse the existing provider cache (current-season refresh interval, historical cache for older seasons).

The existing Best 1Q logic can disclose a price-implied estimate when verified Q1 history is unavailable; this is explicitly not an independent statistical edge. Aggressive 1Q continues requiring at least four supported Q1 historical games and its existing price/probability support. Missing history, availability, prices or distinct alternatives blocks the affected option without invented picks. All estimates are uncalibrated research. Theoretical product pricing and independent combined probabilities are not accepted sportsbook parlay quotes, calibrated recommendations or guarantees. No wagers are placed.

## Executed checks

| Command | Result |
| --- | --- |
| `npm test` | PASS: 157 application tests plus one startup test, zero failures. Added regressions cover two distinct single-game triples, strict period separation, unavailable/stale/mismatched quotes, injury/roster exclusions, missing Q1 splits, future/unknown history and free PBP cache reuse. Existing three-player tests now assert that a sole eligible combination is not duplicated as two tickets. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `npm run test:e2e` | PASS: all four production HTTP/browser workflows with explicitly isolated external-provider fixtures. Existing manual/six-pick generation, saving/reload/restart, grading and independent FanDuel workflows remain passing. New Q1 workflow verifies prominent default-page cards, two distinct three-leg single-game tickets, exact Q1 lines/history, availability, unsupported-state UI, cache reuse with zero additional odds requests, no automatic paid fallback, explicit optional Odds API flow and 800×1280 tablet/412×915 phone layouts. |
| `git diff --check` | PASS. |

Q1 fixtures use synthetic credentials and a temporary SQLite database; they are not production odds or proof of current live provider coverage. No live paid odds requests, account changes, environment-file modifications, database migrations or archive/forecast rewrites were made for this feature. Q1 analysis itself creates no saved-ticket or calibration records.

Live Q1 availability depends on the provider's actual current rows/entitlements, current injury/roster coverage and available free play-by-play history. These limits are shown by the UI and API. Unavailable markets are not bypassed. No additional FanDuel login or required new paid API subscription is introduced.
