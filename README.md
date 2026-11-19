# NFL Parlay Lab

For zero first-quarter props, see the [Issue #13 investigation and no-credit cache audit](ISSUE_13_Q1_INVESTIGATION.md). Q1 diagnostics separate source coverage from schema, NFL-date, freshness and player-eligibility exclusions; no full-game prices are substituted.

**First Quarter Parlays** is now visible on the default page. It reuses verified Q1-specific markets from the existing independent FanDuel cache for two distinct research triples, with an explicit optional Odds API path and no full-game substitution. See [Issue #11 workflow and verification](FIRST_QUARTER_WORKFLOW.md).

Latest selection safeguards and verification: [automatic eligibility and verified historical estimates](SELECTION_READINESS.md). Questionable/unverified players are excluded; independent FanDuel selections require current team injury coverage and explicit active-roster verification. Existing cached quotes and request limits are preserved.

The default page now supports the independent [fanduelapi.com REST provider](FANDUEL_INTEGRATION.md), alongside existing free-data/manual odds. Configure `FANDUEL_API_KEY` only in the nested application's private `.env.local` or server environment. On-demand NFL event/prop fetches preserve five-minute free-tier delay labels and generate two distinct aggressive research options only when verified inputs qualify. `npm run verify:fanduel` reports live access safely; a missing key remains an explicit blocker.

Automatic per-leg grading, a separate BACKTEST simulator and the four evaluation dashboard sections are available on this branch. Save upcoming tickets before kickoff, run `COLLECTOR_MODE=settle-only npm run dev`, and see [grading rules](GRADING_RULES.md) and [real-data verification/launch instructions](EVALUATION_VERIFICATION.md). Historical benchmark results do not unlock live calibration or invent FanDuel odds.

The default workspace now runs on free NFL data with explicitly labeled manual FanDuel odds entry, independent of paid odds credits. Start with `COLLECTOR_MODE=settle-only npm run dev` to keep free background grading active. Existing live API and first-quarter features remain available separately. See [mission acceptance evidence and launch instructions](MISSION_READINESS.md); fresh prices and final game-day availability confirmation are still required external inputs. Current dated ESPN injury listings supplement historical nflverse reports.

Existing Next.js application in `nfl-parlay-lab/`. Requires Node 22 LTS (22.6 or newer within 22.x).

From this repository root:

```sh
npm ci
npm run setup:env   # preserves any existing .env.local
# Optional: configure a legitimate odds-provider key privately for API odds.
npm run dev
```

Root commands also support `npm test`, `npm run typecheck`, `npm run build`, and `npm start` (after building). Root development and production commands explicitly bind port 3000 on all interfaces; an occupied port fails rather than silently switching the preview to 3001. Hosts needing another port can invoke the application-directory command with `--port`.

Codespaces now starts the development server automatically on start/resume after applying the updated devcontainer configuration. Port 3000 opens in a browser. `npm run codespace:start` is idempotent: a healthy running app is reused; an unhealthy/foreign listener is reported without killing it. Local startup logs are in ignored `.codespace/app.log`. No environment file or DB_PATH is replaced. See [current verification and preview limitations](PREVIEW_READINESS.md).

Pregame research tickets generate before chronological calibration passes using eligible API-verified quotes or explicitly labeled user-observed manual quotes. Manual quotes never become verified live prices. TEST MODE is an explicit, default-off checkbox that adds the test research label. Test tickets are labeled in the UI, API, and saved records; they are not validated recommendations and must not be used for real-money wagers. Pregame research preserves freshness, injury, roster, history, positional, and pricing checks. No wagers are placed. Real-money recommendations retain the full calibration requirement, including 200 settled forecasts and eight kickoff dates. Settlement runs separately in the background. See [pregame behavior and verification](PRE_GAME_READINESS.md). A Thursday-only selection cannot produce six picks from a single game (three-per-game maximum); use all upcoming games.

Deploy with the repository root commands above, or select `nfl-parlay-lab` as the host root and run `npm ci`, `npm run build`, `npm start` there. Use a Node host with a persistent writable disk and configure DB_PATH on that disk. SQLite is not suitable for ephemeral serverless storage without adaptation. Configure ODDS_API_KEY in hosting secrets, never in source control. Live coverage depends on the provider plan and event availability.

GitHub Actions runs tests, typecheck, and build from the application directory. See [application documentation](nfl-parlay-lab/README.md) for data sources and research limitations.

For persistent deployment, live provider diagnostics, and exact launch steps, see [DEPLOYMENT.md](DEPLOYMENT.md). The Render Blueprint provisions a persistent disk when applied in your hosting account; it has not been deployed automatically. `npm run setup:env` never overwrites an existing private env file. `npm run verify:live` checks provider health without printing credentials.

For Codespaces forecast capture and settlement, `npm run dev` and `npm start` now automatically supervise a collector while the app and Codespace are running. The validation dashboard reports its heartbeat and failures. Set `COLLECTOR_ENABLED=0` only to use a separate collector on the same database. See the TEST MODE investigation and validation workflow in [DEPLOYMENT.md](DEPLOYMENT.md). This uses the existing private key and SQLite database without changing the key.

For current credential, provider coverage, quote freshness and collector-health diagnostics, run `npm run verify:live` and see [LIVE_INTEGRATION.md](LIVE_INTEGRATION.md). This check does not modify tickets or forecasts; missing credentials block live mode rather than substituting demo data. Intentional demos require `DEMO_MODE=1`.

For mixed Invalid API key/rate-limit errors, run `npm run check:api` in the actual Codespace while the app is running. It compares secret-safe credential fingerprints and distinguishes provider authentication, quota and endpoint errors without deleting history. See [API_CONFIGURATION.md](API_CONFIGURATION.md).

For paid-provider errors alongside future forecasts or zero verified saved-ticket samples, see [FORWARD_READINESS_REPORT.md](FORWARD_READINESS_REPORT.md). Use `npm run audit:readiness` inside the actual Codespace for a read-only date/eligibility audit, and `COLLECTOR_MODE=settle-only npm run dev` for free automatic grading. Collection phases are now reported separately; no simulated result fills forward accuracy.
