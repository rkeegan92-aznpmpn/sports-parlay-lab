# Sunday readiness — free-data/manual research

Target: before Sunday, November 15, 2026. New branch `feat/free-data-manual-research`, based on merged PR #4 (`d248be2`). This is **not 100% completion**: fresh legitimate FanDuel prices and final game-day availability confirmation remain external inputs.

## Delivered

The default workspace uses free nflverse schedules/history and ESPN roster checks without any paid odds requests. Users select an upcoming game and roster-matched player, enter the exact FanDuel market/side/line/American price and actual observation time, and confirm the observation. The server validates contract fields, authoritative schedule/kickoff, player/history/roster matching, and freshness. Quotes are explicitly **MANUAL — not independently verified live**. Existing live integration and first-quarter features remain in a separate workspace.

Manual quotes persist in a new table. Updating/retiring an entry retains its historical row; it does not alter existing forecasts/tickets. Generation excludes stale or invalid entries with specific reasons, retains the original EV/history/injury/position/game limits, and produces separately ranked Best/Aggressive tickets when supported. Each has exactly 1 QB, 2 RB, 2 WR, 1 TE, unique players and no more than three from a game. Aggressive must have a higher theoretical product price, ensuring different generated combinations. A shortage stays incomplete. Neither manual observation nor TEST MODE confers calibration.

Saved-ticket grading now runs independently from quote collection in the collector's background cycle. It resolves authoritative game identity, uses verified final nflverse/ESPN statistics, checks actual kickoff against the saved capture, and leaves missing, postponed, ambiguous or conflicting results pending. Wins, losses, pushes, all-push voids and push-adjusted wins are distinguished; no sportsbook payout or void-leg repricing is invented. Existing incomplete archives remain retained/pending. Manual prices never enter live-model calibration. Archive evaluation is not a profitability claim.

The manual workspace includes persistent history pagination, source/freshness/missing-data messages, TEST MODE, responsive controls and collector status. `COLLECTOR_MODE=settle-only` allows background grading without paid quote collection or a working odds subscription.

## Acceptance checklist

| Criterion | Status | Evidence and limits |
|---|---|---|
| App starts in intended Node/Codespaces-style environment | PASS | Node 22 production process started in both browser suites; database/collector health checked. Private user Codespace itself is not accessible here. |
| Free schedules, roster and historical stats return usable matches | PASS | Real network: 43 upcoming games; 27,977 identified dated history rows; first two games had 31/28 roster-matched players and all four required positions; zero roster errors. Real browser selected `2026_10_WAS_NYG` and showed 31 player choices. |
| Current injury source | PASS — listing, not health guarantee | Investigated an additional free ESPN endpoint: snapshot `2026-11-10T23:06:30Z`, 800 dated/matched entries across all 32 teams. It supplements 378 older nflverse entries (868 merged identities). Parser checks season, snapshot age, report date, team IDs and names. Missing entries never clear exclusions or imply health; final inactive status remains a game-day check. |
| Provider failures handled without crash/data replacement | PASS | Automated HTTP 503 schedule fault displays an error while both saved archives remain retrievable; existing authentication/quota/network tests pass. |
| Manual FanDuel odds entered and validated | PASS — functional | Production E2E enters seven explicitly synthetic fixture quotes through real forms/routes; server validates observations and identity/history. Malformed/stale/future/unconfirmed/unknown-player entries are rejected. This does not independently verify a user's FanDuel observation. |
| Two valid six-leg tickets from sufficient legitimate current input | FAIL — external verification | Controlled fixtures prove distinct structured generation and higher Aggressive price. No actual fresh FanDuel prices were supplied/accessible; no legitimate live tickets were generated or claimed. User must enter genuinely observed current prices. |
| Saving/retrieval/persistence | PASS | Both manual tickets persisted through browser reload and fresh app process against the same disk DB; all existing regression checks pass. Old records are retained; private Codespaces storage was not modified. |
| Completed-game grading using actual results | PASS — engine/source checks | Real free-provider probe used a completed Aaron Rodgers row (`2026_01_ATL_PIT`, 221 passing yards) for win/push/loss boundary checks. Lines were explicit counterfactual test contracts, not historical sportsbook prices. Controlled integration grades saved research archives, keeps missing/push outcomes separate and leaves calibration empty. No claim that private historical tickets were settled. |
| No fabricated/stale/unverified prices represented as live | PASS | Manual provenance and `quoteVerified:false`; 30-minute freshness limit, maximum five-minute clock tolerance; user observation required; no demo fallback. Manual fixtures are test-only, blocked from production imports and isolated from real storage. |
| Unit/integration tests, typecheck, production build | PASS | 127 tests passed, 0 failed; `tsc --noEmit` and `next build` passed. |
| E2E complete user workflow | PASS — controlled external inputs | Real production HTTP forms/matching/generation/storage, no mocked ticket/storage endpoints; seven quote entries, both tickets, reload/restart, injected provider failure, 412px phone and 800px tablet layouts. Separate browser run uses real free providers and no fixtures/prices. |

