# Pregame research generation

Pregame Best Six and Aggressive Six now generate from eligible upcoming-game FanDuel quotes without waiting for any captured forecast to settle. These remain research estimates: passing player/data checks does not establish probability calibration, positive true expected value, or profitability. Real-money recommendations remain locked until all existing chronological validation requirements pass. TEST MODE remains explicitly labeled and cannot unlock that gate.

## Behavior

- `/api/tickets` uses a read-only snapshot of already-settled calibration evidence. `/api/backtest` is also read-only. Neither endpoint initiates final-result retrieval or settlement.
- The supervised collector retains automatic capture and verified settlement while the app/Codespace is active. A stopped Codespace cannot collect or settle. The existing manual `npm run track:forecasts -- --settle-only` command remains available.
- Without calibration, the standard interface returns `pregame-research` tickets and explicitly reports `realMoneyRecommendationsLocked: true` and `validationGatePassed: false`. TEST MODE returns `test-research`. No code labels these as validated recommendations.
- Each ticket still requires exactly 1 QB, 2 RB, 2 WR, 1 TE, six unique players, and no more than three selections per game. Two supported games are therefore necessary. Best Six prioritizes estimated probability/history/EV. Aggressive Six is separately ranked and must exceed Best Six's theoretical product price, which also ensures different generated combinations. No unavailable alternate selection is invented to force two tickets.
- Observed opponent allowance rank is a small selection-ranking signal (only with at least four observed games); it does not alter recorded forecast probabilities. Missing matchup data is left unavailable. Player probability estimates remain independent of sportsbook prices and clearly unvalidated.
- Positive estimated leg EV and the existing positive simulation lower-bound ticket-EV check remain required; neither is proof of true positive EV. Injury, roster, player identity, historical sample, event and exact-quote verification are retained. Nonfinite probabilities or EV are now rejected explicitly.
- Only upcoming kickoffs and verified quotes within the existing 30-minute freshness window (maximum five-minute future clock tolerance) qualify. Each selection shows provider quote time and verification status. Missing/unsupported/failed markets and stale quotes stay visible as exclusions. Market availability is explicitly distinguished from quote eligibility.
- Saving archives preserves `pregame-research` and TEST MODE labels. Existing saved records are retained; archive storage never promotes validation status. No wager is placed. Combined prices remain theoretical products, not confirmed FanDuel parlay quotes.

## Verification

From the repository root, with Node 22:

```sh
npm test
npm run typecheck
npm run build
```

This managed workspace uses `PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH` before each command. Results: **109 tests passed, zero failures; TypeScript passed; production build passed**. Regression coverage includes pregame generation with zero settled outcomes, read-only calibration reads, separate higher-price Aggressive selections, full ticket structure, stale/missing/unverified data exclusions, nonfinite model output rejection, observed matchup ranking, unchanged recommendation lock, TEST MODE labeling, and saved pregame labels across database reopen.

Additional isolated production browser verification used:

```sh
PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH node --experimental-strip-types /workspace/work/browser-fixture.mts
python3 /workspace/work/calibration-lifecycle-test.py
```

Passed: pregame tickets visible before calibration and without selecting TEST MODE; saving Aggressive Six across page refresh; saving TEST MODE Best Six; both archives across app restart; collector failure/lease/shutdown/disabled/unreachable status. Ticket API responses in that browser harness are explicit synthetic fixtures; status and saved-ticket APIs use a real isolated temporary SQLite database. The harness is specific to this execution workspace; the repository's automated tests are the portable regression suite. No synthetic records enter the application database.

## Launch and remaining data limits

Use Node 22, install dependencies with `npm ci`, retain the existing server-only `ODDS_API_KEY` and persistent `DB_PATH`, then run `npm run dev` in Codespaces and open port 3000. For production use `npm run build` then `npm start`. Existing storage and collector settings still apply; see [DEPLOYMENT.md](DEPLOYMENT.md).

This execution workspace has no access to the user's authenticated FanDuel key or private Codespaces database. End-to-end authenticated live coverage cannot be claimed here. The prior free NFL/ESPN source probe and settlement evidence limits are documented in [ROUND_1_AUDIT.md](ROUND_1_AUDIT.md). Live tickets still depend on actual provider access, enough available eligible position markets over at least two games, verified historical records and positive estimated EV. A missing ticket now identifies data/eligibility/combination limits rather than requiring settled forecasts for research. No data was invented and no calibration threshold was changed.
