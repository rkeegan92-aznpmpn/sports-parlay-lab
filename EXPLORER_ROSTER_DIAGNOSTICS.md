# Explorer roster identification and eligibility repair

## Confirmed defects

- Player labels were derived only from successful statistical candidates. Stale/unsupported quotes or missing history could leave a real player's position unresolved even when a free roster independently verified it. Provider-reported teams could appear in headings without roster proof.
- An unstructured `limitations.length === 0` filter mixed display notes and selection blockers. The interface offered slot shortages without the validation stages that caused them.
- One stale manual quote could reject an entire manual analysis batch. Manual candidate association could also select a different market or observation time when other fields matched.
- Passing-plus-rushing and explicitly named alternate stat aliases lacked semantic mappings.

## Implementation

**Identity:** Current ESPN event-team rosters are checked independently of odds freshness, stat coverage and supported-market type. Verify a unique NFL player ID, canonical name, team and QB/RB/WR/TE position. Reject mismatched team responses, ambiguous names/IDs, conflicting active records and failed/incomplete roster coverage. A single current active record can supersede an explicitly inactive old-team record for the same ESPN ID. Inactive players can have known identities while remaining excluded. No position is inferred from a prop type; no unknown provider-ID namespace is assumed to be ESPN.

**Audit:** Preserve reported name, team, position, IDs, market, period, line and kickoff separately from resolved identity. A provider team that conflicts with the verified roster is a contract blocker, not silently corrected. Unmatched games retain explicit diagnostics rather than guessed roster/game links.

**Display:** Verified headings use `Name — RB | Team: WAS`; others use `Name — Roster check needed`. Readable cards show verified matchup/kickoff, category/period, exact side/threshold/odds, source, timestamp, freshness and selection status. Original provider fields, roster IDs/matches, injury snapshots, pipeline evidence and detailed exclusions live in an expandable section.

**Eligibility:** Structured per-prop checks replace note-string filtering: market, exact game/prop kickoff, roster identity, active status, injury coverage, available price/line, source freshness, provider access, exact historical model and Sunday slate. Historical team/position/player identity must agree with the independently verified roster. When earlier failures prevent establishing a model, history is explicitly **not evaluated**, not asserted missing. Counts distinguish independent step passes from the ordered remaining funnel, props from athlete/name groups, and Best/Aggressive position counts. Multiple reasons may apply to one prop; counts are not summed as distinct players.

**Provider access:** Cache-only diagnostics expose configured/snapshot state, last recorded safe HTTP status and retry pause. HTTP 429 is labeled rate/quota unless more specific evidence exists; no live account access or quota balance is inferred. No paid retry is introduced.

**Markets:** Discover existing rows unchanged, with aliases for actual alternate yardage stats and passing-plus-rushing. The combination requires both real weekly stat columns, or attributable period-specific passing/rushing PBP; missing components do not become zero outcomes. Exact original thresholds, prices and periods remain intact. Unknown provider markets remain visible/unsupported. No extra market endpoint or paid request keys were added.

**Manual input:** Exclude stale/unmatched observations individually. Match exact player, event, market, side, line, price and observed time. Keep observations and audit history unchanged. Roster/quote matching does not promote manual or independent prices into verified sportsbook odds.

## Verification

Node 22, repository root:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Results: **201 automated tests passed** (200 application + 1 startup), TypeScript passed, production build passed, and all **six production browser workflows passed**.

Regression coverage includes verified/unverified identities, duplicate names and IDs, inactive players, trades, wrong-team roster responses, missing/ambiguous games or prop kickoffs, stale odds, missing injuries, failed provider access, model position conflicts, individual manual expiry, market/time matching, alternate/combined markets and Q1 isolation. Existing generators, saved-ticket/grading flows, cached previews, comparisons, quota safeguards and PWA remain in the regression suite.

Public free-source check: ESPN `/teams/wsh/roster` returned HTTP 200, season 2026, team WSH, and Austin Ekeler as RB, ID `3068267`, Active roster status. The app canonicalizes WSH to WAS. This is identity/schema evidence, not proof of health, an upcoming-game contract or sportsbook odds.

Screenshots use explicitly labeled synthetic test fixtures:

- [Verified player card](docs/screenshots/explorer-verified-player.png)
- [Tablet diagnostics](docs/screenshots/market-explorer-tablet.png)
- [Phone diagnostics](docs/screenshots/market-explorer-phone.png)

## Remaining external limitations

The owner's private Codespace board and API credential are unavailable here; the exact live reason mix must come from its new diagnostics. Real stale/absent prices, exhausted provider access, unreported injuries, ambiguous current rosters or missing dated history remain legitimate blockers. A roster match alone cannot create six eligible picks. Independent coverage stays partial and uncalibrated; no FanDuel price/period/result is fabricated or represented as sportsbook-verified. Existing records, secrets, database path and PWA configuration are preserved.
