# Launch NFL Parlay Lab by November 12, 2026

Use this existing repository and the `fix/calibration-collector-dashboard` branch to review the tracking fixes before merge. It includes the earlier startup/TEST MODE fixes. Nothing needs to be recreated.

## Local launch

Use Node 22 LTS (`nvm use` reads `.nvmrc`). From the repository root:

```sh
npm ci
npm run setup:env
```

`setup:env` creates `nfl-parlay-lab/.env.local` only if absent. It never replaces an existing key or file. Put your existing ODDS_API_KEY in that private file using your editor, or keep the existing environment binding. Do not paste the key into chat, commit it, or put it into a command-line argument.

```sh
npm test
npm run typecheck
npm run build
npm start
```

Open http://localhost:3000. PORT can be set by the host. For development use `npm run dev`.

## Persistent hosting

`render.yaml` prepares a single Node web service on the earlier deployment branch (select the reviewed branch/main in the host before deploying newer fixes), a 1 GB persistent disk mounted at `/var/data`, and `DB_PATH=/var/data/parlay.db`. Import this repository as a Render Blueprint if you choose Render; the paid Starter plan and disk require a hosting account. The configuration has not provisioned or deployed any service by itself. For an existing service, attach the disk and set these variables there rather than creating another service. Preserve the existing ODDS_API_KEY secret.

The environment must contain:

- Node 22 LTS
- ODDS_API_KEY as a private secret with FanDuel NFL player-prop coverage
- DB_PATH pointing to a database file on the persistent mounted disk
- REQUIRE_PERSISTENT_DB=1

Build: `npm ci && npm run build`. Start: `npm start`. Health check: `/api/health`. The health endpoint opens the database and returns HTTP 503 if storage is unavailable. It reports key presence, never the key. Persistent mode rejects missing/relative/temporary paths; the host must still mount the actual persistent disk. One writable instance owns SQLite; do not run independent replicas with separate disks.

Retain `/var/data/parlay.db` and its WAL/SHM sidecars across restarts and deployments. For a consistent backup, use SQLite's backup command/API; do not copy only the main file while the app is writing. If moving an existing database, take a consistent backup while the app is stopped and restore onto the mounted disk. Do not replace an existing database with an empty one. A process-restart regression test verifies that saved research ticket labels survive reopening the database.

For another host, attach its persistent disk and use the same variables/commands. Ephemeral serverless storage, including ordinary Vercel filesystems, cannot retain this SQLite database; use a persistent Node host or adapt the database first.

## Live verification

```sh
npm run verify:live
# Optional: probe one upcoming game's Q1 markets separately
npm run verify:live -- --first-quarter
```

The diagnostic reads the existing private env file without replacing environment variables. It prints counts, coverage, errors and remaining-credit metadata without printing the key. With a key it scans all upcoming full-game events using the app's normal caching and stores pregame forecasts. It may consume provider credits; the optional first-quarter probe makes separate paid requests for one event. It exits unsuccessfully if no key or no live candidates are available. In this managed Cloud environment, Node's `--use-env-proxy` flag is needed for outbound fetches; set `NODE_OPTIONS=--use-env-proxy` for this command if running behind the supplied proxy. Ordinary hosting normally does not need that flag.

In the app, confirm LIVE DATA, choose all upcoming games, and inspect returned FanDuel markets, player-history samples and roster rejections. First-quarter player markets may be unsupported (422) or empty for a particular plan/event; totals are shown separately and full-game lines are never substituted. Use Generate 1Q Tickets to run quarter analysis with current roster/injury checks.

Enable TEST MODE explicitly for six-pick research tickets while calibration is unvalidated. It bypasses only calibration; real odds, history, roster, injury, composition and EV checks remain. Six picks require 1 QB, 2 RB, 2 WR and 1 TE across at least two games, with at most three legs per game. A Thursday-only single-game selection will remain incomplete. Missing data never causes fabricated picks. TEST MODE never places wagers and must not be used for real-money recommendations. Normal mode stays locked until the full chronological validation criteria pass, including 200 settled forecasts and eight kickoff dates; simply accumulating 200 quotes is insufficient.

Keep the application/database running to collect pregame forecasts. Reopen the backtest panel after games finish to settle results. Current estimates and theoretical product prices do not guarantee profits or FanDuel acceptance of a combination.

## Verification in this work session

