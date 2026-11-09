# B3-05c-3e: internal operator requeue boundary

2026-10-25 JST. Limited offline integration PASS.

Changed files: poc/mercur-integration/payment/reconciliation-requeue.ts and poc/mercur-integration/http/np-source-checkout.spec.ts.

The internal operation checks an enabled actor grant in a server-controlled test table. Actor ID must originate from trusted server identity. No public HTTP endpoint, real login mapping, Clerk integration or production RBAC is implemented. Fictitious grants validate the DB boundary only.

Only review rows stopped for attempt_limit can requeue. Expected attempt count must match under row lock; partial_completion, running, completed and already-retrying rows are rejected. The fixed binding_verified reason records an operator declaration; normal reconciliation still performs authoritative binding checks. This operation does not repair partial orders.

Additional budget is bounded to 1..5 with total ceiling 100 (PoC settings). Attempts/history are retained. Queue change and audit insertion commit together. Request UUID serialization and exact payload matching provide idempotency and conflict rejection. Grant share locking serializes revocation with the operation; revoked actors cannot replay even an old request.

[Actions 40105423386](https://github.com/karukimori-wq/numeria-place/actions/runs/40105423386), job 120905999829: patched build and implementation/test typecheck PASS; 3 suites / 44 tests PASS. Final logs read. Tested code: 6b5a09ff6d8e96702af184f6fa291e75def58377.

Tests cover denied operator, enabled grant, concurrent duplicate requests (one audit/budget change), changed request conflict, next attempt retaining its count, revoked grant, stale count and partial-completion refusal without an audit mutation.

Limits: test DB grants/audit are not production tamper-proof; no administrator login, management UI, rejected-action audit, automated repair, scheduler, process-kill/resume proof or real Stripe/NS delivery. No main merge/deployment/funds. Draft PR #2 remains Draft.

Next: connect a trusted authenticated administrative boundary and verify HTTP authorization, audit access and safe operator review. Production identity choices must follow existing specifications.
