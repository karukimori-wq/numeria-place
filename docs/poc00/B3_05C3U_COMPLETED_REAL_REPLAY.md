# B3-05c-3u: actual completed Mercur workflow replay

2026-11-09 JST. Disposable pinned Mercur application only, offline Stripe.

After the existing real workflow SIGKILL at the ack boundary and fresh actual Medusa bootstrap, standard NP reconciliation verifies the original completed order. Existing assertions still require that this reconciliation never starts a workflow. The test then separately invokes the actual complete-cart-with-split-orders engine using the single persisted done execution's transaction_id and original cart_id. No replacement execution identity or synthetic orchestrator callback is supplied.

This explicit diagnostic replay requires unchanged order/group/link/session/collection/payment/capture IDs, the original NP completed ledger order ID, and no mutating offline provider call. Zero provider calls is allowed, as is original-account retrieve only. It does not claim an actual Stripe call. The explicit engine invocation is separated from the production reconciliation path; it is not enabled as a worker or automatic resume policy.

Existing group/order/link incomplete boundaries continue to stop in partial_completion review without invoking the workflow. This test does not authorize replaying those partial executions. Completed replay is a bounded real-workflow acceptance case, not arbitrary checkpoint recovery or general exactly-once proof.

Validation PASS: tested code 49689d152685eda826c5a7776ababa009a20d6a1; Actions https://github.com/karukimori-wq/numeria-place/actions/runs/42633738902. Fixed build/typecheck PASS; Redis two markers PASS; normal 3 suites / 51 passed + 1 skipped; four independent restart suites each 1/1 PASS and four supervisor markers. The actual completed-workflow replay marker confirms unchanged resource identities and no mutating provider call. Final job success and logs checked. Bounded goal (1) accepted only for completed execution; arbitrary partial checkpoint replay remains unsupported.

Remaining checkpoint goals: (1) bounded completed replay evidence, (2) define/test exclusive ownership for attempted worker resume versus NP reconciliation, (3) consolidate partial/orphan stopping conditions and operations into a checkpoint. Keep unsupported arbitrary repair, live Stripe Test Mode, NS sending, production identity/DB policies and G0 open. No main merge, production adoption or funds.
