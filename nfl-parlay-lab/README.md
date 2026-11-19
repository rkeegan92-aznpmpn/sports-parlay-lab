# NFL Parlay Lab

Research tool that builds two six-leg player-prop tickets (1 QB, 2 RB, 2 WR, 1 TE) from FanDuel odds:
**Best Six** (highest estimated joint probability) and **Aggressive Six** (higher payout from supported legs only).
It also offers opt-in **Best 1Q Triple** and **Aggressive 1Q Triple** generators from live FanDuel first-quarter markets. First-quarter requests are separate and cached per event. The app prioritizes Q1 player passing, rushing, and receiving-yard markets; only when no player lines are returned does it request Q1 team/game totals, displayed separately and never used as player props. Unsupported markets and unavailable history are reported instead of substituting full-game prices or stats.
Best Six requires at least a 50% historical-only estimate and five verified games per leg; Aggressive Six requires at least a 30% estimate and six verified games. Both require positive estimated single-leg EV, a fresh quote, ESPN roster/team verification, and recent role usage in at least three of the last five games; they preserve exactly 1 QB, 2 RB, 2 WR, and 1 TE. Out, doubtful, inactive, injured-reserve, suspended, practice-squad, mismatched, or unsupported-role players are excluded. Lines older than 30 minutes or timestamped more than five minutes in the future are excluded. Tickets remain incomplete rather than filling missing positions with unsupported picks.
The estimated probability uses only the player's last-10 historical hit outcomes (with Beta(2,2) smoothing), never the sportsbook price. FanDuel implied probability is shown separately; paired same-line/same-time Over/Under prices are de-vigged when available, otherwise quoted-side implied probability is labeled as vig-inclusive. Estimated edge is model probability minus market probability, EV is probability × decimal odds − 1, and fair odds are derived from the historical estimate. Every probability remains **UNVALIDATED MODEL** output until the chronological stored-prediction backtest meets its stated sample and performance thresholds.
Pregame research tickets can generate before that calibration check passes; real-money recommendations remain locked. Ticket generation and backtest reads do not trigger settlement, which runs in the background collector. See [pregame behavior and verification](../PRE_GAME_READINESS.md). A ticket leg must also match a current scheduled event ID and kickoff, a parsed FanDuel player/market/line/price with a fresh timestamp, a uniquely matched history player ID and supported stat category, and an ESPN roster/team entry. Ticket validation also prevents reusing a verified player identity, even when provider display names differ. Demo data cannot form tickets. Missing-history, event-mapping, roster, and injury exclusions are grouped by event, player, market, side, line, and reason, with occurrence counts; selection-level warnings show exact provider prices and per-ticket eligibility reasons. Last-10 hit rate is displayed separately from its smoothed empirical estimate; neither is presented as a validated predictive probability before the chronological validation threshold is met. Aggressive Six still requires positive modeled value, including at the 95% simulation lower bound; this interval reflects simulation error only, not model uncertainty.
Aggressive Six is built separately and is only returned when it has a higher theoretical individual-leg product price than Best Six; its ranking benefit from prices saturates at a ×100 decimal product to avoid rewarding extreme totals without limit. Any leg priced at +200 or longer requires a paired same-line FanDuel side for vig removal. The theoretical combined price is never represented as a confirmed FanDuel bet-slip quote.
Integer reception, rushing-attempt, and passing-touchdown lines condition estimated probabilities on a non-push outcome. Displayed theoretical ticket probabilities and returns do not model void-leg repricing when a selection pushes.
It never places wagers, never guarantees outcomes, and labels every payout "Estimated payout — not confirmed."
Six-leg combined odds and returns are theoretical products of individual player prices, not FanDuel quotes. The app does not verify that FanDuel accepts a particular six-leg combination, and same-game parlay prices can differ materially because of correlation. Joint probability is an assumption-based correlated simulation, not an accurate or calibrated forecast; the independent product is displayed only as a baseline. Integer count-line probabilities condition on no push, and void-leg repricing is not modeled.

## API keys
| Key | Needed for | Where | Cost |
|---|---|---|---|
| `ODDS_API_KEY` | FanDuel player-prop odds | https://the-odds-api.com | The provider lists player props among its markets; verify current FanDuel NFL event coverage with your key. |
| none | Stats and injuries (nflverse) | https://github.com/nflverse/nflverse-data | Free, open data |

Without `ODDS_API_KEY` the app runs in clearly labeled **Demo Data** mode (fictional players). When a key is configured, the app stays in live mode: upstream errors are shown explicitly and never fall back to demo data. By default, the app scans every upcoming game returned by the NFL schedule; the date selector can narrow ticket generation to one UTC date. The app batches supported player markets, including passing yards/touchdowns, rushing yards, receiving yards/receptions, and alternate lines, into one FanDuel odds request per game. The schedule lookup is free; scanning all upcoming games can make one paid prop request per game. The full upcoming scan is cached for 30 minutes by default, so date/game selection does not repeat those requests during the cache window. Empty odds responses do not consume credits. Remaining credits are shown in the app.

