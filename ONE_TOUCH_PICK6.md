# One-touch Pick 6

The existing Live API Workspace now has **Generate & Save All 4 Pick 6 Tickets**. It selects all verified upcoming NFL games and automatically archives eligible Safer, Balanced, Aggressive and Long Shot tickets. Existing selectors, individual saves, TEST MODE and Q1 generation remain available.

Paper Betting has **Generate & Capture All 4**. It honors the saved All Upcoming/Sunday/custom game selection, uses the same full-game PropLine snapshot, and records a fixed $10 virtual stake per eligible strategy. It never places a sportsbook wager. Scheduled background capture remains cache-only; this explicit button is the only new action permitted to refresh PropLine.

Both actions stream actual server progress: schedule/cache check, PropLine refresh when necessary, generation, storage, and confirmation. Buttons are full-width, wrap their labels, provide large touch targets and disable while running. Results show all strategies, stored IDs, original timestamps, and whether each record is new or already recorded. Partial coverage or insufficient virtual funds produces explicit missing-strategy reasons, never filler picks.

## Data and safeguards

- Uses the existing PropLine adapter and five-minute request cache. A missing/expired cache can trigger one ALL/full-game bulk request. A usable cache is reused by both buttons. No other paid provider is refreshed, and there is no automatic retry or paid fallback.
- If all four paper strategies already exist for the selected game set, the button returns the original archives without refreshing even an expired cache. If fewer exist and available virtual funds are below $10, it stops before any odds request.
- Fresh empty or stale-price responses are not repeatedly refreshed to fill gaps. Existing quote freshness, failed-snapshot invalidation, quota pauses, injury/roster/history checks and exact event/market matching remain enforced. Cache acquisition time never relabels old quote timestamps as current.
- Uses the existing four-option optimizer: exactly 1 QB, 2 RB, 2 WR, 1 TE, distinct strategies and maximum three picks per game. Missing player evidence cannot be bypassed to complete four tickets.
- Live TEST MODE remains labeled TEST MODE in stored history. Paper capture rejects TEST MODE and manual/demo/stale/unverified tickets. No prediction is promoted to calibrated or validated status.
- An additive archive mapping retains the four strategy names and deduplicates repeated/concurrent batch saves by strategy, purpose and exact leg contracts. Existing saved tickets are not rewritten. Original quote prices/timestamps remain immutable when an earlier archive is returned.
- Paper capture reuses the existing atomic bankroll debit, selected-game-set/strategy uniqueness, cross-scope duplicate checks, pending grades and append-only correction ledger. Concurrent confirmations use the IDs actually inserted by that request.
- Lost connections never cause automatic replay. Inspect history before retrying; server-side duplicate checks still protect durable records.

## Verification

From the repository root with Node 22:

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Final verification: 261 automated tests passed (1 startup + 260 application), TypeScript passed, production build passed, and all 11 browser workflows passed. New unit tests cover cache reuse/expiry, concurrent live and paper capture, authentication/access/quota/service failures, stale/empty markets, partial virtual funds, TEST MODE, immutable grading, streamed chunk boundaries, errors and interrupted confirmations. The browser test uses production routes/UI/storage and an isolated external-provider fixture: one PropLine request saves four live tickets and captures four paper tickets, with no additional request on repeated clicks. It verifies pending history, strategy labels, reload/restart persistence, tampered-input rejection, cooldowns, final-stat grading and 412px phone/800px tablet layouts.

Fixture screenshots (not live odds or actual winnings):

- [Live phone](docs/screenshots/one-touch-live-phone.png)
- [Live tablet](docs/screenshots/one-touch-live-tablet.png)
- [Paper phone](docs/screenshots/one-touch-paper-phone.png)
- [Paper tablet](docs/screenshots/one-touch-paper-tablet.png)

Launch with the existing `npm run dev`, or `npm run build` followed by `npm start`, then open port 3000. Preserve the existing `.env.local` and persistent `DB_PATH`; PropLine credentials remain server-only. Live provider access and future forward performance were not verified here: automated provider responses and final statistics are explicitly isolated fixtures. Real operation requires sufficient fresh provider coverage and verified free player data. Background grading requires the app/collector to keep running.
