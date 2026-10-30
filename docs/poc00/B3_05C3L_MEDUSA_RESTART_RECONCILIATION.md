# B3-05c-3l: restarted Medusa standard reconciliation

2026-10-30. Limited restart verification PASS. Disposable pinned integration overlay only.

The real registered workflow is SIGKILLed after createOrderGroups returns. The parent inspects the surviving database and records existing order IDs. A new Jest process boots the actual Medusa loaders against that same database (server mode, entrypoint loading skipped). It calls actual reconcilePaidOrder and reconcileDuePaidOrders, not the prior synthetic partial-review callback.

Partial persisted state is classified after paid evidence/seal/binding checks and before Stripe/provider status lookup. An incomplete cart with an existing group is already unsafe to recreate, independently of transport availability. Completed/new states still require the existing full session/provider/source checks.

Acceptance: same database, persisted group, incomplete cart; standard reconciliation rejects with the partial sentinel; durable queue enters partial_completion review; repeat scan invokes no new workflow; exact order IDs and cart-order links stay unchanged. Engine persistence table availability is inspected and logged as names only, not payloads. The offline Stripe map is not restored for this path and no replacement Intent is created.

Limits: server-mode loader bootstrap is not an HTTP login/browser test, background-worker restart or stored Workflow resume. Engine persistence existence does not prove every step was durably flushed before SIGKILL. Concurrent unlinked orders may remain; preserving their IDs does not repair or exhaustively audit them. No arbitrary-step crash matrix, automatic repair, real Stripe/NS delivery, production migration/DB permissions, G0 or release.

Files: completion.ts, workflow-kill.cjs, new workflow-restart.spec.ts, install-direct-runtime.mjs under poc/mercur-integration. Normal 48-test regression remains separate from the dedicated crash/restart step.

PR #2 stays Draft. No main merge, production changes or real funds.


## Evidence and observed state

Code `4bb376d9b6191d1db766db9054e3c04e9dbd1b87`; [Actions 41065439365](https://github.com/karukimori-wq/numeria-place/actions/runs/41065439365). Fixed build/typecheck PASS. Normal regression: 3 suites, 48 passed + 1 skipped (49 declared). Separate restart suite: 1 suite / 1 test PASS, followed by parent SIGKILL/restart success marker. Final logs read; job success confirmed.

Observed after restart: **1 group, 0 orders, 0 cart-order links**, incomplete cart. Exact order IDs match the pre-bootstrap snapshot. `workflow_execution` persistence table exists; individual engine step states/records were not asserted and remain a separate inspection task. The standard completion call rejected partial state, actual durable scanning recorded partial_completion review, repeat scan did not run another workflow, and order/link snapshots remained unchanged.

First run 41064440301: normal regression passed, restart suite failed before bootstrap because Express was not directly resolvable from the integration app. Fixed by resolving Express from Medusa's own package dependency context. No success asserted for that run.

Next: inspect durable engine execution/step metadata and expand the crash matrix to other persisted boundaries and orphan sessions/collections. Background worker automatic resume and arbitrary workflow repair remain unverified. Stripe Test Mode and NS sending follow the mandatory recovery checks.
