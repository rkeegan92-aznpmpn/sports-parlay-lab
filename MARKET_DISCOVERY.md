# Player-prop discovery and research expansion

Open **Player Prop Market Explorer** and choose **Discover cached markets and analyze**. This is an explicit read of the existing credential-scoped board plus free statistical sources; it never refreshes paid odds. The existing fetch button, five-minute provider cache, cooldowns, six-pick/Q1 generators, stale previews, manual comparisons, saved tickets and PWA remain in place.

## Discovery and contract semantics

- Inventory every player row returned in the cached NFL `/props` feed, including unknown stats/periods, unmatched events and missing side prices. Group coverage as partial: absence from this feed is not evidence a market is absent from FanDuel.
- Preserve original provider IDs, athlete ID when supplied, athlete/team, verified event/kickoff, period, stat, side, line, American price, source and observation/as_of timestamps. Unknown schemas are visible and never guessed into eligible picks.
- Every actual offered numeric line is shown. There is no fixed ladder of prices or thresholds. A plus-suffixed provider line or explicit AtLeast contract expresses `actual >= N`, retains N and has no integer-line push. `Over N` still requires `actual > N` and pushes on equality. Missing prices remain unavailable. A threshold is not silently converted into a different displayed line.
- Passing/rushing/receiving yardage, receptions, attempts, completions, interceptions, and passing/rushing/receiving touchdowns have explicit semantic/stat-column mappings. Unrecognized provider stats remain unmapped. The paid Odds API request-key list was not expanded: additional supported semantics are separate from paid request defaults.

## Analysis and selection

Full-game history uses only present, finite historical columns matched to dated unique player/game records. Q1 count markets require the corresponding PBP flags and actor IDs; missing columns or ambiguous attribution cannot become zero-stat history. Quarter/half player analysis uses that period's actual PBP slice. Q1/full-game statistics are never used to stand in for another period. Cumulative scoreboard values are not reused as non-Q1 period team totals; that context remains unavailable.

Rows show uncalibrated estimates, samples, recent hit rates, opponent context when supported, active-roster/injury evidence and explicit missing-data/eligibility reasons. Date/time and source age continue advancing on screen. Fresh independent-provider timestamps, stale research worksheets and user-observed prices have distinct provenance. None establish sportsbook acceptance or validated EV.

The explorer produces separate Sunday **Best Six / Aggressive Six** options from eligible fresh independent and/or user-observed full-game contracts: exactly 1 QB, 2 RB, 2 WR and 1 TE, max 3 legs per game, no duplicate verified athlete. It also produces distinct **Best / Aggressive Q1 triples** when eligible. Other periods can be analyzed but never leak into those ticket pools. Existing probability/history/role/injury/freshness/calibration restrictions still apply, including conservative long-shot support rules. Same-game combinations are theoretical; actual FanDuel permission and combined pricing must be confirmed independently.

Filters cover game, team, athlete, verified position, period, prop category, stat and line/threshold. Filters inspect the inventory; ticket sections retain the explicitly labeled Sunday slate.

## Manual coverage fallback

Expand **Enter an actual FanDuel observation**, choose the verified upcoming game, and enter the actual athlete/team, period, stat, side, line, American odds and local observation time. Confirm you saw that exact contract in FanDuel. No login is requested. Server validation checks team/game, price/line format and observation age; analysis separately checks athlete identity, history and availability.

Entries persist in the additive `discovered_manual_props` table. They never overwrite API snapshots, previous saved tickets, forecasts or existing manual comparison records. A changed or unsupported period/stat remains visible with limitations. Manual input is labeled **MANUALLY OBSERVED BY USER — NOT API VERIFIED**. Existing per-leg FanDuel comparison/recheck controls remain separate and preserve their history. No automatic betting occurs.

## Provider and data limitations

The configured independent provider documents `/props` and a separate credit-consuming `/markets` endpoint. This change inventories the actual existing `/props` snapshot. It does **not** silently call `/markets`, probe guessed keys, exhaust additional pages beyond the existing safety budget, retry a failed paid provider, or purchase coverage. Markets offered only through a different endpoint or not exposed by the provider need actual manual observations or a separately authorized integration backed by a verified response schema. Unsupported selection representations, first-scorer and other unmapped exotic markets remain visible/unsupported; no result rule or odds is invented.

Live account coverage was not verified in this workspace. Automated external data uses isolated synthetic contracts. Real periods/stats without sufficient uniquely identified historical records, current injury coverage, or valid prices remain ineligible. Estimates and EV remain uncalibrated research only.

## Verification

From repository root with Node 22:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Results: **193 automated tests passed** (192 application + 1 startup), TypeScript passed, production build passed, and all **six production browser workflows passed**.

Tests cover arbitrary alternate lines, exact threshold/push rules and settlement, column-presence guards, period-specific PBP isolation, unknown/missing markets/odds, stale data, matching/conflicting IDs, injury exclusions, manual threshold provenance, distinct ticket structures, zero extra odds requests and persistence. The browser suite includes all existing workflows plus the explorer's production HTTP/UI flow, eight filters and phone/tablet layouts.

Screenshots use explicitly labeled test fixtures, not live sportsbook evidence:

- [Tablet](docs/screenshots/market-explorer-tablet.png)
- [Phone](docs/screenshots/market-explorer-phone.png)