Real nflverse downloads returned 27,906 player-game rows for 2025–2026 and 1,060 latest injury-report entries (including cleared designations). The 2026 play-by-play download produced 4,093 player-quarter records and 135 game-quarter totals. All 27,906 weekly player rows were successfully joined to real nflverse schedule IDs/dates by unique season/week/teams before history verification. ESPN returned a current Buffalo roster and uniquely matched Josh Allen. Provider transport, FanDuel-only parsing, unsupported/empty Q1 markets, historical matching, injury exclusions, roster identity, six-pick generation and calibration gating also have automated fixture tests.

No ODDS_API_KEY is configured in this workspace as of this check. Consequently, actual authenticated FanDuel quotes and Q1 coverage have not been verified. A hosting account/disk and that private key binding remain necessary for a live deployment. The manifest alone does not prove a host disk is mounted.

## Investigating TEST MODE and building validation history

TEST MODE bypasses chronological calibration only. It still needs verified live FanDuel quotes, at least five/six line-specific historical games, active current roster identity, supported recent role usage, positive estimated leg/ticket EV, and exactly 1 QB, 2 RB, 2 WR, 1 TE. It needs at least two upcoming games. Best Six and Aggressive Six are ranked separately; Aggressive Six also needs a higher theoretical product price than Best Six. There may legitimately be zero or one supported ticket. Missing players, poor estimated value, or a single-game selection never justify filling slots with made-up picks.

The ticket API now returns `pipelineRejections`, eligible position counts per ticket, and `modelValidation.tracking`. The page displays the tracking counts and upstream identity/availability exclusions separately from calibration. Use All upcoming games, Generate Both Tickets, and inspect these reasons. Refresh Data forces another odds scan and may consume provider credits. The new pipeline cache version ignores obsolete cached matches after upgrading. No private Codespaces URL or secret is needed to inspect code; diagnostics are available inside your own port 3000 preview.

Confirmed fixes include lossless binary caching of compressed CSV fallbacks, nflverse team/attempt-column aliases, authoritative current-roster checks for traded players, and refreshing history verification proofs alongside the actual history. Current-season results and ESPN logs/boxscores refresh at most every 15 minutes by default (`NFL_RESULTS_CACHE_MIN`), rather than remaining stale for a whole day. Historical prior-season stats keep their longer cache. Provider publication may lag further.

A historical stat row is not a stored prediction. Calibration starts with zero when no eligible pre-kickoff forecasts have been captured, games have not finished, provider results are not available, or stored identities cannot be matched. Earlier versions also missed capture on cache hits/recovery and could not settle ESPN-backed forecasts. These paths are fixed without retrospectively inventing predictions or odds.

The default `npm run dev` / `npm start` commands now automatically supervise one collector with the app. A separate manual watch is no longer needed. Keep the Codespace and app process running. The dashboard reports running, failing, stopped (expired heartbeat), or unknown (unreachable server). App and collector use the same Next environment-file priority and existing private key/database. If you intentionally disable the automatic worker with `COLLECTOR_ENABLED=0`, a manual collector can run with:

```sh
npm run track:forecasts -- --watch
```

This captures verified pregame forecasts and attempts final-result settlement every 15 minutes while the Codespace and terminal process are running. It uses the same SQLite database as the app and the normal odds cache. It may consume API credits on fresh scans. Do not run a separate worker with an independent database. For one run use `npm run track:forecasts`; for results only use `npm run track:forecasts -- --settle-only`. Stop the watch with Ctrl+C. A stopped Codespace cannot capture forecasts; keep it running before kickoff or run the same command from a scheduler on the persistent application host. No external automation is installed by this change.

The regular ticket and backtest endpoints run the same settlement and reporting workflow, so re-generating tickets updates the displayed calibration sample without reloading the page. Tracking records append real pregame quote/probability snapshots regardless of TEST MODE, ticket completion, or positive EV. Duplicate refreshes do not add trials: evaluation uses only the last captured pregame quote per player/market/side/game, including across alternate lines. Pushes are tracked separately and excluded from win/loss calibration. Changed prices cannot manufacture a 200-outcome validation sample. All original performance, sample, paired-market, and eight-kickoff-date gates remain in force.

Settlement uses the season recorded on each forecast. nflverse forecasts require a unique same-player-ID, same-team/opponent, same-date result. ESPN forecasts use the stored ESPN athlete ID and final same-game boxscores, even if the player no longer has a current roster slot. Missing identities, unavailable results, ambiguous matches, and non-final games remain pending. Legacy snapshots without verified player identity or model lineage are not promoted into validated history.

There is no historical odds subscription or archive configured in this repository. Past FanDuel prices and pregame model forecasts that were never recorded cannot be recovered from weekly statistics. An independently sourced, timestamped historical archive with player identity, quote provenance, and pregame-only features would be needed for a retrospective validation project; the app does not synthesize one. Until enough genuine forecasts settle and calibration passes, use the research labels and keep normal recommendations locked.

