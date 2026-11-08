# B3-05c-3t: Redis callback effect before acknowledgement

2026-11-08 JST. Independent Redis storage experiment; not a real Mercur order workflow or production idempotency implementation.

Extends the existing actual Medusa Redis storage/worker test with NP_REDIS_ACK_CASE=1. The producer persists a retry then is killed. A separate worker checks the original synthetic workflow/transaction identity, commits a Redis script containing callback count + receipt HSETNX + conditional synthetic effect counter, then kills itself with SIGKILL before returning to the queue processor. Parent requires SIGKILL, callback/effect count 1, and the job still active. A fresh worker waits for natural lock expiry/stalled detection and redelivery. Parent requires two callbacks, one receipt, one effect, empty active list, no failed job, and stable counters during the observation window. No manual lock deletion, job requeue or synthetic timestamp update.

Test-only worker lockDuration=1000ms, stalledInterval=500ms, maxStalledCount=1 bound execution time. These are not production worker settings. Existing non-ack experiment keeps original defaults. Random prefix and local Redis DB14 isolation/cleanup remain.

This demonstrates redelivery and suppression only for a synthetic effect and receipt committed atomically in the same Redis script. A Redis receipt separate from a payment/order commit would leave another crash gap; never adopt this as a distributed ACID or general exactly-once guarantee. No TTL is used in the fixture; production receipt retention/eviction/durability policy remains unresolved. Redis server failure/persistence itself is not tested by killing application processes.

Changes: redis-retry-process.cjs and source-snapshot workflow. Existing application stays server-only with inmemory engine. No actual Stripe/NS calls, production migration, main merge or funds.

Validation PASS: code 04be3e4826c936f9c86cc8b19771a1243ebe4df9; Actions https://github.com/karukimori-wq/numeria-place/actions/runs/42452335045. Fixed build/typecheck PASS; both Redis experiment markers PASS; normal 3 suites / 51 passed + 1 skipped; four independent restarted suites each 1/1 PASS and four supervisor markers. Final job success and logs checked. New marker confirms natural stalled recovery, two callback deliveries and one atomic synthetic effect.

Next: execute real persisted workflow checkpoints with transactionally idempotent domain effects and test ownership against NP reconciliation. Actual Stripe retrieval/webhook delivery and NS send remain pending. Partial-order auto repair and G0/release are not complete.
