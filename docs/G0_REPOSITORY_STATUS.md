# G0 Repository Inventory — 2026-10-20

## Verified facts
- GitHub repository: https://github.com/karukimori-wq/numeria-place
- Repository creation observed: 2026-10-20 02:17 UTC (11:17 JST).
- Initially public, default branch configured as `main`, repository size `0`, no branch or commit; GitHub Contents returned "This repository is empty" and Commits returned 409 empty repository.
- Initial README commit for project instructions: `a40765cba80b1efebff89823a0c6ca82f4b74785`. This is **documentation only**, not an application.
- GitHub connected repository permissions allowed read/write in this session.
- Canonical contracts: https://github.com/karukimori-wq/professional-platform-contracts. PR #4 was `open / draft / unmerged` when checked 2026-10-20.
- Notion documentation: https://app.notion.com/p/3f3e71121fed813eb4f0ea8929168d19 and audit https://app.notion.com/p/3fee71121fed81c6a9f0fad8fb2b50a1

## Not in repository or not yet determined
- No runnable app, framework, package manifest, tests, Cloudflare configuration, database schema, API or UI code existed when inspected.
- Actual app hosting URL, NP domain, runtime, payment provider adapters, Clerk integration and persistent storage are not established by the GitHub repository creation.
- Whether to use Mercur as a backend, a custom commerce adapter, and Cloudflare deployment must be decided against security, operational fit and Stripe Connect seller-of-record requirements.
- The prior local `Numeria_Place_UIUX_CrossScreen_Codex_V1_20261019.zip` and five HTML mocks are **ChatGPT-delivered local artifacts**, not repo source, unless uploaded in a future step.

## G0 gates
- [x] G0-A Identify canonical NP GitHub repository.
- [x] G0-B Identify initial state and permission.
- [x] G0-C Confirm contracts PR #4 current status.
- [x] G0-D Seed documentation and agent safety rules.
- [ ] G0-E Select architecture/framework and repo package layout.
- [ ] G0-F Decide deployment/staging strategy and cloud persistence.
- [ ] G0-G Finalize NP contract ownership and approve PR #4 or a superseding revision.
- [ ] G0-H Decide Stripe Connect direct-vs-alternative and legal/fee handling.
- [ ] G0-I Finalize postpay deadlines, eligibility/collections/cancellation and legal seller terms.
- [ ] G0-J Determine published Business LP behavior at Business expiration.

## Safe development next
1. Start an isolated UI implementation branch, build the shared mobile-first components based on Notion pages 17–21, and connect mock routes without real user data, Stripe or private Report content.
2. Add automated UI tests with mocked data, then preview without modifying production domains.
3. Progress backend/checkout and protected PDF access only after relevant contract/Stripe/security gates are passed.

This file is a **point-in-time G0 observation**. Re-verify it before implementation; do not claim a completed application or a production release.
