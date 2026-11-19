# PropLine Q1 investigation and repair

Base: merged main `36fc562` (PR #30). The working full-game implementation and all quote/availability/position/history/freshness safeguards are preserved.

## What was actually verified

The code requests `football_nfl`, `bookmakers=fanduel`, documented **base** player market identifiers, `period=q1`, and `max_age=1800`. ALL uses bulk `/v1/sports/football_nfl/odds`; an individual game discovers one uniquely matched event, then requests `/events/{id}/odds`. The [official documentation](https://prop-line.com/docs) describes these period parameters and explicit market buckets. There is no evidence here that guessed `*_q1` request identifiers should replace the base keys. FULL still omits period and requires explicit full-game response evidence.

Executed `npm --prefix nfl-parlay-lab run verify:propline` before any provider investigation. Actual output: DRY_RUN, `keyConfigured:false`, `providerRequests:0`, `writes:0`. This workspace cannot inspect the private Codespace's ALL or IND @ HOU November 19 caches. No authenticated request was made and no allowance spent. Therefore the exact live cause **cannot be declared provider-empty or incorrectly parsed** from the evidence available here.

## Confirmed defects repaired

1. A fresh empty ALL Q1 snapshot previously satisfied an explicit selected-game refresh. The function returned that ALL snapshot before event discovery, so selecting a matchup and pressing refresh could never exercise its individual-event endpoint during the five-minute cache TTL. Q1 selected refresh now reuses ALL only when it contains usable prices for that uniquely verified selected game. Otherwise the explicit action performs its existing maximum two requests. Cached analysis itself still makes zero provider requests. Matching Q1 data and the working FULL cache path retain reuse.
2. Old snapshots retained parsed rows and unique reasons but discarded raw counts. Zero retained rows could mean no provider events, no FanDuel book, only totals, mismatched periods, unsupported identifiers, timestamp/side rejection, failed event matching or later player eligibility. The UI could not distinguish these states. New collection records safe counts and request context at each stage; it does not retain arbitrary provider bodies or secrets.
3. Existing cached market identifiers and unique rejection reasons are now inspectable immediately, even for legacy snapshots. Their missing occurrence counts are never invented. Legacy raw counts remain explicitly unknown, so old zero parsed rows never become an unsupported empty-provider claim.

No period aliases, full-game-to-quarter conversions, price estimates or relaxed verification were introduced. No automatic retry, market probe, provider fallback or quota bypass was added.

## New diagnostics

In Q1 mode, **Inspect PropLine Q1 cache (no provider request)** reads existing evidence. Cache generation also displays the evidence alongside its player pipeline. The response distinguishes:

- No cache, older raw evidence unavailable, or unreadable diagnostic record.
- No events returned under the recorded request filters (not proof of permanent lack of coverage).
- No FanDuel bookmaker, no explicit requested-period markets, or only non-player/unsupported markets.
- Returned supported player markets with all prices rejected, including counted timestamp/withdrawal, suspension/redaction, side/line and schema reasons.
- Event IDs/teams/UTC kickoff that did not match the verified schedule.
- Parsed cache prices, current selected/fresh prices, player candidates after availability/identity analysis, and Best versus Aggressive eligibility.
- Historical row counts, dated Q1 history, injury snapshot presence and roster/injury exclusions when analysis was reached.
- Newer provider failure/pause: cached counts remain diagnostic evidence, not actionable odds.

Recorded request scope and actual cache scope are separate. Borrowed ALL evidence is labeled as whole-response evidence, not a selected-game API response. An empty result applies only to the recorded FanDuel/player-market/period/age filters. Strict Q1-only, future-game, timestamp, player and injury checks remain intact. Three distinct eligible players are still needed per triple.

New cache-only endpoint:

```
GET /api/research-options?proplineDiagnostics=1&period=Q1&game=ALL
```

The selected canonical NFL game ID can replace ALL. It reads persistent cache and provider status without an odds-provider or free-data request. Existing server database initialization is unchanged; it creates no ticket or forecast records. The existing dry-run verifier also reports cache-only Q1 evidence when a local key/database is available.

## Legacy-cache limitation and remaining external evidence

New raw counters are captured only on an explicitly requested successful collection. They cannot be reconstructed from an older zero-row snapshot. The inspector shows any retained identifiers/reasons immediately without requesting fresh odds. If those do not settle the cause, a later explicit selected-game refresh is needed to capture current response evidence; it may use the configured provider allowance and still cannot manufacture coverage. No such request was performed in this workspace.

The actual IND @ HOU response, its raw Q1 bookmaker/market/outcome counts and current account coverage remain unverified. A real absence of Q1 player prices requires provider publication/access, not weaker validation. API support for `period=q1` alone does not prove availability of that game's player markets.

## Verification

Node 22, repository root:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

**Results:** `npm test` passed 236 application tests plus one startup test (**237 total**, zero failures). TypeScript and production build passed. All **nine production browser workflows passed**, including unchanged four-option FULL generation and archival persistence. No real provider allowance was consumed.

Updated labeled fixture screenshots: [phone](docs/screenshots/propline-phone.png), [tablet](docs/screenshots/propline-tablet.png).

Regressions cover empty/other-game ALL caches followed by a selected Q1 refresh, matching cache reuse, unchanged FULL reuse, no-event versus rejected-player data, wrong/missing period, totals-only, unknown bookmaker, stale/withdrawn quotes, legacy counts unknown with retained original reasons, inspection without cache/archive mutation, stage-by-stage history/availability and missing-injury blocking.

The production browser fixture reproduces empty bulk Q1 followed by selected-event Q1 data, verifies the actual request budget and four distinct options, reads the cache-only inspector, preserves TEST MODE Saved Tickets on reload, and enforces quota without retry. Existing nine browser workflows include full-game generation and phone/tablet layouts. All provider responses in these tests are explicitly synthetic contracts, not evidence of live Q1 coverage.