Injury handling uses each team's latest available reporting week. An older “Out” row is not carried indefinitely when that team publishes a later report; a missing player in the latest report means unknown, not a fabricated “healthy” designation. Current ESPN roster injury designations are checked independently.

## Saved Tickets history

Save Ticket now shows Saving, confirmation, or an actionable error beside each ticket's button. The Saved Tickets section loads SQLite history on every page load, includes saved time, ticket kind, six leg details, theoretical estimates, and the original TEST MODE research label. History is an archive, not a current quote or validated recommendation; it never bypasses generation/validation gates. Use Refresh saved history to retry a failed load and Load older saved tickets for more than 50 records. Existing records are retained, including older records with missing details.

History uses the same DB_PATH as the app and tracker. Browser refreshes do not clear it. Keep that database on persistent storage to retain it across host replacement. Saving does not place a wager or alter prediction/model logic.

## Automatic collector and calibration dashboard

`npm run dev` and `npm start` supervise both Next.js and a collector. One SQLite lease per database prevents duplicate manual/automatic workers. The collector checks every 15 minutes and heartbeats every 15 seconds; a heartbeat older than 90 seconds is stopped/stale, never proof of continued collection. Child exits are retried by the app supervisor. Graceful app shutdown stops the worker; a stopped/sleeping/deleted Codespace does not collect. Closing only the browser preview does not stop a still-running server. Starting Next directly bypasses this supervisor; use the npm commands or explicitly run a manual collector. `COLLECTOR_ENABLED=0` disables automatic startup.

The Forecast collection & validation panel polls the read-only `/api/validation` endpoint. It shows collector state, heartbeat, last attempt/successful check, next run and sanitized failures; captured/settled quote counts; deduplicated sample size; upcoming/pending/push counts; and each unmet validation requirement. If the server becomes unreachable, it shows UNKNOWN rather than continuing to claim collection is running. Old-model, incomplete-metadata, legacy snapshot and post-kickoff records are reported separately. Collector errors do not expose API keys.

Why 0 settled can coexist with captured quotes:

- Player statistics, saved tickets and legacy quote snapshots are not automatically this model's pregame forecasts. Old snapshots may lack model lineage, stable player/event identity or timestamps; these are not invented retrospectively.
- A manual collector that was never started, an asleep Codespace, or an invalid/private key not loaded into the worker leaves collection stopped or failing. The app and worker now load the same environment-file precedence without replacing existing secrets.
- Captured future games have no final result yet. The six-hour post-kickoff result-check window, provider publication delay, missing/ambiguous player records, pushes, and postponed/cancelled/non-final games are explicit pending/exclusion reasons.
- Previously, quote-capture failure prevented a collector cycle from attempting settlement. Settlement now runs independently of paid odds/key/quota failures.
- Previously, original Odds API event IDs were verified but not persisted, and results were matched only around the original kickoff date. New captures persist event ID, model version, capture/odds/kickoff timestamps, historical player ID/source, current ESPN player bridge when verified, market, side, line, odds, modeled probability and paired market baseline. A unique real nflverse schedule supplies NFL/ESPN result-event IDs. No timestamp or price is backdated to create missing history.

Settlement follows a stored authoritative game identity through postponements. ESPN requires the matching final event and athlete ID; non-final and missing player/market data remain pending. nflverse results additionally require the official schedule's published final scores. A stored ESPN roster-ID bridge lets an nflverse-backed forecast settle against the exact final ESPN boxscore if nflverse results lag. Without that verified bridge, an ESPN identity is not guessed. Unavailable mapping/results stay pending and are retried. Original forecast timestamps, odds and kickoff remain unchanged. Final result date and provenance are stored separately; the eight-date gate uses actual final-game dates. Rescheduled repeats and changing lines/prices for the same player/market/side/event cannot inflate the sample.

Migration preserves Saved Tickets and forecasts. Old `hit` values without final-result provenance are copied to `legacy_hit`, marked for re-verification, and excluded until a final result can be established. Existing probabilities/odds are not recomputed using later information. No fake calibration samples are installed.

All existing thresholds remain: at least 200 deduplicated settled outcomes, 200 paired no-vig comparisons, eight distinct actual game dates, calibration error no greater than 5 percentage points, and model Brier strictly better than the stored paired market baseline. The calibration error check uses unrounded values; displayed rounding cannot unlock a failing model. Both generators keep that gate for real-money recommendations. Pregame research remains available before calibration and continues to enforce 1 QB / 2 RB / 2 WR / 1 TE, a maximum of three legs per game, active verified players, fresh supported quotes, history and value checks. Best and Aggressive remain separately ranked; Aggressive must have higher theoretical payout. TEST MODE and Saved Tickets never confer validation.

