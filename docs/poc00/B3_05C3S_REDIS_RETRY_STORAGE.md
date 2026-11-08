# B3-05c-3s: isolated Redis storage retry persistence

2026-11-08 JST. Independent storage/queue experiment inside disposable pinned Mercur test dependencies. Not a completed Mercur order workflow or NP reconciliation race test.

Uses Medusa 2.21.2 RedisDistributedTransactionStorage.scheduleRetry and its actual BullMQ worker lifecycle. Synthetic transaction/step identities and a synthetic orchestrator callback replace real workflow execution and domain effects. The callback checks the original identity and increments a Redis counter only. No Stripe, order or NS call is made by this experiment.

Parent waits for scheduleRetry to return, SIGKILLs the producer, reconnects to observe exactly one delayed job and no callback, then starts a separate worker process. It requires the original synthetic identity and one callback during a bounded observation window. This is not a general exactly-once guarantee: BullMQ delivery and callback crash windows require idempotent effects.

Local-only Redis URL and NODE_ENV=test are required. Database 14 and a random per-run prefix isolate all queue and counter keys, including the fixed-name cleaner queue. Parent kills surviving children before SCAN/DEL of only that prefix; no FLUSHDB. The actual Redis storage class is loaded from its installed package; no copied queue implementation. Error logs omit connection strings and arbitrary payloads. The pinned synthetic step supplies attempts and isCompensating, as required by getJobId.

Changes: redis-retry-process.cjs, test-overlay installer and source-snapshot CI. Existing server-only application guard remains; this standalone constructor experiment does not enable application worker mode or change the registered inmemory engine.

Validation PASS: code 962bd4fa6392faddc92bec5230319b072b026585; Actions https://github.com/karukimori-wq/numeria-place/actions/runs/42447238131. Fixed build/typecheck PASS; Redis SIGKILL marker PASS; normal 3 suites / 51 passed + 1 skipped; four independent restart suites each 1/1 PASS and four supervisor markers. Final job success and logs checked. Initial run 42446666695 failed in the new child; connection readiness was made explicit before lifecycle startup and the full run passed. Initial generic child logging did not establish a precise exception; do not claim more than the observed failure and successful correction.

Next gates: real persisted workflow checkpoint execution and side-effect idempotency; worker death after callback but before acknowledgement; competing NP lease ownership; Redis outage/recovery. Arbitrary partial orders, general repair, actual Stripe, NS delivery, production adoption/G0 remain incomplete. Draft PR #2; no main merge, production effects or funds.
