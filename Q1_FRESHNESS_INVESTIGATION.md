# Q1 freshness investigation

Markets and matched games do not establish fresh prices. Each supported Q1 row now exposes `diagnostics.priceChecks` in `/api/first-quarter` and the Q1 dashboard: raw observations/as_of, normalized UTC instants, verified/provider kickoffs, current evidence ages, fixed thresholds and failed fields. This reads the existing cache; no additional odds calls are introduced.

Verified code defects repaired:

- JavaScript Date.parse rejects explicit ISO hour-only offsets such as +00. A strict shared parser now canonicalizes explicit ISO offsets (+HH, +HHMM, +HH:MM or Z) without guessing a timezone. Invalid calendar dates and timezone-less dates are rejected. Team/event matching retains the existing 60-second tolerance and home/away identity checks.
- The provider documents source_age_seconds as measured from meta.as_of. Cached evidence must age by elapsed time since as_of. Previously the reported age remained frozen. The effective age now includes this elapsed interval; plan delay is not added again.
- Invalid supplied metadata can no longer disappear into nullable fields. Unknown/stale/down health remains ineligible. Canonical status case/whitespace is normalized only for documented values.
- Q1 observations and response as_of must strictly precede the verified schedule kickoff, even if a later provider kickoff is within matching tolerance or timestamps fall within clock-skew tolerance.

Freshness remains at most 1800 seconds, with the existing 60-second future-clock tolerance. No fresh timestamp is inferred from retrieval time, global source status, another market, or full-game odds. The six-pick ranking/composition, credential handling, cache TTL, saved tickets and database schema are unchanged.

Provider documentation reviewed without authenticated odds requests: https://fanduelapi.com/fanduel-api-real-time.md and https://fanduelapi.com/products/coverage.md (as_of/observation/source-age semantics). Public global status cannot prove freshness of individual prices and is never used to fill missing evidence.

## Verification scope

Regression inputs are explicitly synthetic contracts, plus the existing recorded public schema fixture (which lacks freshness proof and remains ineligible). They do not demonstrate live account coverage. This workspace cannot inspect the private Codespace board/database; therefore it cannot claim these timestamp variants caused that specific zero-price snapshot. The added trace identifies the actual failed field from the existing cache. A genuinely old price or missing source-health proof must remain blocked until the provider supplies fresh complete evidence. No account authorization, payment or user secret is requested.

Commands from the repository root, Node 22:

- `npm --prefix nfl-parlay-lab test`: 170 application tests passed.
- `node --test scripts/*.test.mjs`: 1 startup test passed.
- `npm run typecheck`: TypeScript validation.
- `npm run build`: production compilation.
- `npm run test:e2e`: production HTTP/browser workflows for manual entry, grading, FanDuel six-pick generation/persistence, and Q1 generation/freshness diagnostics; isolated provider fixtures, phone/tablet viewports, no paid calls.

See the pull request for final execution results. Production browser tests must run after rebuilding; an initial run against an older production artifact failed the new priceChecks assertion. A subsequent test assertion incorrectly expected this adapter’s evidence on the separate legacy Odds API response; the assertion was scoped to the FanDuel adapter, and the full browser suite was rerun after rebuilding.
