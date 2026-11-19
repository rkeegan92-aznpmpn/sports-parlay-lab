# Research grading and historical simulation rules

These are explicit research evaluation rules, not certified sportsbook settlement. FanDuel market-specific cancellation, participation, stat-correction and same-game repricing rules can differ. No wager is placed or sportsbook payment inferred.

## Saved upcoming tickets

Generate and **save** Best Six/Aggressive Six before kickoff. Each six-leg ticket retains its original player identity, position, teams, opponent, market, side, line, price and kickoff. Generation returns Pending; saving atomically creates a pending grading record. Original selections and forecasts are never overwritten by grading. Changed grading states are atomically recorded in `saved_grade_events`; unchanged checks do not create duplicate grading events. Unsaved options are not durable tracked tickets.

The active collector checks final results every approximately 15 minutes, independently of paid odds capture. Use `COLLECTOR_MODE=settle-only` to avoid paid requests. A stopped Codespace cannot run the collector. The dashboard polls stored evaluation every 15 seconds and never performs final-result retrieval itself.

- **Win/Loss:** full-game statistics, including overtime, against the saved line. Over is strictly greater; Under strictly less. Supported yardage/count categories use the exact statistic; anytime touchdown Yes means at least one scored rushing/receiving/return touchdown, not a passing touchdown.
- **Push:** actual statistic equals the saved numeric line. It is neutral, never a loss.
- **Void:** requires explicit `didNotPlay: true` evidence in a matched final ESPN player box score, or equivalent verified nonparticipation data. A missing row, missing market, zero yards/attempts, or injury listing does not establish DNP. Conflicting DNP/positive-stat evidence stays Pending.
- **Pending:** missing/ambiguous player/game identity, unavailable provider, invalid capture clock, missing statistic, incomplete game, postponed/cancelled event or conflicting final status. Cancellation alone does not establish the particular FanDuel ticket's void rule; no time-limit policy is invented.
- **Final proof:** nflverse statistics need a matching scored regular-season schedule row and the existing conservative six-hour post-kickoff check window. Explicit matched ESPN final box scores can settle earlier. The six-hour window alone never establishes a final result. ESPN's explicit non-final/postponed status overrides conflicting finality. Capture must precede the resolved actual kickoff.

Each leg is checked independently as its game becomes eligible. A verified losing leg marks an **early loss**, but `finalized: false` remains until all six legs have results. The collector continues tracking the remaining legs. No losing leg plus unresolved results can become a win. Completed evaluation requires all relevant legs finalized.

If every active leg wins, pushes/voids are neutral and the ticket is an adjusted win. If all six legs push/void, the ticket is Void. Any confirmed loss makes the ticket Loss. The optional adjusted decimal is only the product of recorded non-neutral leg prices (all-neutral product 1); it is **not FanDuel's combined quote or verified payout**, especially with correlated same-game legs. Missing prices leave it unavailable.

Legacy grades are retained in storage; records without the new finalization/actual-stat proof are rechecked instead of silently treated as newly verified wins. Damaged/incomplete old ticket details remain retained/ungraded.

## Historical BACKTEST simulations

Future slates are excluded from historical output. Historical results live in `historical_backtests`, separate from `saved_tickets`, `manual_quotes` and `forecast_snapshots`. Running/reloading a backtest cannot create, overwrite or duplicate upcoming tickets or live calibration outcomes. The existing captured-forecast calibration report remains separate and its thresholds are unchanged.

The initial historical strategy scope is regular-season passing yards (QB), rushing yards (RB) and receiving yards (WR/TE). Each weekly slate uses a prediction cutoff **one hour before its earliest kickoff**, so later Sunday games cannot use information learned after the Thursday opener. Players/team/position come from prior records only, not target box-score availability or today's roster. At least five prior supported games are required; the last ten form the estimate. Earlier games are eligible only after a conservative **24-hour post-kickoff data-availability assumption**. No current injury/roster data is used as if it were historically known.

Prediction freezes its selected identities, game IDs, lines, probability and training IDs before target outcomes are passed to the evaluator. Tests mutate target/future statistics and verify the predictions remain identical; a poisoned future-stat getter verifies training cannot read it. Missing target players remain Pending, not losses or retroactively removed candidates.

- Recorded current-model pregame quote contracts with verified final-result identity/kickoff provenance can provide a real historical line/individual price only when identity/game/market match, capture is at or before the prediction cutoff, and the quote was fresh when captured. Post-cutoff quotes cannot price an earlier prediction.
- Without such a contract, the strategy uses explicitly **model-derived benchmark lines**, not purported historical FanDuel lines: half-yard Over thresholds `max(0.5, floor(prior quantile) + 0.5)` at the prior 25th/60th percentiles. Probabilities use the existing Beta(2,2)-smoothed empirical outcome estimate. These benchmark results measure this specified simulation, not actual sportsbook performance.
- Best Six ranks higher estimated probability; Aggressive Six ranks lower estimated probability with overlap penalties. Both enforce 1 QB / 2 RB / 2 WR / 1 TE, unique player IDs and at most three from a game. Distinct valid combinations are required. Without prices, higher historical Aggressive payout is **unknown**, not fabricated.
- Individual unpriced legs have `odds: null`. Verified-price flat-stake leg ROI is computed only for the explicitly priced decisive subset and reports its sample. Combined ticket ROI, payout and EV remain unavailable without a verified combined historical quote.
- Leg metrics deduplicate the same player/game/market/side/line across both selections, and separately show decisive, push and pending counts. Position/market win rates use decisive outcomes only. Complete-ticket win rate excludes unresolved and all-neutral tickets; early losses with unresolved legs remain outside its finalized denominator.

**External limits:** this free data archive does not provide historical roster/injury snapshots or original publication/revision timestamps for each statistic and schedule. The 24-hour availability assumption is not an audited point-in-time archive. A strict production-quality, point-in-time sportsbook backtest needs those archives plus authentic timestamped odds and combined prices. No simulation here unlocks model validation or claims profitability.
