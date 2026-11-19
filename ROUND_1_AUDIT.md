# AI Battle Round 1 — settlement and calibration audit

## Scope and evidence limits

Branch: `fix/round1-settlement-audit`, based on merged `main` at `8c7473f`.

The reported 2,791-record database is in the user's private Codespace and was not available in this execution workspace. No copy or sanitized JSON of that cohort was supplied. This report therefore **does not claim to know its exact pending-record distribution or to have settled those 2,791 rows**. The local read-only audit found 0 current-model forecasts in the local legacy database. That is a different database, not evidence that the user's forecasts disappeared.

The new `audit:forecasts` command gives the exact readiness distribution inside the user's Codespace without requiring the odds key, creating a database, migrating schema, grading results, or changing saved tickets. It supports legacy schemas and reports missing columns instead of inventing metadata.

## Confirmed code defects fixed

1. **Conflicting rematch IDs:** matching previously preferred an ESPN ID even when the stored NFL ID identified a different existing game between the same teams. It could overwrite one identity and grade the wrong rematch. Conflicting authoritative IDs now stay pending. An old NFL ID that genuinely disappears after rescheduling can still follow its stable ESPN ID; another existing game's ID cannot be silently discarded.
2. **Identifier namespaces:** numeric ESPN IDs stored in the NFL result-ID field, or NFL IDs in the ESPN field, now resolve only when a unique authoritative schedule row proves the correction. Every actual metadata change is logged in `forecast_event_repairs` with before/after IDs and verification time. Original Odds API event IDs, predictions, odds and capture timestamps are not rewritten.
3. **Conflicting finality:** published NFL scores no longer override an explicit non-final/postponed ESPN status for the same event. The forecast stays pending as `conflicting-final-status`, including potential pushes, until finality agrees.
4. **Actual kickoff verification:** original recorded kickoff alone is insufficient if an event ID/date is wrong. Final ESPN kickoff time and the NFL schedule's Eastern local kickoff (with verified DST conversion) are checked against capture time. Post-actual-kickoff captures, unverified same-day kickoff times, invalid result values and invalid contract lines/sides cannot become wins/losses.
5. **Historical provenance:** invalid season/epoch/quote/capture timing is reported and excluded as recorded; seconds are not guessed into milliseconds and predictions are never backdated. Existing same-day settlements lacking actual kickoff proof are backed up in `legacy_hit` and rechecked. Quote/probability history and saved-ticket rows are retained.
6. **Actionable readiness:** the read-only audit reconciles captured counts into future kickoffs, the six-hour check window, due-never-checked, due-previously-checked, pushes, settled rows, invalid provenance and legacy/inconsistent state. It shows UTC times, next eligibility, event groups, source-ID issues, collector heartbeat, safe examples, and a database-path fingerprint for comparing app/CLI access. The validation dashboard includes this audit.

The six-hour result window and every calibration threshold remain unchanged. A quote is not a finished result. Repeated quotes, alternate lines, pushes, unverifiable records and TEST MODE never manufacture calibration samples. The 1 QB / 2 RB / 2 WR / 1 TE structure, three-per-game maximum, separate Best/Aggressive ranking, and Saved Tickets functionality remain intact.

## Exact verification commands and observed results

Working directory: `/workspace/work/nfl-parlay-lab`. The managed runner needed its installed Node 22 runtime in PATH; `node --version` returned `v22.23.4`. These commands contain no key values:

```sh
PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH npm test
PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH npm run typecheck
PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH npm run build
PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH npm run audit:forecasts
NODE_OPTIONS=--use-env-proxy PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH npm run audit:forecasts -- --probe-results
```

Results:

