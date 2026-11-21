# Sports Parlay Lab: mostly autonomous development

This repository currently contains an NFL Next.js application, even though the repository is named sports-parlay-lab. Do not mistake the repository name for proof that NBA, MLB or MMA support is implemented.

## Operating model
- Claude is the primary implementer, scheduled on weekdays at 09:15 UTC and available manually through Actions > Sports Lab Claude background agent > Run workflow.
- Each run inspects the current code, makes one bounded improvement, tests, and opens a pull request when possible.
- GitHub Actions CI runs npm test, typecheck and build on pull requests.
- Codex is the secondary reviewer/debugger, **not yet automatically wired**.
- Grok (xAI) is an additional independent reviewer for architecture, bug hypotheses, and cross-checking Claude/Codex recommendations, **not yet automatically wired**. Grok must not directly merge or deploy. Treat its outputs as untrusted suggestions requiring validation and tests. Add Codex review only after verifying API credentials, cost limits and action permissions.
- No automated merges or deployments. The repository owner reviews and approves major changes.

## Owner setup required
1. Add ANTHROPIC_API_KEY under Settings > Secrets and variables > Actions > New repository secret. Never put keys in code or chat.
2. In Settings > Actions > General, permit GitHub Actions to create pull requests. Grant only the minimum token permissions needed by the agent; do not give it repository administration.
3. Protect main with a rule requiring pull requests and passing Sports Lab CI checks. Review workflow changes manually. For personal repositories, GitHub may not count the author's own review as a required independent approval; retain manual merge control.
4. Manually trigger the agent once and verify that it opens a PR with passing tests. Until this succeeds, the background agent is **not operational**.
5. Add OPENAI_API_KEY only when ready to configure Codex PR review. API charges can apply separately from ChatGPT/Claude subscriptions.
6. Add XAI_API_KEY as a repository Actions secret only when ready to configure Grok review through the xAI API. Check API access, pricing, usage limits and data-sharing policies before enabling. Never expose source or secrets in prompts without approval.

## Safety and budget
- Never auto-merge, place bets, change billing, rotate secrets, or deploy production.
- Do not present test odds as verified live FanDuel prices.
- Monitor Actions minutes and Anthropic usage; the schedule will incur API costs when enabled. Codex and Grok API usage may incur additional charges when connected.
- The scheduled workflow only runs after merged into main and configured with a valid key.
- If the agent cannot open a PR, inspect Actions logs rather than assuming work happened.
