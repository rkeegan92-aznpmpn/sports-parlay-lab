# Paper Betting — Issue #33

Open **Paper Betting** beside the existing workspaces. This is virtual research only: the database receives one $1,000 opening balance and each captured ticket costs $10. No sportsbook account, purchase, hosting activation, or real wager is involved.

The four strategies are Safer, Balanced, Aggressive, and Long Shot. Each full-game ticket retains exactly 1 QB, 2 RB, 2 WR, and 1 TE and existing eligibility checks. Unavailable strategies stay unavailable; TEST MODE, demo, historical simulations, and manual/unverified quotes cannot enter this ledger. Original saved tickets are not imported or rewritten.

## Running and automatic capture

Use Node 22 and the existing repository-root commands:

```sh
npm run dev
```

For production locally:

```sh
npm run build
npm start
```

Open port 3000, then Paper Betting. Preserve the existing environment and persistent `DB_PATH`. Normal startup launches the existing collector; its default 15-minute cycle now also grades and captures paper tickets. `COLLECTOR_ENABLED=0` disables automatic work. A stopped Codespace does no collection or grading. The dashboard displays collector and paper-phase health, and offers manual preview, capture, and grading fallbacks.

The slate control defaults to **All Upcoming Games**. Choose **All Sunday Games** (NFL Eastern game dates, including Sunday-night games whose UTC date is Monday), or **Select Multiple Games** and use matchup checkboxes. The saved selection controls both manual previews/capture and the automatic collector. A single game cannot fill a Pick 6 because the existing maximum of three picks per game remains enforced.

Automatic capture defaults to Thursday, Saturday, Sunday, and Monday, opening 120 minutes and closing 15 minutes before the earliest kickoff in the saved selection. Settings are configurable in the tab. UTC instants drive cutoff comparisons. Today's started games remain part of the automatic kickoff anchor; a restart does not backdate wagers. Manual capture still requires fresh, verified future-game markets.

Generation reads existing provider caches only: it never refreshes paid odds, retries providers, or spends credits to fill missing strategies. Use the existing explicit provider refresh controls if a legitimate fresh cache is needed. Missing coverage, verification failures, insufficient funds, and closed windows remain visible. The settle-only collector can also perform this cache-only paper work.

## Persistence, grading, and accounting

Additive SQLite tables keep paper wagers, settings, grading, and ledger separate from saved tickets, forecasts, and backtests. Existing records and secrets are untouched. Immutable ticket snapshots retain exact odds, source observations, and capture timestamps. A database uniqueness constraint on the canonical selected game set/strategy and an immediate transaction prevent duplicate captures and debits, including concurrent workers. Equivalent All/Sunday/custom sets share the same identity regardless of checkbox order. A second check also prevents identical strategy/leg contracts from being charged again through another scope, including legacy date-based tickets. Existing tickets are not re-keyed. Cross-date selections are attributed to the first selected kickoff’s NFL week for paper reporting. There is no bankroll-reset API.

The existing verified final-statistics grader grades individual legs and complete tickets. Missing or postponed results stay pending. Verified nonparticipation may void a leg under existing documented rules; missing results never become losses. A verified losing leg can finalize a loss while other legs remain pending. Push/void legs remove their multiplier; all-neutral tickets return the stake. These are theoretical paper payouts, not a claim that a sportsbook accepts a combination or uses identical settlement/correlation rules.

Finalized tickets are rechecked for corrections. Corrections append compensating ledger entries without changing captured odds or deleting old accounting events. Older overlapping grading checks cannot overwrite newer evidence. Corrections can make available cash negative; new wagers then remain blocked. Repeated identical results add no credit.

The dashboard separates available cash, open stakes, equity at stake cost, realized P/L, and ROI. ROI uses finalized stakes; win rates exclude pushes and voids. Weekly, season, strategy, and verified-leg statistics derive from paper records only, not calibration samples. Strategy-filtered history and older-page navigation do not change aggregate balances. Wins are green, losses red, pending yellow, and pushes/voids gray, with text labels as well.

## Verification

Commands run from repository root, all exit status 0:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Results: 251 automated tests passed (1 startup + 250 application), TypeScript passed, production build passed, and all 10 browser workflows passed. Tests cover additive migration, immutable records, concurrency/reopen idempotence, four-strategy capture, rejected stale/test/unverified input, window boundaries, insufficient funds, multi-game pending/early-loss handling, pushes/voids, correction reversals, and week/season/strategy accounting.

The paper browser workflow verifies default All Upcoming, Sunday/custom selection, selection persistence, shared optimizer constraints, and scope-switch deduplication. It runs the actual collector against isolated provider fixtures: one explicit cache acquisition, four automatic $10 captures, reload persistence, zero duplicate wagers, verified final-fixture grading, subsequent correction reversal, and no extra odds requests. Existing saved-ticket and forecast tables remain unchanged. Phone and tablet screenshots are fixture demonstrations, not live winnings:

- [Phone](docs/screenshots/paper-betting-phone.png)
- [Tablet](docs/screenshots/paper-betting-tablet.png)

Real forward-tracked capture and final grading have **not** been demonstrated with live NFL games in this workspace. They require an active runtime, sufficient verified fresh cached markets before kickoff, and available verified final player statistics afterward. No historical odds or outcomes were fabricated to claim live completion. Provider coverage and missing final data may keep individual strategies unavailable or tickets pending.

## Collector diagnosis and behavior

The previous worker could choose the legacy paid Odds API `getData()` path automatically when an old `ODDS_API_KEY` existed. That path checks Odds API credentials, quota and eligible forecasts, independently of the working PropLine cache. Failures there could label the entire worker failing even while paper generation and grading worked. Conversely, paper-phase failures were not included in the worker's aggregate result.

The default worker now performs free settlement/grading and cache-only paper capture. Legacy paid forecast collection remains available only through explicit `COLLECTOR_MODE=capture-and-settle`; existing provider cooldowns still apply. No provider adapter, credentials, cache freshness rules or quota limits were replaced or bypassed. A running worker with provider/data warnings is **degraded**, an unexpected phase failure is **failing**, and an expired heartbeat is **stopped**. The Paper dashboard shows each phase and the last diagnostic, with all three provider credentials redacted. Missing markets remain blocked, never converted into invented tickets.

The local repository database was inspected read-only: it had no configured provider credentials, and its stored collector record had no failure. This workspace cannot inspect the user's running Codespace database, so its exact original runtime error is not claimed as verified. The repaired phase diagnostics expose that error after updating/restarting the app. No live provider calls were made for this change.
