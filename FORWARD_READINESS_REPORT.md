# Forward collection and grading reliability

New branch: `fix/free-collector-forward-readiness`, from merged main/PR #6 (`32f65a1`). Existing application, manual FanDuel workflow, saved tickets, forecasts, `.env.local`, DB_PATH and secrets are preserved.

## What could and could not be diagnosed

The reported **3,684 forecasts** reside in the user's private Codespace, not this execution workspace. No database export or audit output was provided. The local read-only audit found zero current-model forecast rows in a different legacy database. That does not establish loss of the user's records or the exact eligibility/error distribution of their cohort.

`awaiting kickoff` is not a settled result. Captured quote counts, deduplicated calibration trials, saved-ticket decisive legs and BACKTEST simulations are separate datasets. A verified saved-ticket sample of zero means **accuracy unavailable**, not a measured 0% win rate. No historical simulation or generated result is inserted to fill that gap. Simulation/demo/unknown-source archives are explicitly excluded from the forward dashboard and readiness sample; original archives remain retrievable unchanged.

## Confirmed code failures and repairs

1. Paid quote capture was attempted by default whenever a key existed, even after known quota exhaustion. Automatic mode now pauses paid capture when the credential's recorded error is `OUT_OF_USAGE_CREDITS`, including after the short transport cooldown expires. Missing credentials also select free settlement-only behavior. Explicit `COLLECTOR_MODE=settle-only` guarantees no paid capture. Explicit `capture-and-settle` remains available as a deliberate retry mode; existing provider cooldowns still apply. Successful authorized live refreshes clear the stale denial marker. No credits are purchased or restrictions bypassed.
2. An unexpected forecast-settlement exception could prevent the later saved-ticket grading call. Capture, forecast settlement and ticket grading now run independently. Failure uses previously verified calibration evidence where readable, never fabricated results. Even if forecast state is unreadable, archive grading is attempted and its phase diagnostics retained.
3. A generic collector failure hid which phase was affected. New phase state reports PAUSED/OK/DEGRADED/FAILED, last check/success and sanitized reasons in health and validation responses/UI. A healthy heartbeat is not proof of available final statistics. Free-source failures remain visible rather than being hidden by paid-capture status.
4. Saved grading required the NFL schedule even when a ticket already contained exact ESPN player/event IDs. If the primary schedule is unavailable, stored exact bridges now retrieve matched ESPN final boxscores directly. The same bridge handles a missing legacy nflverse identity when the schedule is available. A stored ID that resolves to a different normalized player name or known position stays Pending. No names/dates/IDs are guessed; authoritative ID conflicts and non-final/postponed events remain Pending. Without the primary schedule, a contradictory saved NFL week or an actual kickoff more than 36 hours from the saved kickoff holds the result for authoritative verification; rescheduling is not guessed.
5. Legacy saved tickets with no stored history ID could never grade. A missing ID can now be resolved only from **one** final same-game record matching normalized name, position, season, team and opponent. Duplicate/ambiguous matches remain Pending. Recovery is recorded in grading metadata/audit (`resolvedPlayerId`, `identityMethod`), not written over original selections or used to manufacture forecast calibration. Existing supplied IDs are not silently replaced.
6. Added `npm run audit:readiness` and `/api/readiness` to reconcile forecast buckets with saved-ticket dates, started-leg counts, missing identities, current outcomes, verified actual-stat samples and collection phases. CLI opens only an existing read-only SQLite file; it does not create/migrate/reset records or make provider requests. The app route uses normal app schema initialization, then performs the read-only audit. Its database fingerprint is for comparing CLI/app access on the same Codespace, not identifying databases across machines.

## Verification evidence

