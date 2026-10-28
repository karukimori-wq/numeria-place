# B3-05c-3j: process interruption and bounded orphan review

2026-10-28. Disposable pinned Mercur integration overlay only. Validation pending.

## Change and acceptance checks

- A real Node 24 child loads the actual retry implementation with its own PostgreSQL pool. IPC readiness occurs after its running claim commits. The parent sends SIGKILL and verifies the exit signal, running row, token and missing result history. An unexpired claim cannot be taken. After the actual 90-second database-clock lease expires (no timestamp edits), one recovery completes attempt 2, with no invented attempt-1 result.
- A separate live child is suspended in its callback; controlled SQL lease expiry allows a replacement claim. Resuming the old process cannot update the queue or insert history. This is fencing verification, not a second kill experiment.
- Paid candidates are rediscovered from both checkout authority and completion ledger. A known completion whose authority disappears stops with `orphan_state`; it cannot be marked completed merely because no source row was found. Independent legacy webhook fixtures remain separate from source completion claims.
- Real partial order-group fixtures enter durable `partial_completion` review. Repeated scans do not start another workflow. Neither partial nor orphan review qualifies for the existing operator attempt-limit requeue.

## Scope and remaining mandatory work

This kills the **queue claimant**, before any Mercur workflow callback. It does not terminate the Medusa server, Redis worker, or a running Mercur completion workflow. Arbitrary workflow-step interruption, PostgreSQL connection loss during module commits, completed-result corruption, orphan sessions/collections without surviving authority/completion evidence and automatic repair remain unverified.

The scanner discovers only paid NP records with surviving authority/completion candidates. Missing NP order rows, completely lost source evidence, and all other orphan types need a separate audit scanner; this is not exhaustive orphan discovery. Existing `ON CONFLICT DO NOTHING` intentionally preserves completed/review queue rows, so later corruption of a completed row needs a future audit path.

NP paid and Mercur completion remain separate commits. NS Intake/Outbox are unsent records. A future PREPAY sender must require verified NP paid evidence plus verified Mercur completion/binding, and stop on partial/orphan/review/mismatched states; merely having an Intake/Outbox row is insufficient. Postpay fulfillment requires its separately approved prepayment-independent admission policy. No sender is implemented here.

No actual Stripe transport/webhook delivery, NS delivery, periodic worker, production migration/least privileges, G0, adoption or release. PR #2 stays Draft. No main merge, production changes or real funds.

## Files

- `poc/mercur-integration/payment/completion.ts`
- `poc/mercur-integration/payment/reconciliation-batch.ts`
- `poc/mercur-integration/payment/reconciliation-retry.ts`
- `poc/mercur-integration/http/np-source-checkout.spec.ts`
- `poc/mercur-integration/http/retry-process.cjs`
- `poc/mercur-integration/scripts/install-direct-runtime.mjs`

## Validation

Local syntax and diff checks pass. Pinned Mercur build/typecheck/integration results will be recorded after Actions completes. Three new test cases; the existing partial-state case is also extended. No pass claimed before final logs.
