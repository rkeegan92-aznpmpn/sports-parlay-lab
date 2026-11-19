# Automatic grading and historical backtest verification

Branch `feat/automatic-grading-historical-backtests`, based on merged main/PR #5 at `a442c64`. Existing application, free/manual odds entry, live integration, saved selections, forecasts, secrets and validation thresholds are preserved. See [GRADING_RULES.md](GRADING_RULES.md) for exact outcome/void/price rules and causal-data assumptions.

## Implemented behavior

- Generated research tickets expose Pending status. Saving atomically stores the immutable six selections and their pending grading record. Save failure rolls back both records; grading/backtesting never creates duplicate saved tickets.
- The background collector evaluates eligible legs independently. An early verified loss marks the ticket Loss while `finalized: false` keeps its remaining games under observation. Once all six legs resolve, it finalizes wins/losses, neutralizes pushes/verified voids, or marks all-neutral tickets Void. Missing/unavailable/postponed/incomplete results remain Pending, not losses.
- Actual statistic, market, line, outcome, source and result game ID are retained per graded leg. Explicit final DNP evidence is required for Void; contradictory DNP/stat evidence stays Pending. DNP records never become calibration losses. A source outage does not erase an earlier verified result; collector health reports retrieval failures.
- Original tickets/forecasts are never rewritten. New `saved_grade_events` retains grading state changes; idempotent checks do not add duplicate state events. New finalized metadata permits legacy unverified grades to be rechecked rather than silently promoted.
- The four dashboard sections are Upcoming Picks — Pending, Completed Picks — Graded, Historical Backtests — Simulated Results, and Prediction Accuracy — Verified Statistics. Early losses identify unresolved remaining legs. Verified accuracy deduplicates decisive contracts across the latest 200 saved tickets, displays its denominator, excludes missing/push/void outcomes, and does not mix in backtests. Existing full archive/pagination remains available.
- Historical simulations are persisted only in `historical_backtests`, never upcoming/manual/forecast tables. BACKTEST freezes training and selection before target evaluation. Weekly prediction cutoff is one hour before the earliest game; prior stats require a 24-hour post-kickoff availability assumption. Future slates are excluded. Position/game/unique-player constraints remain 1 QB, 2 RB, 2 WR, 1 TE and at most three from a game.
- Existing verified pregame contracts with final-result identity/kickoff provenance may supply historical line/individual prices if known by the cutoff. Otherwise lines are explicitly model-derived yardage benchmarks and odds are null. Historical Aggressive ranks lower estimated probability; higher payout is unknown without prices. Ticket payout/ROI/EV remain unavailable without combined historical quotes. Captured-forecast validation is unchanged and separate.

## Automated checks

