# Issue #13 — zero eligible first-quarter props

## Evidence and conclusions

**The independent provider can expose genuine Q1 player props.** Its [NFL props documentation](https://fanduelapi.com/fanduel-nfl-props) describes per-period records. Previously saved public sample responses use `event_id`, `starts_at`, `stat`, `period: "q1"`, `market_status`, `observed_at` and separate over/under American prices; player team may be null.

One additional **documented keyless public sample** was checked during this investigation. At `2026-11-13T00:45:18.975Z` (November 12, 4:45 p.m. Pacific), it reported an open WAS @ NYG J.J McCarthy **Q1** passing-yard line of **43.5**, with both sides **-114**. The separate full-game record was **201.5**; neither value was substituted for the other. The public sample reports a 300-second delay. It is limited, is not an authenticated `/props` account response, and was not used to create tickets, history, forecasts or performance records. One sampled player cannot prove three eligible Q1 players exist. **Zero authenticated/paid odds requests or private credits were used.**

**The exact private Codespace failure cannot be certified here.** This workspace has no effective FanDuel credential or matching cached board, and GitHub repository Codespaces access returned HTTP 403 (`Resource not accessible by integration`). The owner's working credentials were not changed or requested. No assumption is made that the owner's account lacks Q1 coverage. A global board with no recognized Q1 rows is evidence about that snapshot, not proof that the service never supports Q1.

## Confirmed code bugs and fixes

- **Date rollover:** Q1 analysis previously used the full-game UTC date filter. WAS @ NYG's scheduled kickoff is **November 12 at 5:15 p.m. Pacific / 8:15 p.m. Eastern**, which is **November 13 at 01:15 UTC**. An explicit `date=2026-11-12` could remove the game. Q1 now uses the NFL Eastern calendar date; six-pick date behavior is unchanged. If the production request used `date=ALL`, this particular bug does **not** explain its zero count.
- **Case-sensitive Q1 tokens:** the Q1-only path now normalizes case/whitespace of the documented `q1`, stat and open-status tokens. It never maps full-game, Q2, undocumented periods or unrelated stats to Q1. The saved real schema already uses lowercase; no claim is made that the owner's snapshot used different casing.
- **Incorrect role mapping:** Q1 rushing incorrectly required RB and Q1 receiving required WR/TE, even though the existing Q1 PBP loader already supports QB rushing and RB receiving. Both candidate construction and roster verification now accept those legitimate market/position pairs. Wrong-position markets, unverified players, duplicate players and missing Q1 history remain excluded; no six-pick rules or full-game values were imported.
- **Overbroad coverage messages:** raw Q1 rows, supported Q1 stats, missing period fields, matched events, selection filters, price/schema failures, stale/unknown source metadata and player eligibility are now reported separately. The UI no longer hides the rejection stage behind a generic zero or infers global provider non-support from absent mapped rows.
- **Opaque eligibility failures:** roster/team/position, injury-report, history and final ticket eligibility exclusions carry explicit per-player reasons. Probabilities, injury checks, historical minimums, freshness and pre-kickoff gates are not relaxed.
- **Optional provider speculation:** the [current Odds API NFL market list](https://the-odds-api.com/sports-odds-data/betting-markets.html) explicitly lists `player_pass_yds_q1`, but not the Q1 rushing/receiving keys previously bundled and retried. The optional request now starts with the documented passing-yard key and does not repeat rejected player requests or probe guessed keys. Verified returned legacy Q1 keys remain recognizable. Separate Q1 totals remain separate and cannot populate player triples.

The provider's [general markets endpoint](https://fanduelapi.com/products/game-markets) documents a `period=q1` filter. The normalized `/props` endpoint's documented filters do not include `period`. No undocumented query parameter or guessed general-market response parser was added to manufacture coverage. Actual account entitlement and response coverage remain unverified; no speculative paid probing was performed.

The public provider event uses `01:16 UTC`, while the verified schedule uses `01:15 UTC`. This fits the existing one-minute identity tolerance; that tolerance was **not widened**. The verified schedule remains the pregame cutoff. At or after `01:15 UTC`, new pregame tickets must be blocked even if an older board still has open prices or the provider timestamp is one minute later.

## Visible diagnostics and offline audit

The First Quarter Parlays section now displays:

- Raw period counts and Q1 stat identifiers; raw Q1 rows versus matched side-price counts.
- Matched games, selected prices, fresh prices, projected props, availability-qualified props, final eligible props/players and aggressive support.
- Original snapshot/check times, NFL Eastern-date semantics, provider and verified UTC kickoff times, and pregame/matching state.
- Stage-specific rejection reasons, including missing source-health proof, age over 30 minutes, invalid/missing prices, event mismatch, date/game filtering, unavailable player or injury coverage, and insufficient historical support.

These diagnostics are returned from the existing cached-generation API and spend no odds requests. Unknown metadata remains unverified: missing source-health fields are **not** silently marked healthy. Sample or old public prices are never promoted into current recommendations.

`npm run audit:first-quarter -- --date=2026-11-12 --game=2026_10_WAS_NYG` was executed here. It returned `CACHE_UNAVAILABLE`, exit 2, with **zero HTTP requests and zero writes**. The command opens the existing SQLite database read-only, uses only cached schedule/board data and prints sanitized diagnostics. Offline player eligibility is explicitly **not evaluated**. It never rewrites `.env.local`, DB_PATH, tickets, forecasts, credentials or cache. On the actual credential-bearing Codespace it can inspect that stored board without spending provider credits; cached schedule age is disclosed rather than asserted current.

## Executed verification

| Command | Result |
| --- | --- |
| `npm test` | PASS: 163 application tests plus one startup test; zero failures. Six new tests exercise real observed fixture schema, null teams/period separation, date rollover/DST, QB rushing/RB receiving verification, full-game date regression, missing/unsupported coverage, token normalization, source-health failures, stale quotes, invalid prices, event mismatch and kickoff. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `npm run test:e2e` | PASS: all four isolated production browser workflows. Existing six-pick generation, saving/reload/restart, grading and FanDuel research remain passing. Q1 additionally verifies visible raw/matched/eligible counts, present-but-freshness-blocked rows, no automatic paid fallback, cache reuse, honest optional passing-only coverage limits and phone/tablet layouts. |
| `git diff --check` | PASS. |

Browser providers use clearly isolated contract fixtures, not live priced recommendations. No database migrations or changes to the full-game FanDuel endpoint, secret handling, cache TTL, coalescing or cooldown policy. Full-game rows and prices remain untouched. Existing Q1 three-leg, distinct-ticket and pregame safeguards remain intact.

The confirmed fixes and diagnostics are reviewable. Whether the owner's particular zero came from absent account/snapshot Q1 coverage, filtering, metadata or unavailable players remains unresolved until its actual cached diagnostics can be read. No payment, new subscription or credential replacement is recommended on the evidence available.
