# API credential, cache and quota diagnosis

## Verified repository issues repaired

1. Every HTTP 401 previously became “Invalid API key.” The Odds API documents separate `INVALID_KEY`, `DEACTIVATED_KEY`, `OUT_OF_USAGE_CREDITS`, and `EXCEEDED_FREQ_LIMIT` codes. The transport now reads only recognized error codes and numeric quota/Retry-After headers, never raw error bodies. Exhausted subscription credits are distinct from an invalid key even when returned with HTTP 401. Unknown 401s remain authentication/subscription failures rather than a definitive invalid-key assertion. Reference: https://the-odds-api.com/liveapi/guides/v4/api-error-codes.html
2. A partial event scan could cache authentication/rate-limit errors for the full 30-minute live TTL. Error-bearing scans are no longer cached, and the new credential/model-scoped cache ignores old shared pipeline caches. Old cached rows, saved tickets and forecasts are retained.
3. Scans continued after account-wide authentication/access failures. HTTP 401/403/429 now stop the scan, mark remaining events not scanned, and retain already verified data rather than issuing more doomed calls. Unsupported-market 422s remain event-specific.
4. Concurrent ticket refreshes could launch duplicate scans. In-process calls now share one pending scan for the active credential. A temporary SQLite cooldown shared by app/collector suppresses repeated account failures, including forced refreshes. It honors valid Retry-After (bounded to 24 hours) or waits 60 seconds before a subsequent request may check again. Changing credentials scopes the new request separately. This is throttling, not a claim that quota has recovered; there is no automatic retry burst.
5. Provider fetches explicitly use `cache: 'no-store'`. Successful pipeline quote caches still enforce source quote freshness and scheduled-event matching.
6. `/api/health`, the collector and CLI expose only a one-way SHA-256 credential fingerprint (16 hex characters), never key characters. Health shows web process identity/start time, collector process/fingerprint, credential mismatch, and active cooldown. Collector schema additions preserve existing records. An old worker with no fingerprint is unknown until restarted; it is not assumed to match.

## Next.js environment behavior

Existing process variables take priority over environment files, including an existing **empty** ODDS_API_KEY. For development, Next checks `.env.development.local`, `.env.local`, `.env.development`, `.env` in that order, under the nested `nfl-parlay-lab/` application directory. Production uses the corresponding production files. The launch wrapper loads the same configuration for web and collector at startup; a later shell/file edit does not reliably update an already-running collector. Next development environment reloads can therefore leave web and worker using different settings.

A Codespaces secret existing in settings is not proof that the currently running Node processes inherited it. The credential must belong to **The Odds API**, have an active subscription/credits, and support the requested NFL/FanDuel player-prop endpoint. It is not a FanDuel login credential. No key was exposed, replaced or written during this work.

## Secret-safe check in the actual Codespace

Run this from the repository root with Node 22, while the updated app is running on port 3000:

```sh
npm run check:api
```

For a production launch, match its environment-file priority:

```sh
NODE_ENV=production npm run check:api
```

The command reports which environment source supplied the setting, whether it is empty, and its fingerprint. It compares the running web/collector identities through `http://127.0.0.1:3000/api/health`. It then makes at most one events request and one single-market (`player_pass_yds`, US FanDuel) event request. The latter can consume subscription credits. `npm run check:api -- --no-props` skips that paid player-prop check. It bypasses temporary app error caches for a deliberate diagnosis but does not reset them or retry provider failures. No database writes, settlement or ticket generation occur.

Interpretation:

| Result | Meaning and next action |
|---|---|
| Missing/empty effective key | Make the existing private key available to the app environment; an empty process binding can mask the file. Do not paste it into diagnostics. |
| CLI fingerprint differs from web | Web process is using another configuration or a stale startup environment. Stop the owning app normally and restart through `npm run dev` or `npm start` with the intended environment. |
| Web fingerprint differs from active collector | Stop the specific stale collector shown by health, then restart the supervised app. Preserve DB_PATH. Do not indiscriminately kill all Node processes. |
| Health unavailable/old fields | This check cannot establish the running process identity; update/start the app on port 3000 and inspect its health route. |
| `INVALID_KEY` / `DEACTIVATED_KEY` | Provider rejected that effective credential/subscription. Check the existing key in The Odds API account. |
| `OUT_OF_USAGE_CREDITS` or zero credits with a quota error | Subscription credit exhaustion; restore credits or wait for the subscription reset. Repeated refreshes do not fix this. |
| `EXCEEDED_FREQ_LIMIT` / 429 | Request-frequency or unclassified rate/quota failure. Honor the cooldown/Retry-After; avoid concurrent workers and repeated refreshes. |
| Events authenticated, single-market props denied | Credential authenticates, but the event endpoint/market/plan requires investigation. Check the returned code and active subscription. |
| Single-market props succeed, full scan 422 | Investigate unsupported requested market keys/parameters; do not label the credential invalid solely from a market restriction. |
| Request succeeds with no FanDuel lines | Authentication succeeded; that event/market currently has no returned FanDuel lines. Do not manufacture selections. |

Use the existing private key and persistent DB_PATH. Restart the app/collector normally; do not delete SQLite, saved tickets, forecasts or environment files. After resolving authentication/quota, `npm run verify:live` checks the full live pipeline; it may consume more credits.

## Local evidence and limits

The managed execution workspace is not the user's running Codespace. `npm run check:api` here found `.env.local` as the source, an empty effective key (no process binding masking it), and no reachable local web process on port 3000. It intentionally exited 1 without an authenticated provider call. This does **not** establish that the user's Codespaces key is absent or invalid, nor does it establish the account's remaining credits or the exact PIT/CIN and LAC/BAL error codes. Those require the command above in the actual Codespace.

Tests cover provider-code classification/redaction, real Next env precedence with isolated fake credentials, stale-worker detection, cooldown and credential isolation, duplicate-scan suppression, and unchanged saved archives. No manual ticket-generation or persistence retests were repeated. Pregame research remains independent of settled forecasts; all existing data/ticket/calibration safeguards remain.

Verification from repository root:

```sh
npm test
npm run typecheck
npm run build
npm run check:api
```

The runner uses Node 22 via `PATH=/workspace/work/node-runtime/node_modules/.bin:$PATH`. Automated results: **120 passed, 0 failed**, TypeScript **passed**, production build **passed**. The local API check exits **1 intentionally** for missing effective credentials/unavailable local app, not a simulated success.
