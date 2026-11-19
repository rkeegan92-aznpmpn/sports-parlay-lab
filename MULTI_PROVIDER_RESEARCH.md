# Issue #26 — independent odds providers and four research options

Base main: `f42000f` (merged PR #25). Existing full-game/Q1 generators, cached previews, manual comparison, free-data research, saved-ticket storage and PWA remain available. No migrations, credential changes or existing record edits.

## Capability/route audit

| Path/source | Existing behavior retained | New integration |
| --- | --- | --- |
| `/api/fanduel` | Server-only FANDUEL_API_KEY; shared credential-scoped board; 5-minute cache; provider cooldown and newer-failure invalidation | Reuse the same board/refresh/status; never collect a second independent FD board |
| `/api/first-quarter` | Verified free game catalog, explicit Q1 refresh/analysis/preview, optional Odds API path | Same catalog in four-option selector; original Q1 section remains intact |
| `/api/tickets` | Existing native Odds API full-game generation/calibration safeguards | Preserved; new adapter shares credential-scoped Odds API pause state |
| `/api/market-explorer`, free/manual, `/api/saved` | Cached analysis, comparison, manual quotes, archives | Preserved; new six-pick tickets use the same save endpoint/history |
| `/api/research-options` (new) | — | GET cache-only health/capabilities; POST `analyze-cache` or explicit `refresh-provider`, FULL/Q1 + verified game/ALL |

### Providers

- **FanDuelAPI**: existing authenticated REST adapter, five-page-per-endpoint bound, shared cache/cooldown. Partial `/props` coverage; explicit `game`/`q1` only. Independent data service, not direct verification against FanDuel Sportsbook. Freshness still requires original source/price evidence, documented delay limits, verified future kickoff and player checks.
- **The Odds API**: new adapter using the existing authenticated REST parsers. Server-only ODDS_API_KEY; FanDuel bookmaker only. Explicit FULL/Q1 refresh, separate period/selection snapshots, credential-scoped caches, 5-minute reuse, shared existing rate/account cooldown. A confirmed shared-parser bug that shortened valid Retry-After beyond 24 hours is repaired; a two-day pause regression proves it is respected. At most four uniquely matched games and five HTTP requests per refresh. Request count is **not credit cost**. No automatic refresh, retry, alternate-provider request or guessed market probe.
- **SportsDataIO/OddsLink**: explicitly disabled, no requests/credential collection. Exact odds contracts and account entitlements were not verified. Their names do not imply implemented/live coverage; issue phase 1 makes verified contracts/access a prerequisite to optional adapters.

Public unauthenticated sources inspected:

- https://the-odds-api.com/sports-odds-data/betting-markets.html — lists `player_pass_yds_alternate`, `player_rush_yds_alternate`, `player_reception_yds_alternate`, `player_receptions_alternate` and `player_pass_yds_q1`; Q1 rushing yards was not listed. New Q1 refresh requests only the existing documented passing-yards key, with no totals fallback or speculative Q1 keys. Returned supported Q1 player markets are parsed if actually supplied.
- https://fanduelapi.com/openapi.json — documents `/api/v1/props`, events, and rate/quota errors. It does not establish any account's current NFL/Q1 inventory.

These public documents establish contract support, **not account entitlements or available prices**. Native Odds API FULL requests use existing documented default full-game/alternate keys. Unsupported returned/requested categories remain unselectable; no missing line is synthesized.

## Verification, normalization and conflicts

Every displayed normalized quote carries provider, bookmaker, source event ID, verified NFL game ID, player/verified ID and team when obtainable, kickoff, market, FULL/Q1 period, actual line/side/American price, observation/source time, reported delay or unknown, status and provenance. Actual provider market lines are not replaced with fixed thresholds. Alternate market keys and AtLeast milestones retain actual side/line semantics. The Odds API batch as_of and delay are **unknown**, never replaced with the request clock or labeled zero/real-time. The actual quote update timestamp remains intact.

Provider schedule matches require reliable IDs or normalized teams plus verified UTC kickoff within the unchanged 60-second bound. Supplied contradictory odds-response event IDs, teams or kickoffs are rejected. Missing timezone, reached kickoff, stale/future observations, explicit suspended/closed/inactive rows and wrong bookmaker are excluded. Full-game observations cannot become Q1 markets.

Current quotes still require existing roster/team/injury/history, line-specific outcomes, probability/EV and role checks. No calibration thresholds were changed. Both modes are pregame **research**, never real-money recommendations. TEST MODE stays research and is saved as such. Q1 Safer/Balanced preserve existing price-implied estimation when Q1 history is absent; aggressive profiles require existing Q1 historical support. Missing evidence remains visible.

Price discrepancies stay in comparison inventory. For an identical verified contract, the engine conservatively selects the less favorable eligible price; contradictory team/opponent/kickoff evidence excludes that contract. Provider failures are independent. A failed explicit refresh returns HTTP 207 with a visible `refreshFailure` and analyzes only already-cached independent sources; it never silently refreshes another provider.

## Four-option engine and interface

New visible **Four-option multi-provider research** section: mode, all/individual verified game selector, per-provider health/error/cooldown, explicit refresh buttons, TEST MODE, four slots and exact quote comparison. Existing sections remain below it.

- Safer: highest estimated joint probability among eligible candidate combinations.
- Balanced: estimated probability and theoretical payout balance among distinct combinations.
- Aggressive: distinct higher theoretical price under existing aggressive checks, retaining room for a more expensive option where possible.
- Long Shot: highest remaining theoretical price above Aggressive; loss risk remains high.

The full-game engine uses existing eligibility/optimizer/simulation and a bounded search over actual alternate quote variants. Every ticket remains **1 QB, 2 RB, 2 WR, 1 TE, maximum three picks per game**. Single-game full-game selection shows explicit ineligibility. Q1 uses exactly three distinct players and may use one game, with unverified same-game acceptance/correlation/pricing warnings. Semantic ticket signatures exclude provider IDs so duplicated cross-source tickets cannot fill different slots. Fewer than four is valid when distinct eligible combinations or higher-priced aggressive options are unavailable; no padding.

Saving new full-game tickets preserves exact normalized leg provenance inside the existing leg JSON, including TEST MODE purpose. Existing archive/grading keys and data remain unchanged. Q1 remains research-only display/comparison; the existing six-leg save contract is not repurposed for triples.

## Test evidence and external limitations

Commands from repository root, Node 22:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

**Final results:** 219 application tests plus one startup test = **220 passed, zero failures**. TypeScript and production build passed. All **eight production browser workflows passed**, including the new multi-provider workflow. Final runs used `npm test`, `npm run typecheck`, `npm run build` and `npm run test:e2e`.

New tests cover both adapters through existing parsers, credential-isolated caches, FULL/Q1 separation, provider failure independence in both directions, source timestamps, alternate contracts, conservative conflicts/prices, quota pause/no retry, selected-game restriction, genuine four-option generation with sufficient explicit fixture markets, fewer-than-four states, duplicate players, secret exclusion, suspended rows, event-response contradictions, unchanged valid cache on invalid selection, and saved-ticket compatibility.

Browser regression uses production routes and isolated SQLite with synthetic external contracts: four FULL/Q1 options, exact source evidence, individual Q1 selection, single-game six-pick block, save/reload TEST MODE history, mixed-source comparison, failed-provider 207 with other-source options, no extra provider calls, and 412px phone/800px tablet layouts. Fixture screenshots: [phone](docs/screenshots/multi-provider-phone.png), [tablet](docs/screenshots/multi-provider-tablet.png). Labels explicitly say fixtures, not live odds.

No paid requests, credentials changes, purchases, automatic wagers or merges. No authenticated live coverage, production deployment or installability claim. Current provider credentials/credits, account entitlements, usable current Q1 inventory and free player-data access remain external requirements. Cached old quotes cannot establish new coverage; all unavailable/stale/unverified markets remain blocked.

## Using the existing application

Open the existing preview and use **Four-option multi-provider research**. Choose FULL/Q1 and ALL/individual game, optionally TEST MODE, then **Generate four options from independent caches**. This action does not call a paid provider. Each filled full-game card saves through the existing archive; inspect its pending entry in Saved Tickets.

Only **Refresh only fanduelapi/odds-api** opts into that provider's possible credit cost; its current credential-scoped pause is enforced. A failed refresh leaves the other source's existing eligible cache available and surfaces the failure. Use existing stale-preview/manual comparison sections when current coverage is unavailable. Do not interpret a configured key or a successful fixture run as verified live coverage.

If a provider is not configured, its own existing server-side environment variable must be set privately in the intended runtime (FANDUEL_API_KEY or ODDS_API_KEY) and the server restarted. This change does not create, overwrite or reveal .env.local, DB_PATH or credentials. SportsDataIO/OddsLink would require verified authoritative contracts and authorized account access before future adapter work; no setup/payment is requested for these disabled options.
