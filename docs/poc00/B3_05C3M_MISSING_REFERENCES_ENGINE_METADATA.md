# B3-05c-3m: missing payment references and stored engine metadata

2026-10-30. Limited verification PASS. Disposable fixed-Mercur overlay only.

Paid source candidates now retrieve the actual Medusa Payment Session and Payment Collection before completion proceeds. Missing/null references and explicit Medusa not_found become orphan_state review. Other exceptions propagate as retryable failures; no broad catch treats storage/transport failure as missing data. Existing session/amount/account/seal checks remain in place. No new session/collection/Intent is created to repair a broken reference.

Two real integration cases replace only trusted NP projection reference IDs with nonexistent IDs. The paid record survives; actual sealed financial resources are retained. Durable scanning must persist orphan_state review, repeated scans must not start a workflow, and the Intent creation count remains one. This is deterministic missing-reference injection, not a new process-kill experiment.

The separate SIGKILL/restarted-Medusa test now selects workflow_id, transaction_id, run_id and state from workflow_execution for complete-cart-with-split-orders, compares the metadata before and after standard reconciliation, and logs only record count/state labels. It does not read or log execution/context JSON. Zero records must be reported as absence, not step persistence or resumability. Table presence alone is not evidence of an execution record.

Scope limits: this scans only paid candidates discoverable from surviving NP authority/completion ledgers. It detects dangling source references, not a reverse inventory of unreferenced sessions/collections. No automatic repair, individual persisted step inspection, worker-mode resume, arbitrary crash matrix, real Stripe/NS sending, production migrations/roles, G0 or release.

Files: payment/completion-references.ts (new), payment/completion.ts, http/np-source-checkout.spec.ts, http/workflow-restart.spec.ts under poc/mercur-integration. PR #2 stays Draft; no main/production/funds.


## Evidence and implication

Code `59bde78bd2e913c089923e8d90d0e9846024c629`; [Actions 41072471024](https://github.com/karukimori-wq/numeria-place/actions/runs/41072471024). Fixed Mercur build/typecheck PASS; normal 3 suites / **50 passed, 1 skipped** (51 declared), separate restart 1 suite / 1 PASS and parent SIGKILL/restart marker PASS. Final job logs read; success confirmed. Two reference cases were added to the previous 48.

Restart observation: group 1, orders 0, cart-order links 0; stored execution count **1**, state **not_started**. Execution identity/state metadata was identical before and after standard reconciliation. A persisted business result therefore coexists with not_started engine metadata at this SIGKILL boundary. Do not infer that a fresh workflow is safe from engine state alone; actual business-state reconciliation remains mandatory. This observation does not prove the meaning of every internal step or support workflow resume.

Next: inspect the selected execution's step-state structure with a strict non-payload projection, then extend reverse orphan inventory and another crash boundary. Full stage-1 recovery, automatic repair, Stripe Test Mode, NS delivery and G0 remain pending.
