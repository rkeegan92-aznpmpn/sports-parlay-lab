# Issue #29 — PropLine as the third independent odds provider

Base: merged main `0191142` (PR #28). Existing two providers and four-option generators remain intact. No data migration, credential rewrite or saved-ticket/forecast edits.

## Contract and capability verification

Official sources inspected without authentication or account usage:

- [API docs](https://prop-line.com/docs)
- [Deployed OpenAPI](https://api.prop-line.com/openapi.json)
- [Complete reference](https://prop-line.com/llms-full.txt)

The deployed contract supports header `X-API-Key` authentication, NFL sport `football_nfl`, bulk and individual-event odds, bookmaker filtering and period filtering. The reference documents a free request allowance; actual account limits are **not inferred** from the key. Only reported quota headers are displayed, with a local recorded time.

Documented NFL model-compatible categories requested: passing yards/TDs/interceptions/completions/attempts; rushing yards/TDs/attempts; receiving yards/receptions/TDs; passing+rushing yards; anytime TD. Alternate and milestone ladders use those base keys. `player_reception_tds` maps to the existing receiving-TD model, while original identifiers remain in quote evidence. Other categories may exist but are not guessed into supported models.

FULL omits the request period and requires response `period:null`. Q1 sends `period=q1` and requires each response market's explicit `q1` bucket. These are period-specific player prices, never full-game splits or game totals. Current NFL Q1 player inventory, FanDuel-specific coverage and account entitlement remain **unverified** until an authorized actual response supplies them. Contract support does not establish availability.

No paid projections, historical/graded-results, SGP, bet-links, login, purchase or wagering endpoint is used. NFL player history, availability and probabilities still use the application's existing independently verified free-data pipeline; PropLine's paid statistics never substitute.

## Adapter, budgets and eligibility

- Server-only `PROPLINE_API_KEY`, configured privately in the nested app `nfl-parlay-lab/.env.local` or server environment. No `NEXT_PUBLIC_` key, query-string credential, secret logging or credential overwrite.
- ALL: one bounded bulk request. Selected game: at most two requests (event discovery and one matched event's odds). Fresh matching caches are reused for five minutes, including bulk-to-selected analysis. No automatic polling, retry, extra market probes or alternate-provider refresh.
- Independent credential/period/selection cache and provider-wide cooldown. Status is cache-only. Usage comes from allowlisted numeric daily headers and is labeled last reported, not current account verification.
- Known structured auth/plan/rate/daily errors are sanitized; no arbitrary messages, account blobs or upgrade links are stored. Honor Retry-After and relevant daily reset evidence. A daily quota reset does not extend a separate burst limit. Concurrency 503 retry times are respected. A failure blocks only PropLine's actionable cache; valid other-provider data remains usable.
- Exact future NFL schedule matching uses explicit IDs where supplied, normalized teams and unchanged UTC kickoff tolerance. Ambiguous, conflicting duplicate, live, past or mismatched events are withheld. Provider NFL player IDs/teams must agree with independent current roster evidence; provider claims never override it.
- FanDuel bookmaker only; other books are not relabeled. Keep original market, period, source player/team, line type, actual line/side/price, market update, last offered and last price-change evidence. Batch as_of and plan delay remain unknown when not supplied.
- Require explicit-zone price evidence within the existing 30-minute limit. A selection's `last_seen_at` must equal its market's latest delivery. Old `last_change_at` alone does not make a still-offered unchanged price stale; it cannot prove availability by itself. Missing/withdrawn/future/redacted/suspended/malformed prices remain excluded.
- Numeric N+ outcome labels become AtLeast N only when actually supplied. No fixed threshold ladders are created. Ambiguous milestone Over/Under semantics are excluded rather than silently changed into >=N. All original event/player/history/injury, position, duplicate-player and simulation/EV safeguards remain in force.

## Shared four options, interface and history

PropLine appears as the third health/refresh source in **Four-option multi-provider research**, and in provider comparison filtering. Display quota/error/cooldown, original quote identifiers, timestamps, line type and provenance. API prices remain independently sourced, not directly verified at FanDuel Sportsbook.

Safer, Balanced, Aggressive and Long Shot use the existing shared engine and genuine eligible pools. FULL still requires **1 QB, 2 RB, 2 WR, 1 TE; maximum three picks per game**. A single selected game cannot form a six-leg ticket. Q1 remains three distinct verified players and can use one game, with unverified same-game acceptance/pricing warnings. Fewer than four options is explicit when data or distinct eligible combinations are insufficient. TEST MODE is research; real-money validation thresholds are unchanged.

Full-game Save Ticket uses the existing archive and persists exact PropLine leg provenance in existing JSON. No ticket/forecast rows are written by refresh or analysis. Existing Q1/full-game generators, stale previews, free/manual research, comparisons and PWA remain available.

## Bounded verification procedure

From the repository root, Node 22:

```
npm --prefix nfl-parlay-lab run verify:propline
```

Default is **DRY_RUN**: no network requests or database writes. It reads existing provider status only if the matching local key/database exist. Actual local result here: `keyConfigured:false`, `providerRequests:0`, `writes:0`. The private Codespace's key/cache is not present here; no live access is claimed.

After configuring the key privately and choosing an actual game ID from the verified selector, this is an explicit opt-in that **can use up to two requests** from the account allowance:

```
npm --prefix nfl-parlay-lab run verify:propline -- --live --game=VERIFIED_NFL_GAME_ID --period=FULL
```

Replace `VERIFIED_NFL_GAME_ID` with that selected canonical ID. Use `--period=Q1` separately only if desired. ALL/bulk and invalid selections are blocked in the live verification script; it respects the existing persistent provider cooldown and may return a matching fresh cache without any call. It reports counts, source timestamps, last reported quota, parser exclusions and up to three actual source rows. It does not generate/save tickets or fabricate results, and source rows are explicitly not yet roster-validated recommendations. Restart the existing server after privately changing environment configuration; use the new cache-only generation action for normal analysis.

## Automated evidence

Commands from repository root:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

**Final results:** `npm test` passed **230 application tests + one startup test = 231**, zero failures. TypeScript and production build passed. All **nine production browser workflows** passed. `verify:propline` dry-run reported zero requests/writes and no configured local key.

New coverage: header auth and no query secrets; bulk/selected budgets and cache reuse; separate credentials/periods; missing Q1/full-game isolation; source timestamps/UTC equivalence/withdrawals; actual alternatives and N+ semantics; redaction/suspension/missing prices; event/duplicate/identity conflicts; positive and negative ESPN ID corroboration; independent provider failures in both directions; daily versus burst reset; quota without retry; four FULL/Q1 options and fewer-than-four; TEST MODE archival persistence; dry-run/live argument guards.

Production browser workflow verifies the third provider, four options in each mode, exact selected game/period, quota health, single-game FULL ineligibility, save/reload persistence and 412px phone/800px tablet layouts using explicitly isolated synthetic external contracts. Screenshots are labeled fixtures: [phone](docs/screenshots/propline-phone.png), [tablet](docs/screenshots/propline-tablet.png). Existing browser workflows remain in the suite.

No real provider/account request was made during tests. Public documentation checks were unauthenticated. No live coverage, account entitlement, sportsbook acceptance, production deployment or installability claim is made.