- `npm test`: **104 passed, 0 failed**. New regressions cover a synthetic 2,791-future-quote cohort, read-only legacy/schema auditing, heartbeat expiration/recovery, identifier repair/conflict handling, conflicting final status, DST ambiguity, original-vs-actual kickoff, preserved saved tickets, and immutable quote/prediction timestamps.
- The isolated 2,791-row fixture produced **2,791 future forecasts, 0 due, 0 settled validation outcomes, 0 provider requests**, with all buckets reconciling and saved-ticket data unchanged. This tests correct refusal to settle future data; it is not the user's cohort and is never installed into the application database.
- TypeScript: **passed** (`tsc --noEmit`, exit 0).
- Production build: **passed** (`next build`, exit 0).
- Local default read-only audit: **exit 0**, 0 current-model forecasts, legacy missing-column diagnostics, no database creation/migration. It cannot diagnose the private cohort's exact distribution.
- Optional live, free-provider probe: **exit 0**, 9,455 current-season stat rows with exact converted kickoff timestamps, 136 final NFL game IDs, 1 exact ESPN roster match, 1 final ESPN player boxscore with an exact kickoff timestamp, `espnEventState: final`, and no probe errors. A successful source probe does not establish coverage or outcomes for all 2,791 private records. It does not place wagers or mutate any forecast.

`NODE_OPTIONS=--use-env-proxy` was needed for this managed runner's outbound proxy. Normal Codespaces networking may not need that option. Node 22 users can run the plain npm commands shown below.

Additional production browser/lifecycle verification was run with:

```sh
python3 /workspace/work/calibration-lifecycle-test.py
```

That execution-workspace harness uses an isolated database and explicit ticket-generation fixtures. It verifies real status/storage APIs, collector startup/failure/duplicate-worker/shutdown behavior, UNKNOWN on an unreachable server, STOPPED when disabled, regular calibration gating, and Saved Tickets surviving restart. The harness is not application history or evidence of authenticated FanDuel coverage. The committed automated tests above are the reproducible repository regression suite.

## Commands for the actual Codespace cohort

After checking out this PR branch and using Node 22:

```sh
npm ci
npm run audit:forecasts
npm run audit:forecasts -- --probe-results
```

The first command after installation is read-only and does not need a paid odds request. The probe adds free schedule/stats/ESPN access; it still does not settle records or modify the DB.

Interpret the audit before changing anything:

- If all 2,791 are `futureKickoff` or `waitingSixHours`, zero settled is expected. Check `nextEligibleAtUTC`; do not force early grading.
- If `dueForSettlement` is positive, compare `dueUnchecked` vs `duePreviouslyChecked`, heartbeat/last-attempt/error, per-event IDs and pending reasons. A healthy heartbeat does not prove a final result exists.
- Compare the database-path fingerprint with the dashboard to detect a different DB. The fingerprint is not a content hash or proof of identity across different machines.
- Review `schemaMissingFields`, unsupported player IDs and timestamp problems. Do not automatically merge databases, infer missing forecasts, or convert timestamps without authoritative original records.

Before applying schema/settlement repairs to valuable historical data, preserve a consistent SQLite backup. Stop the app/collector cleanly before copying a DB, or use SQLite's backup API while it is live; do not copy only the main file during WAL writes. Then, with another collector stopped:

```sh
npm run track:forecasts -- --settle-only
npm run audit:forecasts
npm run dev
```

One-shot settlement uses the normal verified final-result path and does not need to collect paid odds. If it reports another active collector owns the DB, no second worker was started and no settlement run occurred. Stop that worker first or allow its next scheduled cycle; do not bypass the lease. Restarting the normal app restores its supervised collector while the Codespace is active. A stopped Codespace cannot collect.

## Still blocked by data or time

The exact private-cohort diagnosis requires its audit output. Future games, postponed/cancelled/non-final events, missing player/market results, ambiguous identities, malformed historical clocks and inaccessible providers must remain pending or excluded. Past predictions and prices that were never recorded cannot be reconstructed from final statistics. A final boxscore alone is not a pregame forecast.

No calibration threshold was relaxed: at least 200 deduplicated settled outcomes, 200 paired no-vig comparisons, eight distinct actual game dates, calibration error at most 5 percentage points, and model Brier strictly better than the stored paired market baseline are still required. More quote capture alone is insufficient; future collection time and additional finished games may be necessary, and enough samples do not guarantee the model will beat the market. No real-money recommendations are unlocked by this audit.
