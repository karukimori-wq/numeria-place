# B3-05c-3o: actual order and link commit process-kill boundaries

2026-11-02. Selected-boundary verification PASS. Disposable fixed-Mercur integration app only.

The opt-in real registered Workflow SIGKILL case supports three explicit boundaries, each in an independent Medusa test database:

- group: actual createOrderGroups returns, then SIGKILL (prior experiment retained).
- order: actual createOrders returns and the parallel order-group creation has also returned, then SIGKILL before downstream remote links.
- link: actual Link.create returns for a definition containing the current cart_id plus order_id, then SIGKILL before the workflow advances to cart completion/payment authorization.

The supervisor requires the intended boundary checkpoint and real SIGKILL, one group and incomplete cart. Order/link boundaries additionally require exactly one persisted order. A fresh Medusa server-mode loader verifies the same DB and exact order IDs, and requires zero cart-order links for group/order, one for link. Actual standard paid reconciliation and durable retry scanning must reject partial state, persist partial_completion review, and leave order/link/engine-state snapshots unchanged without invoking a new workflow. There is no synthetic review-error callback or fabricated order-count disposition in the supervisor.

Upstream pinned Medusa create-remote-links step resolves ContainerRegistrationKeys.LINK and awaits link.create(data); the test spies that actual service boundary. The order case deliberately waits for the parallel group result; it does not claim to cover order-only/no-group interruption.

Files: http/np-source-checkout.spec.ts, http/workflow-kill.cjs, http/workflow-restart.spec.ts under poc/mercur-integration; .github/workflows/poc00-b3-mercur-source-snapshot.yml runs group/order/link supervisors separately. Normal regression counts remain separate from the three dedicated restarted-Medusa runs.

Limits: these are selected post-persistence return points, not every possible transaction/step interruption. Worker-mode automatic resume, order-only/no-group state, partial link batch commits, completed-cart/before-ledger-ack crash, arbitrary automatic repair, safe review resolution and exhaustive no-provenance orphan detection remain unverified. No Stripe transport or NS sending. Recovery stage overall/G0/formal adoption/release remain pending. Draft PR #2; no main/production/funds.


## Evidence

Code `e855bafe79dbd24a7004d88562aa8461d519f0d5`; [Actions 41380773818](https://github.com/karukimori-wq/numeria-place/actions/runs/41380773818). Fixed build/typecheck PASS; normal 3 suites / **51 passed + 1 skipped** (52 declared). Dedicated restarted-Medusa suite passed 1/1 separately for each boundary; all three parent SIGKILL/restart success markers confirmed. Final logs read; job success.

| Boundary | Groups | Orders | Cart-order links | Cart | Standard reconciliation |
| --- | ---: | ---: | ---: | --- | --- |
| group | 1 | 0 | 0 | incomplete | partial review |
| order | 1 | 1 | 0 | incomplete | partial review |
| link | 1 | 1 | 1 | incomplete | partial review |

Each boundary retained one engine execution in not_started state and 29 stored step entries with invoking/done counts zero; projected engine metadata, order IDs and cart-order links stayed unchanged through reconciliation. Do not infer every remaining step state from these counts. Repeated scans started zero workflows.

Next mandatory boundary: actual workflow completion followed by process termination before NP completion-ledger acknowledgement, including reconstruction of the offline provider's verified state for the restarted process. Current tests deliberately stop incomplete business state and do not establish completed-cart/response-loss process-kill recovery. Background-worker resume and full stage-1 acceptance also remain pending.