Player performance uses nflverse per-game stats for the current and previous season, cached locally for 24 hours by default (`NFL_STATS_CACHE_HOURS`); injury reports are cached for one hour (`NFL_INJURIES_CACHE_MIN`). Live history matching requires a unique provider player ID, dated real game IDs, valid team/opponent/position, and the requested statistical category in the source row. Each candidate is checked against ESPN's free current roster endpoint for exact name/position/team; missing roster responses fail closed. When full-game history has no valid nflverse match, the app tries ESPN's free player game-log and box-score endpoints and only accepts logged event IDs matching date, season/week, and teams. ESPN roster data is cached for 60 minutes by default (`NFL_ROSTER_CACHE_MIN`); no extra provider key is needed. The fallback does not affect first-quarter analysis. Last-5 and last-10 game logs, hit rates, role usage, available snap counts, and matchup summaries show source/sample size; absent snap data is not fabricated.
Backtests use only pregame forecasts and FanDuel prices captured by this running app, saved chronologically and settled against same-game nflverse results. No historical odds are fetched or synthesized. Brier score, log loss, calibration error, market baseline, hit rate, ROI, and walk-forward periods are reported. Fewer than 200 settled outcomes, fewer than 8 kickoff dates, weak calibration, or failure to beat the market Brier baseline keeps the status at **UNVALIDATED MODEL**.

First-quarter historical splits are calculated from the first-quarter rows of nflverse regular-season play-by-play data (current and previous season), cached locally with the stats cache. Player projections match nflverse player IDs and use quarter-only passing, rushing, and receiving yards; supported markets are QB passing, RB rushing, and WR/TE receiving. The analysis shows last-5 and (when ten games exist) last-10 Q1 averages and line hit rates, current-season opponent Q1 yards allowed by position (only after at least four verified games), and a recent-history-weighted estimate of Q1 pass attempts, rush attempts, or receiving targets per game. Q1 team/game totals use Q1 scoreboard snapshots. These are historical estimates, not guaranteed playing-time projections; missing play-by-play, player IDs, or defensive samples are shown as unavailable rather than filled in. If player history is missing, Best 1Q uses the live market price only and Aggressive 1Q excludes the unsupported leg. First-quarter FanDuel queries are opt-in via **Generate 1Q Tickets**. Player markets are tried first; totals are requested separately only when no player props are available, with event results cached for `ODDS_CACHE_MIN`. Explicit first-quarter aliases (such as `_1q` or `_1st_quarter`) for supported player-yardage markets are normalized to their Q1 market without accepting full-game keys. Server logs and the API response distinguish unsupported requests (HTTP 422) from successful requests with no player lines, and report requested, returned, and unmapped quarter-player market keys. The raw returned keys reflect the odds response, not a complete list of FanDuel's supported markets.

## TEST MODE

Use the default-off TEST MODE checkbox for unvalidated six-pick research tickets. It bypasses only the chronological calibration gate; all live-data, injury, roster, history, freshness, composition and EV checks remain. Each test ticket and saved record is labeled research-only and is not a validated recommendation or suitable for real-money wagers. The normal mode validation thresholds remain unchanged. No wagers are placed.

## Run locally
```bash
node -v            # needs Node 22.x >= 22.6
cp -n .env.example .env.local   # add ODDS_API_KEY
npm install
npm test           # node:test, no extra deps
npm run dev        # http://localhost:3000
```
Next.js loads `.env.local`. For tests-only use, no install is needed beyond Node.

## Run in Codespaces
From the workspace root, start the app with `cd nfl-parlay-lab && npm run dev -- --hostname 0.0.0.0`. Port 3000 is configured to open as a Codespaces preview automatically.

## Deploy via GitHub
1. Use the existing repository; configure the host root as `nfl-parlay-lab/` or use the repository-root wrapper commands.
2. CI (repository-root `.github/workflows/ci.yml`) runs tests, typecheck and build on push.
3. Hosting: a Node host with a persistent disk (Render, Fly, Railway, a VPS) works with the bundled SQLite file. On Vercel/serverless the filesystem is ephemeral, so swap `src/server/db.ts` for a hosted SQLite/Postgres (e.g. Turso/libSQL); the schema is in that file. Set `ODDS_API_KEY` in the host's environment settings.

## Architecture
- `src/lib/odds.ts` American/decimal conversion, parlay product, payouts
- `src/lib/model.ts` probabilities: normal (yards), Poisson (counts, anytime TD), shrink toward market for small samples, injury haircut
- `src/lib/sim.ts` correlated joint probability (Gaussian copula; team 0.30 and game 0.12 loadings are assumptions)
- `src/lib/optimizer.ts` eligibility, validation, ticket builder; swap models by replacing `model.ts`/`sim.ts`
- `src/lib/providers/` The Odds API client, nflverse stats/injuries
- `src/lib/service.ts` live pipeline and demo data; `src/server/` SQLite, caching, snapshot logging
- `src/lib/backtest.ts`, `settle.ts` leakage-safe evaluation

## Backtesting
Each live refresh stores the last pre-kickoff snapshot per prop (the unique key and a kickoff check prevent later overwrites). `/api/backtest` settles finished props from nflverse stats, skipping ambiguous matches and pushes, and reports hit rate, ROI, calibration, and splits by position and market. It separately reports sample size, mean predicted probability, observed hit rate, and a calibration warning for forecasts above 90%; fewer than 30 settled predictions is explicitly flagged as too small for a useful check. No profitability claim is made, and results need a large sample.

## Known limits (verify before trusting)
- Confirm live FanDuel prop coverage using `/api/tickets`; the app reports available markets, empty results, lookup errors, and the remaining-credit counter for every game on the selected date. Coverage varies by event and provider plan.
- Not yet modeled: weather, routes/target share, game script, or snap-based playing time; home/away splits and current-season defensive matchup rank are displayed when the underlying data is available.
- Same-game parlay availability is never assumed; tickets are capped at 3 legs per game and flagged.
- Check `.env.local` privately for the live `ODDS_API_KEY`; do not share or commit it. The nflverse stats provider requires no key.
