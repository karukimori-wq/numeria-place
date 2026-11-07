# B3-05c-3c: durable reconciliation retry state

2026-10-24 JST. Offline disposable integration app only.

`payment/reconciliation-retry.ts` persists a queue and append-only result history. `reconcileDuePaidOrders` in `payment/completion.ts` re-scans authoritative paid source orders with INSERT ON CONFLICT DO NOTHING, so it does not depend on a process-local cursor. It does not reset completed/review rows or overwrite backoff dates.

Due retries and expired running leases are atomically claimed with FOR UPDATE SKIP LOCKED. Each claim increments its durable attempt count and gets a new token and 90-second lease. Result update is conditional on the same unexpired token; history and queue update commit together. A crashed claim can be reclaimed after expiry. Overlapping executions still use the existing per-order reconciliation advisory lock and partial-result guard.

Retry waits use a 60-second exponential base capped at 3600 seconds. These are PoC operational settings, not payment deadlines or approved production settings. Partial-completion errors enter review; other errors enter retry. Only status, order ID, attempt and timestamp are stored; raw exception messages and payment bodies are omitted. No automatic reopening of review/completed rows.

Tests in `http/np-source-checkout.spec.ts` use real PostgreSQL to check persisted attempts/history, no early retry, due retry, review exclusion, concurrent single claims, and expired-lease recovery. Existing 38 integration tests remain included.

Limits: no scheduled process, heartbeat, retry-attempt ceiling, operator review/requeue API, production migration/DB privileges or real process-kill test. Rows with incomplete identity mappings need operator investigation; this queue does not repair them. Cross-database commits are reconciled, not distributed ACID. NS records remain unsent. Real Stripe, production deployment, funds and main merge remain excluded. Draft PR #2 stays Draft.

Validation: [Actions 40097212496](https://github.com/karukimori-wq/numeria-place/actions/runs/40097212496): patched build and implementation/test typecheck PASS; 3 suites / 40 tests PASS. Final job logs read. Tested code 21452973b08c00b5bf8f9979949857913dec388c. This validates DB-backed retry primitives in a disposable offline environment, not a deployed scheduler. Dedicated signed HTTP retries remain independent of worker backoff.
