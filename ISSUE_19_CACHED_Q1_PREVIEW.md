# Issue #19 — reliable cached Q1 preview and visible blockers

## Investigation

Reviewed merged main `5cc89d9`, including PR #18. The exact reported `A newer provider failure ... Fetch successfully ...` error originates in strict `assertBoardUsable`. It is appropriate for regular generation and explicit refresh. The merged GET preview handler already caught that error when `preview=1`, and the previous isolated preview test passed. This audit therefore does not claim that PR #18 was unmerged, or that the owner's private request/cache was reproduced byte-for-byte.

Verified gaps: preview intent shared a boolean query request with regular generation; failed free schedule or player-data retrieval could discard all cached-market counts and return only an error; no explicit cached-preview outcome summary existed; empty regular/fresh ticket cards were rendered below stale previews, mixing two separate eligibility paths.

## Fix

- The Q1 preview button now POSTs explicit `action: preview-fanduel`, Sunday/game selection included. This branch reads the credential-scoped cache only and never invokes provider refresh. Its response identifies `requestMode: cached-preview`.
- Q1 GET compatibility and full-game previews use the same cache selector. A provider failure/cooldown is a display warning for previews, not a requirement for successful new paid data. Regular generation retains failure invalidation and all existing freshness checks. Missing/corrupt/incomplete cache is a concrete error, never an automatic provider retry.
- In cached-preview mode, failed free schedule/player-data retrieval preserves cached Q1 diagnostics and reports the failed stage. No schedule, roster identity, injury status or history is inferred to fill picks. Regular generation keeps its original failure behavior.
- Always show `0 of 2` / `2 of 2` preview outcome, cache time, requested slate/game, raw Q1 rows, selected games/prices, usable cached prices, projected/availability-eligible props, distinct eligible players, and free-data availability. Existing grouped rejection evidence remains visible. An insufficient pool states the actual player count.
- Show stale preview cards separately from fresh-only cards. Disable slate/game selectors during an in-flight analysis so an older result cannot appear under a changed selection. Preserve explicit loading/error state and original quote provenance.

The 30-minute API freshness rule, player/injury/market/game requirements, Sunday boundaries, six-pick structure, non-actionable labeling, manual comparison persistence, saved tickets and forecasts remain unchanged. No credentials, DB_PATH or provider subscription were changed.

## Verification

Node 22, repository root:

```
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Results: **183 tests passed** (182 application tests plus 1 startup test), TypeScript passed, production build passed, and all **five production browser workflows passed**.

New regressions cover strict failure followed by valid cached preview, failure/cooldown evidence preserved unchanged, absent/corrupt/incomplete cache, free schedule failure, two-player and missing-injury blockers, and no other Sunday substituted.

The production browser regression follows the reported tablet sequence: regular Q1 generation displays the exact invalidation error, then tapping cached preview sends the explicit POST, clears that error and displays both research triples. It also verifies a visible zero-option outcome for an insufficient pool, a concrete missing-cache error, invalid-date rejection before requests, full-game previews, manual checks/rechecks, reload/server-restart persistence, phone/tablet layouts, no extra odds requests and unchanged saved tickets/forecasts. External providers use isolated synthetic fixtures, not claimed live prices.

The owner’s private Codespace board is unavailable in this workspace. Actual 148-row preview completeness still depends on current verified game/player/injury/history coverage. The new outcome and rejection counts identify remaining data blockers without requiring screenshots, purchasing credits or fabricating picks.
