# Issue #24: Q1 quote collection and availability

Based on merged PR #23 (`a1a4e24`). Existing event/roster/UTC matching and the game selector are retained.

## What was verified

The pipeline is authenticated `/api/v1/events` + `/props` → allowlisted rows and page metadata → exact `q1` normalization → verified NFL event/teams/kickoff join → individual side schema → source/quote freshness → roster/injury/history → Q1 triples. Provider event and prop kickoff must agree with the free schedule within 60 seconds. Timestamps require an explicit zone; observations/snapshots must precede kickoff and pass the unchanged 30-minute limit. Selected games override residual date filtering; no past record is advanced into another week.

The independent provider board is on-demand, shared with the full-game generator, cached for five minutes and bounded at five pages per endpoint (at most ten calls per refresh). The forecast worker uses its separate Odds API capture policy or free settlement-only mode. Its heartbeat is not evidence that the independent Q1 board is refreshing. No automatic Q1 retries or paid fallbacks were added.

## Confirmed repairs

- Previously, quota versus rate-limit evidence was discarded after the first error; paused requests exposed a generic message. Store only an allowlisted failure category and HTTP status, retaining actionable authentication/access/quota/rate/provider-down advice across restarts. Legacy 429 records remain explicitly rate-or-quota unknown.
- Previously, a supplied quota reset without retry seconds could still produce a 24-hour pause even if reset was earlier. Honor explicit reset and Retry-After evidence, retaining the existing minimum 60-second cooldown and using the conservative fallback only when no deadline is supplied. Expiry permits explicit refresh; it never verifies a cached price.
- Surface cache-only provider access, retry time, maximum request budget and explicit-refresh-only collection mode in the Q1 status API/UI. Refresh is disabled until the recorded cooldown expires. Failed analysis reloads this cache-only status without requesting odds.
- A recent cached board cannot be returned as a successful refresh after a newer recorded failure.
- Report selected-game Q1 coverage independently of the total inventory: no selected games, no Q1 coverage, unsupported stats, no selected-game rows, invalid prices, stale/non-pregame prices or fresh price evidence. Provider failure overrides actionable availability. Cached previews remain non-actionable and keep original timestamps.
- The read-only audit now includes provider access/cooldown diagnostics when a matching local board exists. No record migration or database reset is involved.

## Actual-data limitation

Executed `npm --prefix nfl-parlay-lab run audit:first-quarter` in this workspace. Result: `CACHE_UNAVAILABLE`, `keyConfigured:false`, `networkRequests:0`, `writes:0` (exit 2). The private Codespace's credential and November 13 cache are not present here. No real authenticated/paid odds request was made, so no actual currently eligible Q1 quote is claimed.

The issue's reported 148 rows (140 kickoff rejections and eight unmatched events) are not evidence of current November 22 Q1 prices. Existing regressions reproduce those categories using explicitly synthetic records. Genuinely reached kickoffs stay rejected; future unmatched records require a unique verified schedule join. A provider quota pause and stale board cannot be fixed by reusing previous-week prices. The remaining external requirement is a successful explicit provider response, after its documented reset, containing open Q1 player prices for the selected verified upcoming game with adequate timestamp evidence. If absent, coverage remains unavailable; no full-game markets/totals/quarter splits substitute.

## Verification

From repository root, Node 22:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run test:e2e`

**Results:** `npm test` passed 210 application tests plus one startup test (211 total), zero failures. Typecheck and production build passed. All seven production browser workflows passed.

Updated labeled fixture screenshots: [tablet](docs/screenshots/q1-game-selector-tablet.png), [phone](docs/screenshots/q1-game-selector-phone.png). These show synthetic test evidence, not live quotes.

New regressions cover durable quota/rate distinction, exact reset and HTTP-date Retry-After, pause without additional calls, safe recovery, preserved original boards, provider outage status, missing selected-game coverage and expired versus fresh prices. Existing Thursday/Sunday/Monday matching, UTC offset, stale previous-week, mismatch, selected-matchup and full-game/Q1 workflow regressions remain. Browser coverage verifies quota status and disabled refresh, with cached preview still available. All odds traffic in tests uses isolated external-provider fixtures; generated odds are not presented as live coverage.
