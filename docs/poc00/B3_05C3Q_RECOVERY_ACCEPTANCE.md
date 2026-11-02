# B3-05c-3q: bounded recovery acceptance and worker ownership

Date: 2026-11-02. Disposable pinned Mercur overlay only. Validation PASS within the scope below.

## Accepted offline boundaries

| Trigger | Expected bounded outcome | Evidence |
| --- | --- | --- |
| Claimant SIGKILL after queue claim | Wait for natural 90-second lease expiry; reclaim once | B3_05C3J |
| Old claimant survives takeover | Token fence refuses finalization/history write | B3_05C3J (synthetic expiry, separate from SIGKILL) |
| Workflow group / group+order / cart-order-link saved, Cart incomplete | Standard reconciliation records partial_completion review; never starts replacement workflow | B3_05C3O |
| Workflow completed, NP completion ledger pending | Refuse absent remote state; with explicit synthetic remote fixture verify original order and finish ledger | B3_05C3P |
| Known paid authority or durable completion loses required reference | orphan_state review, bounded candidate scans | B3_05C3J / M |
| NP-attributable session / sealed collection loses authority | Bounded reverse inventory creates deduplicated review observation | B3_05C3N |

Prior four-boundary evidence: tested a599cc060971119beb4462155787e3be4fa6c2ba, Actions 41382432516. These are narrow acceptance cases, not exhaustive crash safety or automatic repair. Reverse observations can be in-flight cross-DB races, not proof of corruption.

## Recovery ownership restriction implemented here

The test-app configuration now explicitly sets projectConfig.workerMode to server. Missing MEDUSA_WORKER_MODE means server; an explicit value other than server (including worker/shared/empty/unknown) throws NP_POC_SERVER_MODE_REQUIRED during configuration evaluation, before loaders can start workers. This intentionally restricts this PoC, not all Mercur deployments. The guard is copied only to integration-tests. No bypass is provided.

Six fresh Node-process cases exercise this policy. All four real restart cases also assert the loaded Medusa configuration reports server mode, then retain the resource/engine invariance checks. This is a startup restriction, **not a worker-mode restart test**, and does not prove absence of other execution paths or prevent another application with unpatched configuration from accessing the same DB/Redis. Keep those resources isolated.

The NP advisory lock, queue lease and token fence protect NP reconciliation. They do not establish ownership against a separate engine retry/timeout consumer. Do not enable that consumer against these persisted workflows until its transaction identities, locks, stored step handling and side effects have been tested together with NP recovery.

## Primary source assessment

- [Pinned Mercur integration configuration](https://github.com/mercurjs/mercur/blob/9fe557067193e0ad4dd3b7fd37e212f0b352ab3c/integration-tests/medusa-config.ts): previously omitted workerMode.
- [Pinned withMercur](https://github.com/mercurjs/mercur/blob/9fe557067193e0ad4dd3b7fd37e212f0b352ab3c/packages/core/src/with-mercur.ts): passes projectConfig through defineConfig.
- [Medusa 2.21.2 Redis engine storage](https://github.com/medusajs/medusa/blob/v2.21.2/packages/modules/workflow-engine-redis/src/utils/workflow-orchestrator-storage.ts): onApplicationStart creates retry/step-timeout/transaction-timeout consumers when isWorkerMode; executeTransaction calls orchestrator.run with stored transaction identity. This establishes a separate execution path when that module is configured; it does not demonstrate that the current test app uses Redis workflow storage or that every killed synchronous execution will automatically resume. No such claim is made.

- [Medusa defineConfig](https://github.com/medusajs/medusa/blob/v2.21.2/packages/core/utils/src/common/define-config.ts): default modules and cloud modules differ; REDIS_URL alone does not establish the selected engine.
- [In-memory engine storage](https://github.com/medusajs/medusa/blob/v2.21.2/packages/modules/workflow-engine-inmemory/src/utils/workflow-orchestrator-storage.ts): retry/timeout maps are process memory; onApplicationStart starts expiration cleanup, while scheduleRetry installs timers that call the orchestrator. Server mode is not a universal timer prohibition. Reading this source does not replace testing the effective configured module or durable recovery.

## Gates still open

1. Dedicated isolated worker-mode experiment: identify actual configured engine implementation; enumerate durable retry jobs and transaction identities without payload logging; restart against each killed DB; race worker recovery with NP lease ownership; compare actual payment/order/link side effects. Define a single owner before enabling consumers. No arbitrary engine resume/cancel is authorized by this report.
2. Arbitrary partial transactions/link batches, order-only before group, exhaustive orphan discovery, safe review resolution and scheduled reconciliation remain unverified/unimplemented. Partial review cannot be requeued by granting an attempt budget.
3. Isolated Stripe Test Mode actual remote retrieval/refund/cancel/webhook and zero Transfer remain pending. Synthetic fixture restoration is not remote recovery authority.
4. NS sender remains absent. PREPAY delivery requires verified completion/binding plus paid evidence; Intake/Outbox existence alone is insufficient. Postpay admission requires separate policy. NP paid and Mercur completion are separate commits.

Operator UI remains paused at its checkpoint. No production migration/adoption, real money, main merge, G0 or release.

## Changes and validation

Files: server-only.cjs, server-only.test.cjs, install-direct-runtime.mjs, workflow-restart.spec.ts, source-snapshot workflow, this report.
Local: six fresh-process policy cases PASS; installer syntax PASS. Tested code b826e0ad195d55d93e53d2a4cceafbdb5215b6de. [Actions 41462311691](https://github.com/karukimori-wq/numeria-place/actions/runs/41462311691): fixed build/typecheck PASS; 6 fresh-process policy cases PASS; normal 3 suites / 51 passed + 1 skipped; four independent real SIGKILL/restarted-Medusa suites each 1/1 PASS, all four supervisor markers PASS. Final job success and logs checked. Loaded configuration is server in every restart. No replacement workflow; prior partial/recovered outcomes and resource invariance preserved. Other 13 workflows at this tested SHA also success. PR #2 remains Draft. This later report update adds sources/evidence only, no runtime change.