Repository root, Node 22:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run verify:evaluation
```

The managed runner used `PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH` (Node `v22.23.4`). For real outbound networking only, it used `NODE_OPTIONS=--use-env-proxy`; normal Codespaces networking generally does not need that option.

| Check | Result / evidence |
|---|---|
| Full unit/integration regression | **134 passed, 0 failed** |
| TypeScript | `tsc --noEmit` passed |
| Production compilation | `next build` passed |
| Market/result cases | Win, Loss, Push, explicit DNP Void, all-neutral Void, zero recorded statistics, missing player/market, wrong season, conflicting participation, postponed/non-final games and invalid capture covered |
| Multi-game timing | First game can lose while later game awaits kickoff; early loss remains non-final, survives provider outage, and finalizes later without ticket duplication |
| Causal feature tests | Mutating target/future boxscores leaves predictions unchanged; a poisoned future-stat getter cannot be read during training; all training-availability times precede cutoff; post-cutoff odds are ignored |
| Record preservation | Saved selection JSON stays byte-identical during repeated grading; backtest reruns use separate cache and never insert upcoming tickets/calibration samples; failed atomic save leaves no half-ticket |
| Production manual/dashboard E2E | Real forms and HTTP matching/generation/storage; two saved Pending tickets; historical BACKTEST results and cached rerun; reload/restart persistence and provider-failure handling; 412px phone/800px tablet |
| Production automatic-grader E2E | Supervised settlement-only collector fetches final fixture data, writes win/loss/actuals, keeps missing/future tickets Pending, displays pending/completed sections; saved JSON unchanged |
| Real completed-game verification | See below; free network data, **zero paid requests**, isolated memory DB |

External providers and seeded contracts in deterministic E2E are explicitly isolated fixtures, not genuine FanDuel prices. Ticket/storage/grading/history routes are real production routes. Browser tests require the pinned Playwright requirements and Chromium already documented in [MISSION_READINESS.md](MISSION_READINESS.md); CI runs both workflows after build.

The real verification command uses current real completed nflverse statistics/schedule and the same collection cycle/grader. It does not access the configured app DB or a private Codespace. It stores counterfactual BACKTEST benchmark contracts in memory solely to exercise final-result matching; it does not claim authentic historical FanDuel odds, real pregame forecast capture or sportsbook settlement.

Observed 2026 real-data run:

- Eight BACKTEST tickets, 48 unique contracts; 42 decisive outcomes, **17 wins (40.5%)**, six missing/pending legs.
- Five finalized tickets: **0 wins**, three tickets still unresolved. These are benchmark-strategy results, not live FanDuel betting performance.
- Zero priced legs; leg ROI and combined ticket payout/ROI/EV unavailable.
- An isolated six-leg grading probe matched real final player/game IDs and actual statistics: Aaron Rodgers 253 passing yards (`2026_06_PIT_TB`), Ameer Abdullah 0 rushing yards (`2026_06_HOU_JAX`), Derrick Henry 58 rushing yards (`2026_06_BAL_CLE`), Davante Adams 39 receiving yards (`2026_06_ARI_LA`), Mike Evans 94 receiving yards (`2026_06_WAS_SF`), Hunter Henry 48 receiving yards (`2026_06_NYJ_NE`). The correctly evaluated benchmark ticket lost; it was not transformed into a win or hidden from results.
- Repeated collection/grading left the probe's saved selections unchanged and created zero calibration forecasts. Real-source metrics may change with official source revisions.

## Launch and verify automatic future grading

Keep the existing private environment file, API key and persistent `DB_PATH`; do not reset or replace SQLite.

```sh
git fetch origin
git switch feat/automatic-grading-historical-backtests
npm ci
COLLECTOR_MODE=settle-only npm run dev
```

Open the Codespaces port-3000 preview. Generate Best Six/Aggressive Six from supported upcoming free/manual input and **save** them before kickoff. They appear Pending. Check `/api/health` for an active settlement-only collector. No paid odds credits are required.

The collector checks approximately every 15 minutes while the app/Codespace runs. Explicit matched ESPN final data can settle eligible legs after the game finishes; nflverse score-based finality retains the six-hour post-kickoff check window. It does not wait for all games in the ticket before showing individual results. The dashboard polls stored results every 15 seconds. Inspect `/api/grades` or `/api/evaluation` for `status`, `finalized`, per-leg `actual`/source/reason and theoretical neutral-leg adjustments.

If a separate worker is desired, stop the supervised worker cleanly and run:

```sh
npm run track:forecasts -- --watch --settle-only
```

Do not bypass the collector lease or start duplicate workers. A one-shot `npm run track:forecasts -- --settle-only` is available only when another worker does not own that database. A stopped Codespace does not process outcomes.

For production: `npm run build`, then `COLLECTOR_MODE=settle-only npm start`.

For historical analysis, use **Run historical backtest** in its separate dashboard section, or `/api/historical?season=2026`. Runs are cached for six hours and display generation time; `&refresh=1` explicitly recomputes using the normal free-source caches. This cannot create upcoming tickets or validate the live model.

## Remaining limitations

- The private running Codespace and genuine upcoming saved tickets were not accessible here. The engine and automatic pipeline were verified as above; no claim that the user's private future cohort has already graded. Actual games must finish and sources publish matching results.
- DNP/void coverage depends on explicit authoritative evidence; missing records and cancellation/postponement timing are not guessed into sportsbook void rules. Some records will remain Pending until better data exists.
- Historical roster/injury snapshots and original statistics/schedule publication/revision timestamps are unavailable. The 24-hour availability assumption and benchmark lines mean this is **not a fully audited point-in-time FanDuel backtest or a validation unlock**. A strict betting-performance audit needs authentic timestamped feature/availability archives and historical individual/combined quotes; no purchase, invented odds or provider-limit workaround is included.
- The initial backtest templates cover full-game passing/rushing/receiving yardage and historical data with at least five prior games. Other existing upcoming markets remain preserved but are not all simulated by these templates.
- Push/void price reductions are theoretical products only; real FanDuel same-game repricing, acceptance and settlement are unverified. No wager or guaranteed return is represented.
