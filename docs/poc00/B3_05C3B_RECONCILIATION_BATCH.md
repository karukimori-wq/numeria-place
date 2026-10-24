# B3-05c-3b: bounded reconciliation batches

2026-10-24 JST. Disposable integration app; offline Stripe transport.

Changes: `payment/reconciliation-batch.ts`, `payment/completion.ts`, and `http/np-source-checkout.spec.ts` under `poc/mercur-integration`.

The internal batch entry now selects at most 100 paid source-authority orders by order ID, with an exclusive cursor. It returns per-order completed/review/retry results and a next cursor. One rejection does not abort later candidates. Duplicate IDs are processed once per batch; exception messages/payloads are not returned. Missing PaymentIntent bindings fail for reconciliation rather than disappearing through an inner join and being reported as completed.

Tests exercise mixed callback outcomes, duplicate suppression, message exclusion and batch limits, plus 101 actual PostgreSQL candidates across two pages. The latter deliberately lack Intent bindings and must all return retry with no additional Stripe creation.

The cursor is ephemeral, not a durable retry queue or completion watermark. A full scan must restart from the beginning to revisit failures and late insertions behind a cursor. A full 100-row page can yield one final empty page. This is an internal entry only, with no public repair endpoint. Ordering does not establish business priority.

Not implemented: persistent worker checkpoints/backoff, scheduled execution, automatic partial-order repair, discovery of unlinked orders, forced-process termination/resume, production DB privilege policy, real Stripe or NS delivery. No main merge, production or funds.

Validation: [Actions 40095707805](https://github.com/karukimori-wq/numeria-place/actions/runs/40095707805): fixed Mercur patched build and implementation/test typecheck PASS; 3 suites / 38 tests PASS. Final logs read. Tested commit ce20197741f92fb721f2d08e41123c1061e6fccb. Limited batch integration accepted; production recovery worker remains incomplete.