Commands from repository root with Node 22:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run test:e2e:live-free
npm run verify:free
npm run verify:evaluation
npm run audit:readiness
```

This managed runner prepended `PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH` (Node 22). Real outbound probes used `NODE_OPTIONS=--use-env-proxy`; ordinary Codespaces networking generally does not require it.

- **137 automated tests passed, zero failures**; typecheck and production build passed.
- New regressions: expired quota denial pauses automatic paid capture; a synthetic 3,684-row future cohort stays wholly Pending with zero due results/verified saved-ticket samples; an injected forecast-settlement exception cannot block exact-ID ESPN grading; missing and ambiguous legacy identities behave conservatively. Original saved selection JSON is unchanged.
- Controlled production E2E passes real forms, seven explicit fixture manual entries, distinct six-leg generation, saving/reload/restart, separate historical results, automatic collector grading, missing/future outcomes, source failure handling, and phone/tablet layouts. External data/prices in this suite are isolated fixtures; ticket/storage/grading routes are real.
- Real free-provider browser runs without provider fixtures or an odds key, using automatic policy: upcoming schedules and roster choices load, collector runs in free settlement-only mode, capture is explicitly paused. This does not inspect the user's Codespaces key.
- Real completed-game verification passes against actual nflverse statistics: eight historical benchmark tickets and an isolated six-leg final-result grading probe. Source values include Aaron Rodgers 253 passing yards, Derrick Henry 58 rushing yards and Hunter Henry 48 receiving yards for their exact stored game IDs. Probe inputs are counterfactual benchmark contracts, not authentic historical FanDuel quotes or captured forward forecasts.
- **Real ESPN fallback verified:** with a controlled primary-schedule outage, five exact-bridge legs retrieved real final ESPN responses and matched the independent nflverse values: Rodgers 253 (`401873002`), Henry 58 (`401872997`), Davante Adams 39 (`401873004`), Mike Evans 94 (`401873008`), Hunter Henry 48 (`401873001`). The unbridged leg was not invented. Primary failure remains a provider warning. Zero paid requests; all probe databases are isolated memory databases.
- The synthetic 3,684-row test is explicitly **not the user's database**. The suite respects the original quote-uniqueness constraint; no deduplication/validation constraint was relaxed.

## Exact action for the actual Codespace

Keep the existing environment file and persistent DB_PATH. Do not copy/reset SQLite or overwrite the key.

```sh
git fetch origin
git switch fix/free-collector-forward-readiness
npm ci
COLLECTOR_MODE=settle-only npm run dev
```

Open the same port-3000 preview. `/api/health` now separates phase status; `/api/readiness` gives the exact record/date distribution. The equivalent read-only CLI, in that Codespace's app environment, is:

```sh
npm run audit:readiness
```

For a production environment-file configuration use `NODE_ENV=production npm run audit:readiness`. Compare database fingerprints only between that Codespace's app and CLI. The command deliberately never displays key values or environment-file contents.

Interpretation:

- `futureKickoff` / `waitingSixHours` with zero due records: waiting is correct; do not force settlement or backdate predictions.
- Due forecasts with never-checked records or failed settlement phase: inspect the specific phase and stored event/player mappings. Saved grading remains independent.
- Saved-ticket `allStarted` or `partiallyStarted` counts with unresolved legs: inspect `/api/grades` reasons/actual source IDs. `missing-or-ambiguous-final-player-identity` cannot safely be guessed away.
- Zero verified saved-ticket legs: no forward accuracy claim is available. BACKTEST metrics remain separate.

Save generated upcoming tickets before kickoff. The collector checks about every 15 minutes while the Codespace runs. Exact verified ESPN final data can grade eligible legs sooner; nflverse score-based grading keeps its six-hour final-check window. Future, incomplete, missing and postponed records remain Pending. Production launch is `npm run build`, then `COLLECTOR_MODE=settle-only npm start`.

## Remaining external limitations

- Actual diagnosis of the private 3,684-row cohort requires this audit in the actual Codespace; its rows, .env.local and running processes were not visible here. No claim of full private-deployment operation or completed genuine forward tickets is made.
- No fresh genuinely observed FanDuel prices were supplied in this workspace. Two research tickets are supported by the tested manual workflow only when sufficient real, fresh, eligible inputs exist. No fake odds or missing picks are added, and no paid API is required for that path.
- Unavailable ESPN identity bridges, ambiguous names/IDs, explicit provider disagreements, missing player/category results and final participation/void evidence can still leave records Pending. Free fallbacks cannot create unavailable records.
- Existing historical benchmark analysis remains separate, unvalidated research with unavailable historical prices/point-in-time roster, injury and publication archives. It cannot establish forward accuracy or unlock real-money validation.

See [GRADING_RULES.md](GRADING_RULES.md) for exact settlement rules and [EVALUATION_VERIFICATION.md](EVALUATION_VERIFICATION.md) for baseline grading/backtest evidence.
