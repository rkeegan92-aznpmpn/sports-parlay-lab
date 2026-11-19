# Automatic selection safety and historical estimates

This update extends existing PR #10 and preserves the merged independent FanDuel integration. The owner reports **24 matched events and 430 side prices**. That private cached board is not available in this implementation workspace, so these counts are owner-reported, not newly fetched or independently replayed here. No FanDuel or Odds API requests were made for live prices during this work.

## Changes

- A shared injury/status rule now excludes **Questionable, Doubtful, Out, Inactive**, injured reserve, suspension, PUP/NFI and practice squad. Explicit verified **Active** roster status is required for real-source automatic selection; roster membership alone or an absent status no longer qualifies. Existing saved tickets remain archives and are not rewritten or removed.
- Independent FanDuel selections additionally require a verified current ESPN injury snapshot covering the matched team, no older than 24 hours. Missing, stale, wrong-team or unavailable coverage blocks automatic selection. An unrecognized listed injury designation remains unverified. The snapshot and check times are carried with each selection. An active player absent from a covered injury list is described as **not reported**, never guaranteed healthy or confirmed to play.
- Current team, opponent, event and kickoff checks remain mandatory. Existing PR #10's event-specific grouped rejections are preserved. Duplicate detection now compares all known player IDs and normalized names/team aliases, including a missing/different primary ESPN ID with a shared historical ID. Builder deduplication follows the same rule.
- FanDuel estimates are recomputed from **unique verified game results for that player's exact market and line**, dated before both prediction time and kickoff. Wrong player IDs, missing/future dates, duplicate or unproved games and nonfinite values cannot support an estimate. Untrusted aggregate hit counts are replaced by the actual result-derived counts. The existing independent-of-price Beta(2,2) smoothing formula is unchanged for consistent verified histories: `(hits + 2) / (decisive games + 4)`.
- Pushes are excluded from decisive hit-rate samples for both integer count and yardage lines. All-push or insufficient samples do not generate automatic picks. Cards show the raw hit sample and a Wilson 95% **historical hit-rate sampling interval**, explicitly distinct from calibrated prediction confidence. All probability, EV and joint estimates remain uncalibrated research; no validation threshold is reduced, and no historical accuracy is invented.
- Both aggressive options retain exactly **1 QB, 2 RB, 2 WR, 1 TE**, unique players and maximum three legs per game. Distinctness compares actual player/event/market/side/line selections rather than provider quote-row IDs. If a second qualifying combination is unavailable, the app reports that gap rather than padding a ticket.

## Credit and record preservation

No changes to `fanduelRest.ts`, authenticated endpoints, secret loading, pagination, cache lifetime, request coalescing, cooldowns or refresh policy. Generate from the existing cache spends no additional odds-provider requests. Test-only injury fixtures are isolated under tests and never imported by production code. No database schema or environment-file migration; Saved Tickets and forecast records remain intact.

Use the existing **Generate Two Aggressive Options from cache** control after applying the reviewed PR. It rechecks current dates, player availability, history and price freshness without requesting another paid odds board. Expired prices still need a genuinely fresh board; they are not relabeled current. No FanDuel login or wager placement is involved.

## Verification executed

| Check | Result |
| --- | --- |
| `npm test` | **PASS: 152 application tests + 1 startup test, zero failures.** New coverage exercises adverse and unknown roster/injury statuses, stale/missing/team-uncovered injury reports, date/identity/duplicate history integrity, actual-value-derived estimates, market-price independence, historical sampling intervals, integer yardage pushes and mixed-ID duplicate players. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `npm run test:e2e` | PASS: all three production HTTP/browser workflows using explicitly isolated external-provider fixtures. Existing manual/save/restart, automatic grading, and independent FanDuel authenticated-request contract, two distinct structured aggressive options, TEST MODE, delay labels, persistence, provider/quota error handling and phone/tablet layouts. These are not proof of the owner's live cached selections. |
| `NODE_OPTIONS=--use-env-proxy npm run test:e2e:live-free` | PASS with real free providers: 43 upcoming games, 31 matched roster choices, settlement-only collector; zero odds inputs or priced live tickets claimed. The proxy option is specific to this implementation environment. |
| `git diff --check` | PASS. |

An existing positive ESPN-fallback test lacked any active status. It now supplies an explicit active-status fixture for its positive case; separate missing-status tests verify exclusion. This fixes the test's premise rather than restoring the unsafe production behavior.

## Remaining limits

The private 24-event/430-price board and its current eligible position distribution cannot be verified from this workspace. A price count does not establish verified player availability, sufficient decisive history, positive estimated EV or two qualifying combinations. Current upstream injury/roster gaps or missing alternatives may correctly leave one or both tickets blocked. The source injury snapshot is not a final game-day inactive list; new injury news can change eligibility. Historical/model estimates and assumed parlay correlations are not calibrated predictive performance or guaranteed profit. Existing real-money validation gates, TEST MODE safeguards and manual-entry provenance remain in force.