Samsung-sized Chromium viewports were tested, not physical Samsung hardware. A code/data-path PASS does not prove all future provider records or the user's inaccessible private deployment.

## Exact commands and outcomes

From the repository root, Node 22 (`v22.23.4` here):

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run verify:free
npm run test:e2e:live-free
```

Results: **127/127 tests**, typecheck/build **exit 0**, controlled production E2E **PASS**, real free-source CLI **exit 0**, real free-source browser **PASS**. This managed runner prepends `PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH` for Node 22 and uses `NODE_OPTIONS=--use-env-proxy` only for real outbound provider checks. No keys were logged or changed. No synthetic records entered the existing application DB.

The E2E suites require Python 3 and Playwright Chromium:

```sh
python3 -m pip install -r nfl-parlay-lab/tests/e2e/requirements.txt
python3 -m playwright install --with-deps chromium
```

A system Chromium can instead be selected with `CHROMIUM_PATH`. CI installs these prerequisites and runs the controlled E2E after the production build. External-provider live smoke tests are separate to avoid making deterministic CI depend on third-party uptime.

Development iterations included an initial timestamp-string test mismatch (equivalent UTC instants with/without milliseconds), fixed by comparing timestamps, and a discovered fresh ESPN injury source, which replaced an initially assumed injury-data blocker with verified dated supplemental coverage. Added parser regressions for wrong season, stale/future timestamps, mismatched teams and missing report dates. The all-push ticket case was fixed to classify void rather than win. A second regression/E2E loop checked archive pagination, stale entry handling, malformed requests, restarted storage and provider-failure visibility. Tests were rerun after the implementation changes.

## Exact launch instructions

Keep existing secrets and the current persistent `DB_PATH`. Do not delete/replace SQLite or overwrite `.env.local`.

```sh
git fetch origin
git switch feat/free-data-manual-research
npm ci
COLLECTOR_MODE=settle-only npm run dev
```

Open Codespaces port **3000**. Use **Free data + manual odds**. Choose games/players, enter prices actually observed in FanDuel with accurate times, add enough positional alternatives across at least two games, and generate. Save the resulting research tickets if complete. More entries may be required when EV, role, injury, roster, history or game caps disqualify picks. Never edit times merely to make an expired quote appear current.

For production:

```sh
npm run build
COLLECTOR_MODE=settle-only npm start
```

The existing environment file is loaded by the launch wrapper. Settlement-only mode consumes no paid quote credits and runs verified grading while the app/Codespace is active. A stopped Codespace cannot grade or collect. Keep the DB on the existing persistent Codespaces volume; deleting the Codespace can delete its local data. Preserve a consistent SQLite backup before any deployment/storage move.

## Remaining external actions

- **Current FanDuel prices:** use legitimate manual observations; the exhausted API subscription is not required for this workflow. No purchase or provider-limit workaround is implemented. The live API workspace still needs legitimate available credits/access.
- **Injuries:** current dated ESPN listings are now available and integrated. Check final inactive information near kickoff; a current listing, or absence from it, cannot guarantee participation. If both free feeds fail, the application retains the known data/exclusions and reports uncertainty instead of certifying health.
- **Historical outcomes/calibration:** real saved forecasts need their actual games to finish and published matching results. Past quotes/predictions that were never captured cannot be recreated. Validation thresholds remain unchanged; no real-money recommendation is unlocked by manual entry or TEST MODE.
- **Private deployment:** this workspace cannot inspect the user's actual Codespaces database/processes or prove that deployment has picked up the new branch. Repository launch, real free data and isolated persistence have been verified here.
