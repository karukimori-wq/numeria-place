# B3-05c-3p: completed workflow / pre-ledger-ack process kill

2026-11-02. Selected completed-workflow boundary PASS. Disposable pinned Mercur integration only.

The fourth explicit boundary, ack, awaits successful return of the actual complete-cart-with-split-orders engine run, then SIGKILLs the process before reconcilePaidOrder verifies its result and marks np_poc_completion completed. The supervisor requires group/order persistence, completed cart and a still-pending completion ledger, then boots a new actual Medusa process on the same surviving DB.

Offline transport state is deliberately empty after restart. Standard reconciliation must reject UNKNOWN_OFFLINE_INTENT and retain the pending ledger. The test then restores only an allowlisted synthetic remote-intent fixture (ID, status, amount, currency and three synthetic mapping IDs) from a private temporary checkpoint. No client secret, real customer data, API key or database connection string is written there. This is explicit mocked remote-state reconstruction, not real Stripe persistence/API verification.

With that fixture restored, the actual provider still verifies original Connected Account, NP trusted registry, intent mapping, amount/currency and metadata. Standard reconciliation must reuse the completed order, set the pending ledger to completed with the original order ID, persist completed retry state, and perform no engine.run. Repeated scan does nothing. Allowed provider calls on recovery are retrieve only on the original synthetic account. Order, link, Session, Collection, payment and capture IDs remain unchanged. All four selected boundaries continue to run independently.

Files: http/np-source-checkout.spec.ts, http/workflow-kill.cjs, http/workflow-restart.spec.ts under poc/mercur-integration; .github/workflows/poc00-b3-mercur-source-snapshot.yml. Test harness changes only, no production apps/api adoption.

Limits: no actual Stripe remote retrieval, background-worker automatic resume, arbitrary crash/partial-transaction matrix or automatic partial repair. Synthetic intent fixture is a test input, not an allowed production recovery authority. No NS send is implemented: Intake/Outbox remain unsent DB rows and are insufficient alone to authorize sending. Full recovery stage acceptance, production DB policy, G0, formal adoption and release remain pending. Draft PR #2; no main/production/real funds.


## Evidence

Code `a599cc060971119beb4462155787e3be4fa6c2ba`; [Actions 41382432516](https://github.com/karukimori-wq/numeria-place/actions/runs/41382432516). Fixed build/typecheck PASS; normal 3 suites / **51 passed + 1 skipped** (52 declared). Four independent restarted-Medusa suite executions each passed 1/1, with four parent SIGKILL/restart markers. Final job logs read; job success.

Ack observation: group/order/cart-order link **1/1/1**, cart completed, completion ledger initially pending. Missing offline remote state was rejected with pending retained. After explicit synthetic intent restoration, standard reconciliation returned the original order ID, marked ledger completed and stored completed queue state. All order/link/session/collection/payment/capture identifiers remained unchanged. Recovery calls were retrieve-only on acct_Source123; engine.run zero.

Engine metadata at ack: one execution in **done**, 29 stored step entries, invoking 0 / done 28; unchanged by reconciliation. Do not infer the remaining step's state. Earlier incomplete group/order/link boundaries remain not_started and review. This demonstrates business-state-dependent review versus existing-completed verification, not distributed ACID.

Next: consolidate the bounded recovery acceptance matrix and assess background-worker automatic resume and production recovery ownership before isolated real Stripe Test Mode. No general-purpose repair or worker safety claim follows from this selected four-boundary proof.
