# Preview and deadline readiness — November 11, 2026

PR #7 was merged into `main` at 2026-11-11 22:39:35 UTC. This change starts from that merged main, without rebuilding the application.

## Fixes

- Codespaces previously forwarded port 3000 but had no start/resume command. `postStartCommand` now runs `npm run codespace:start`, which starts the existing development app and collector, waits for database-backed health, and reuses a healthy existing instance.
- Root launch commands explicitly bind `0.0.0.0:3000`. A port conflict fails rather than silently selecting 3001. An occupied/unhealthy port is reported without killing an unknown process. No setup script rewrites environment files or DB_PATH.
- Port forwarding opens a full browser rather than an embedded preview. The startup log is local, ignored, and created with owner-only permissions at `.codespace/app.log`. Treat existing application logs as private.
- Missing-key guidance now explains the free-data/manual-quote/settlement workflow rather than instructing users to obtain a paid key.
- Research cards explain ranking and eligibility rationale. Model, manual-price, injury and correlation uncertainty remain explicit; no validation threshold or selection rule changed.
- CI includes the startup-readiness regression test.

## Verification executed

Commands below were executed by the implementation agent, not left as testing tasks for the owner. Node v22.23.4 was used. This managed runtime requires `NODE_OPTIONS=--use-env-proxy` for public provider HTTP; that setting was process-local and was not written into the user's environment files.

| Check / exact command | Result and evidence |
| --- | --- |
| `npm test` | PASS: 1 startup-readiness test plus 137 application tests; zero failures. Covers healthy/unhealthy/unrelated/stopped listeners and existing prediction, identity, freshness, grading, missing/postponed/incomplete result and persistence rules. |
| `npm run typecheck` | PASS, exit 0. |
| `npm run build` | PASS, production build exit 0. Completed before development server startup. |
| `npm run test:e2e` | PASS: real production routes/forms/database with explicitly isolated provider fixtures; seven manual inputs, two distinct structured six-leg tickets, both saved, page reload and process restart, provider-failure archive access, separate historical simulation, automatic grading, pending/final display and byte-identical original ticket records. |
| `npm run test:e2e:live-free` | PASS: real unmocked provider HTTP; 43 upcoming games, 31 matched player options for first game, no key, active settlement-only collector, 412px phone layout; no prices entered or live tickets claimed. |
| `DB_PATH=/tmp/parlay-preview-free.db npm run verify:free` | PASS: 43 upcoming games, 27,977 history rows, 31/28 matched roster players for sampled games, zero roster errors; 9,455 completed-player rows. 800 current ESPN injury entries across 32 teams supplemented historical reports. Zero paid requests. |
| `npm run verify:evaluation` | PASS: actual completed NFL statistics grade the isolated benchmark contract; five exact-bridge ESPN final results agree with nflverse during a controlled primary-schedule outage. Original records unchanged. Eight BACKTEST tickets generated separately; 42 decisive legs, 17 wins, six pending legs; five finalized tickets, zero wins. Zero priced historical legs or paid requests. These are simulated benchmark results, not forward accuracy. |
| `npm run codespace:start` (twice) | PASS locally: first call started development app on 3000; second reported already ready without another app instance. Health: database ready, collector running in settlement-only mode, capture paused, forecast-settlement and ticket-grading phases OK. |
| Playwright against the running development server at `http://127.0.0.1:3000` | PASS: actual page loads, 43 real games and 31 roster choices, no browser errors, no horizontal overflow at 800×1280 and 412×915; screenshots retained in implementation workspace. This is responsive Chromium emulation, not a physical Samsung device test. |
| Read-only before/after preservation assertions | PASS locally: `.env.local` hash unchanged, effective DB_PATH unchanged, existing local saved rows unchanged and forecast IDs preserved. This workspace has zero saved tickets/forecasts; populated-record preservation is additionally covered by isolated production browser tests. The private Codespace database was not accessed. |
| `git diff --check` | PASS. |

Sample provider results are retrieval-time evidence, not a guarantee for every team, game or later request. Injury-feed presence does not establish healthy status, participation or final inactives.

## Preview and launch status

The development server is running in the implementation workspace at **http://localhost:3000**, listening on all interfaces. This address is local to this workspace; it is **not** a verified remote preview URL for the owner's browser. Its lifetime depends on this environment remaining active.

The GitHub integration returned HTTP 403 (`Resource not accessible by integration`) for repository Codespaces access. The authenticated user Codespaces list returned no accessible instances. No remote Codespaces shell, private port URL, port-forwarding tool or usable shared-browser control tool was available. Consequently the owner's broken port preview has **not** been directly verified or repaired in place, and no public URL is invented. No unauthenticated public tunnel was created to expose saved records.

To apply this startup fix to the owner's environment, the reviewed PR must be brought into that Codespace, then **Codespaces: Rebuild Container** applies the lifecycle configuration. On subsequent starts/resumes the app starts automatically and port 3000 opens in the browser. No FanDuel login or paid key is required for manual research. Keep the existing `.env.local` and DB_PATH. Only the owner/authorized GitHub session can perform that remote action until Codespaces access is granted; this PR is not merged automatically.

## Remaining limitations / acceptance status

| Requirement | Status |
| --- | --- |
| Existing app starts and loads | PASS in implementation workspace; owner's private Codespace remains inaccessible. |
| Verified free schedules, history, rosters and available injuries | PASS for sampled real provider responses, with source/freshness limitations retained. |
| Real FanDuel player-prop feed | BLOCKED: no usable odds credential/entitlement is connected here; owner previously reported exhausted Odds API credits. Existing authenticated adapter is preserved. No free FanDuel player-prop feed was established, and public consumer endpoints are not treated as permission to bypass restrictions. |
| Manual odds workflow | PASS in production browser tests. Only enter exact observed FanDuel quotes; they remain labeled manual, not verified live, and expire after 30 minutes. |
| Two valid distinct six-leg pregame research tickets | PASS with explicit isolated input fixtures, exactly 1 QB, 2 RB, 2 WR, 1 TE, maximum three from one game, different higher-price Aggressive Six. **Real current tickets remain blocked by absent actual prices**; no fake inputs were entered into the working database. Need fresh observed quotes across at least two games and eligible alternatives. |
| Saving/retrieval/persistence and automatic grading | PASS in production browser workflows; completed-stat matching verified against real free sources. Authentic private saved-ticket end-to-end grading remains unverified without that database and its eligible contracts. Missing results remain pending. |
| Historical and forward evaluation separation | PASS; BACKTEST is not a calibration sample. Historical odds and point-in-time injury/roster/publication archives remain unavailable, so odds-dependent metrics stay unavailable and historical simulation cannot validate the live model. |
| Samsung phone/tablet support | PASS responsive Chromium layouts at representative sizes; physical Samsung browser/hardware unverified. |
| Validated real-money recommendations | BLOCKED until authentic forward calibration passes. Research generation is separate and does not require forecasts to settle. TEST MODE safeguards remain. |
| Working remote owner preview URL | BLOCKED by Codespaces integration permissions; local development URL is verified only inside this workspace. |

The software checks pass. Live priced tickets, private preview restoration, actual private-ticket grading and validated predictive performance are not claimed complete.
