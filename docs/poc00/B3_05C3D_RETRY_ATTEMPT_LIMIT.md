# B3-05c-3d: retry attempt ceiling and review handoff

2026-10-24 JST. Offline disposable integration app only.

Changed: `payment/reconciliation-retry.ts` and `http/np-source-checkout.spec.ts` under `poc/mercur-integration`.

Each queue row persists max_attempts (1..100; default 5 for this PoC only). Claims require attempts below that limit. The final allowed attempt may succeed; a failed final attempt becomes review with stop_reason=attempt_limit. Partial-completion errors remain review with stop_reason=partial_completion. Queue finalization and result history remain atomic and fenced by the unexpired lease token.

An expired running claim, or retry row already at its ceiling, moves to review without another callback. Active leases are not stolen. The terminal review state/reason persists in the queue; no fabricated result-history entry is added for a callback that crashed and produced no result. Claim count is retained. No automatic reopening of review rows or resetting attempts during authoritative paid-order scans.

Tests verify failure and success on the last attempt, no later callback, result-history status, exhausted crashed-lease handoff, active-lease protection and progress for another fresh order. Existing 40 integration tests remain included.

This is a worker execution limit, not a cap on Stripe webhook delivery, payment deadline or approved production policy. Dedicated signed HTTP reconciliation is independent. Operator requeue/auth/audit UI, scheduling, complete process-kill/resume proof, automatic partial repair, real Stripe/NS delivery, production migrations/DB roles and G0 remain pending. No main merge, deployment or real funds. Draft PR #2 stays Draft.

Validation: [Actions 40097784285](https://github.com/karukimori-wq/numeria-place/actions/runs/40097784285): patched build and implementation/test typecheck PASS; 3 suites / 42 tests PASS. Final job logs read. Tested code b68f0119b2aa2c0649854a8e3119ef9e15727ddc. Limited offline guard integration accepted; scheduler and production recovery remain incomplete.
