# Issue #17 — cached research and manual FanDuel comparison

## What changed

- Full-game and First Quarter Parlays each have an explicit **Preview cached … research (stale allowed)** action. It reads the existing credential-scoped FanDuel cache. It does not refresh paid odds or auto-switch providers.
- Preview responses are separate `preview` objects with `actionable: false`, labeled **STALE — RESEARCH PREVIEW ONLY**. They return no regular tickets. Original player/game/period/line/side/odds/timestamps are retained, including the exact source freshness failure. Age includes source evidence and continues advancing on screen.
- Six-leg previews retain exactly 1 QB, 2 RB, 2 WR and 1 TE, no duplicate player and at most 3 legs per game. Best Six ranks supported estimates; Aggressive Six ranks captured theoretical prices. Q1 previews contain three distinct eligible players, use only actual Q1 markets, and require Q1 history for the aggressive option. No full-game substitution.
- Current roster, injury, historical identity, supported market, event/kickoff and statistical support checks still apply. Missing coverage can block previews. Quote timestamps are never rewritten to make them appear fresh. Previews are not bet-ready, cannot bypass calibration, cannot be saved as forward-tracked tickets, and do not generate settlement forecasts.
- Regular generation still requires API evidence within the existing 30-minute cutoff; unknown/stale/down source health and invalid metadata remain blocked. A preview does not change the strict counts or make a stale price API-actionable.
- Q1 diagnostics group failures into freshness, unmatched game, selected-window exclusions, kickoff, missing player/history, player availability, eligibility, unsupported market, quote schema and other provider errors. Detailed evidence remains available.
- Default API/UI selection is the next Sunday in NFL Eastern civil time (including Sunday night after UTC rollover). Future Sundays are excluded. Explicit all-upcoming/date filters remain available. The collector and saved records are not rescheduled or changed by this display filter.
- A failed or quota-paused provider does not prevent an explicit non-actionable cached preview. It still blocks regular generation. Existing provider cooldowns remain in force; no automatic quota-exhausted retry is introduced.

## Manual comparison

1. In a generated full-game ticket, generated Q1 ticket or cached preview, expand **Compare … in FanDuel** for each leg.
2. Open the FanDuel app independently. Check athlete, game, first-quarter versus full-game market, side, exact line and American price. No sportsbook login is requested by this application.
3. Enter the observed fields and local observation time. Confirm you actually compared the market, or mark it unavailable. A changed line/price is recorded as changed, not silently inserted into the selection.
4. Save the comparison. A fresh exact match is labeled **MANUALLY VERIFIED BY USER**, never API VERIFIED. Changed/unavailable checks are explicit. Matching checks expire after 30 minutes and at pregame kickoff. Recheck just before any wager; no automatic betting occurs.
5. Reloading/restarting preserves comparison history. Comparisons live in the additive `manual_quote_checks` table, separate from provider odds, saved tickets and forecasts. Each recheck appends a record; existing records are not overwritten. The server validates the expected contract against the original cached provider row and verified free schedule before accepting an observation.

A manual check does not replace the provider price, recompute a recommendation, establish player health or sportsbook parlay acceptance, or unlock calibrated recommendations. Current-price EV is unavailable in stale previews. Estimates are explicitly uncalibrated and conditional on captured data.

## Verification

Node 22, repository root:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Actual results: **178 tests passed** (177 application tests plus 1 startup test), TypeScript passed, production build passed, and **all five production browser workflows passed**.

The unit/integration suite includes stale versus strict/fresh paths, both ticket structures, exact unchanged prices, grouped no-eligible-Q1 causes, missing injury coverage, malformed timestamps, market mismatch/suspension, Sunday UTC/DST boundaries, changed/unavailable/expired manual checks, database reopen, no saved-ticket/forecast mutation, and quota cooldowns.

The production browser suite includes the existing manual, grading, full-game FanDuel and Q1 workflows, plus `research_preview_workflow.py`: Sunday-only previews after a provider failure, manual comparison/recheck, reload and server-restart persistence, zero odds requests beyond initial board acquisition, preservation of an existing saved ticket, and 412px phone/800px tablet overflow checks. External providers use explicitly isolated synthetic fixtures. These tests do not establish current live sportsbook coverage.

## Data limitations

The owner's quoted 148 Q1 rows/278 prices are evidence of captured markets, not evidence of live availability or eligible players. This workspace cannot inspect that private Codespace snapshot or use its secret. Real cached rows can still fail current roster/injury/history/identity checks; the new grouped diagnostics report why without creating replacements. Fresh API prices require the provider to return complete fresh evidence. Manual checks require the user to actually compare the relevant FanDuel app market; software cannot manufacture that observation. No subscription, secret, existing database path, saved ticket or forecast was changed to satisfy these checks.
