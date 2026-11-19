# Live integration verification

## Findings

The effective development configuration in this execution workspace has an existing app `.env.local` but **no nonempty `ODDS_API_KEY`** after Next environment loading. No process key binding overrides the file. No key was exposed, changed or written. This is not proof of the configuration in the user's separate Codespace.

The read-only local collector inspection found a legacy database without a collector heartbeat table, so the local collector is **stopped**, not known to be running. The private Codespace heartbeat cannot be inspected from this workspace. A UI UNKNOWN status previously depended on the entire validation/audit request returning within eight seconds; an expensive query, schema/API error, authentication redirect or unreachable server could all hide the heartbeat.

The live free-provider diagnostic returned:

| Source | Observed result |
|---|---|
| NFL player history | 27,977 identified, dated rows; no unavailable seasons |
| Authoritative NFL schedule | 7,548 rows across the schedule archive |
| ESPN roster | One exact probe match; zero probe errors (not proof for all ticket players) |
| Injury feed | 378 entries; team reporting weeks 8–9; no publication date |
| Upcoming injury coverage | Behind scheduled week-10 games, including NYG/WAS; current availability cannot be certified |
| FanDuel player props and freshness | Blocked by missing effective Odds API credential; no authenticated request made |
| Best Six / Aggressive Six | Neither generated from live odds here; no substitutes installed |

The injury source is reachable but lagging upcoming game weeks. It must not be described as a current healthy/active confirmation. Existing old Out/Doubtful reports remain conservative exclusions. A current-week injury report and final inactive information require fresh source publication or an accessible compatible provider; code cannot invent them.

## Changes

- `/api/health` now provides fast database/key-presence/collector-heartbeat checks independently of forecast scans, settlement, or provider calls. Key presence is explicitly **configured-unverified**, not proof of valid authentication or entitlement.
- The validation panel polls health separately. Failed validation details no longer suppress successful collector-health results. UNKNOWN means the health endpoint could not establish status; STOPPED and FAILING remain distinct.
- Missing live credentials no longer silently produce demo data. Explicit `DEMO_MODE=1` remains available for intentional demos; demo players cannot qualify for tickets.
- Cached live pipelines are refreshed when an upcoming event is added/rescheduled/reidentified, or a provider quote has already expired, regardless of the pipeline cache timestamp. All exact quote, freshness, roster/history and EV safeguards remain.
- `npm run verify:live` now uses real provider access and read-only SQLite inspection, never migration/capture/settlement/cache writes. Without a key it checks free sources and reports missing credentials without requesting paid odds. With a key it scans available live FanDuel markets (may consume subscription credits), reports verified research tickets or specific missing data, and distinguishes authentication (401), access (403/422), quota (429), and network/provider failures. Errors and arbitrary historical error text do not echo secrets. `--first-quarter` remains optional.
- Injury report week/publication metadata is visible in diagnostics and source notes. The diagnostic compares report weeks with upcoming authoritative scheduled weeks; retrieval is not treated as freshness.

Pregame generation remains independent of settlement, with exactly 1 QB / 2 RB / 2 WR / 1 TE and at most three picks per game. Best and Aggressive remain separately ranked. Historical records, saved tickets, TEST MODE and calibration thresholds are preserved. No manual generation/persistence retests or feature rebuilds were performed for this change.

## Verification commands

Repository root, Node 22:

```sh
npm test
npm run typecheck
npm run build
npm run verify:live
```

The managed runner used `PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH` for Node 22 and `NODE_OPTIONS=--use-env-proxy` only for outbound live checks. The build is a compilation check, not a rebuild of application features. Tests: **115 passed, zero failed**. TypeScript and production compilation: **passed**. The live diagnostic exits **1 intentionally**, reporting missing credentials and lagging injury coverage; the free-source successes above are genuine network checks. No synthetic tickets were used for live verification. Automated fixtures test failure classification and cache/health correctness only.

## Exact next action in Codespaces

1. Check out the updated PR branch. Retain the existing `DB_PATH` and persistent database. Do not delete, reset or replace the database or environment file.
2. Make the **existing private The Odds API key** available as `ODDS_API_KEY` to the application process, or edit only that setting in `nfl-parlay-lab/.env.local`. Do not paste it into chat, URLs, terminal output or Git. An already-defined empty process variable can mask a file value; the diagnostic identifies that case. No new key is needed if the existing one is valid.
3. Restart the app with `npm run dev` (or `npm start` after a production build), rather than launching bare `next dev`. The wrapper supervises the collector. Keep `COLLECTOR_ENABLED=1` unless a separate worker intentionally owns this same database.
4. Run `npm run verify:live` for development, or `NODE_ENV=production npm run verify:live` to match production environment-file priority. It will attempt authenticated live access and report both pregame research tickets when eligible markets exist, or exact blockers. The key needs The Odds API NFL event/player-prop access, US FanDuel markets, and available credits; a FanDuel account password is not a replacement.
5. In the same port-3000 preview, open `/api/health`. Check key presence, database readiness and heartbeat status. If health is unavailable, first resolve the preview/login/server/database error; UNKNOWN alone is not evidence the worker is running or stopped. Use `/api/validation` for heavier historical details.
6. Obtain current-week injury coverage before treating availability as verified. Use the existing provider when updated or configure an accessible `NFL_INJURIES_URL` CSV with `full_name`, `team`, `week`, `report_status` and preferably a report date. No injury designation is a guarantee of participation. A stopped Codespace cannot collect.

Until authenticated live quotes and current source coverage are verified, there are no supported live tickets to report from this workspace. Missing players/markets are never filled with simulated odds or statistics, and research estimates are never promoted to validated recommendations.