Future data is still necessary. An empty or newly repaired database cannot obtain past FanDuel odds/pregame predictions from weekly stats. Eight actual game dates may require several weeks of an awake collector, and passing the sample thresholds does not guarantee the model will beat the market baseline. Missing historical player-ID bridges, unsupported FanDuel markets/plans, unavailable final boxscores and provider publication delays cannot be solved by fabricating records. Review live dashboard reasons in your own Codespace; this execution workspace has no access to its private key or SQLite history.

Relative DB_PATH values now resolve against the application directory regardless of which directory launches a CLI. This prevents a manual root-directory worker from silently creating a second database while the page reads the app-directory database. Absolute paths are unchanged, and normal npm/Next users retain the same existing app database and Saved Tickets. If an older manually launched worker already wrote a separate root-directory database, keep it intact and inspect/backup both files before choosing an absolute DB_PATH; this change does not silently merge, overwrite or invent historical records.

## Round 1 read-only settlement audit

Run `npm run audit:forecasts` in the actual Codespace to reconcile its captured count with future kickoffs, the six-hour window, due/checked records, timing integrity and heartbeat state. `-- --probe-results` adds a free-source diagnostic without settling records. See [ROUND_1_AUDIT.md](ROUND_1_AUDIT.md) for exact verification commands, results, safe repair steps and evidence limits. The audit never creates/migrates a DB or promotes quote-only history to predictions. Conflicting event IDs/finality remain pending; verified namespace corrections are logged, and actual kickoff provenance is required for same-day captures.

## Pregame research generation

Pregame Best Six and Aggressive Six do not wait for forecasts to settle. The API reads current calibration evidence; the supervised collector handles postgame work separately. Unvalidated tickets and saved archives are labeled PRE-GAME RESEARCH, or TEST MODE when selected. Existing real-money validation thresholds and all source/selection checks remain in force. See [PRE_GAME_READINESS.md](PRE_GAME_READINESS.md) for behavior, verification results and data limitations.

## Live provider and UNKNOWN health diagnosis

`/api/health` checks credentials presence and collector heartbeat independently of the heavier validation audit. The validation panel polls it separately. Run `npm run verify:live` in the actual Codespace app environment to verify provider access and identify 401/403/422/429 failures, missing history, injury coverage gaps or stale quotes without mutating stored history. See [LIVE_INTEGRATION.md](LIVE_INTEGRATION.md) for observed results and the exact next action. Keep the existing DB_PATH and secret configuration; no reset is needed.

For mixed Invalid API key/rate-limit errors, run `npm run check:api` in the actual Codespace while the app is running. It compares secret-safe credential fingerprints and distinguishes provider authentication, quota and endpoint errors without deleting history. See [API_CONFIGURATION.md](API_CONFIGURATION.md).

## Free-data/manual research without paid credits

Use `COLLECTOR_MODE=settle-only npm run dev` (or `npm start` after building) with the existing DB_PATH and secrets preserved. The default free workspace does not call the paid provider. Manual entries are explicitly user-observed research, not verified live quotes; they never validate the live probability model. Background saved-ticket grading still uses final free-source results. See [MISSION_READINESS.md](MISSION_READINESS.md) for the full acceptance checklist, live evidence, E2E prerequisites and remaining injury/price limitations.

## Automatic grading and historical backtests

Preserve the existing DB_PATH and secrets; launch with `COLLECTOR_MODE=settle-only npm run dev` or production `npm start` after building. Save future tickets before kickoff. The collector grades eligible legs independently, tracks early losses until all legs resolve, and keeps state-change audit records. BACKTEST runs use separate storage and never create upcoming tickets or calibration samples. See [GRADING_RULES.md](GRADING_RULES.md) and [EVALUATION_VERIFICATION.md](EVALUATION_VERIFICATION.md) for outcome rules, real completed-game evidence, exact commands and data limits.

For paid-provider errors alongside future forecasts or zero verified saved-ticket samples, see [FORWARD_READINESS_REPORT.md](FORWARD_READINESS_REPORT.md). Use `npm run audit:readiness` inside the actual Codespace for a read-only date/eligibility audit, and `COLLECTOR_MODE=settle-only npm run dev` for free automatic grading. Collection phases are now reported separately; no simulated result fills forward accuracy.
