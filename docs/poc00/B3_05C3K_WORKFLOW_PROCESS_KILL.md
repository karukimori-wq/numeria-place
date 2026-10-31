# B3-05c-3k: registered workflow process SIGKILL

2026-10-30. Disposable pinned Mercur overlay; limited experiment PASS; full restart reconciliation remains pending.

## Experiment

The existing real source fixture starts the registered complete-cart-with-split-orders workflow through signed synthetic HTTP. A test-only spy awaits the actual seller module createOrderGroups call, writes only test database/cart/order identifiers to a private temporary checkpoint, then SIGKILLs that Medusa/Jest process. It does not throw an injected exception or invoke compensation. Concurrent order creation may have persisted other records; no claim of zero orphan orders is made.

A separate Node process checks exit signal and checkpoint, reconnects to the surviving Medusa and NP databases, requires one committed order group and incomplete cart, and verifies NP paid survived. It applies the conservative disposition and exercises the actual durable retry primitive with the partial-completion sentinel; a subsequent retry must not invoke its callback. The checkpoint is deleted. Connection credentials remain in inherited test environment, never checkpoint content.

## Exact limits

This proves termination during actual workflow execution and fresh-process DB inspection, subject to CI success. The recovery process does **not** boot Medusa, execute reconcilePaidOrder, resume the stored workflow, inspect all engine steps, or repair orphan orders. The review callback deliberately raises the existing partial-completion sentinel after the DB assertions; it is not evidence of the full production reconciliation path after restart. The order-count input to disposition is immaterial for one group plus incomplete cart; it is not an observed seller-order count.

Next: bootstrap Medusa against the surviving disposable database, enumerate actual orders/links and workflow state, and run standard paid reconciliation without starting a new order-creation workflow. Exhaustive orphan discovery, automatic repair, actual Stripe/NS sending, periodic worker, production DB policy, G0 and release remain pending.

## Files

- poc/mercur-integration/http/np-source-checkout.spec.ts: opt-in crash case; skipped in normal regression.
- poc/mercur-integration/http/workflow-kill.cjs: parent supervisor and fresh-process DB assertions.
- poc/mercur-integration/scripts/install-direct-runtime.mjs: copy harness to disposable app.
- .github/workflows/poc00-b3-mercur-source-snapshot.yml: separate kill verification step after normal regression.

No main merge, production changes, real Stripe calls or real funds. PR #2 remains Draft.


## Evidence

Tested code: `3d7f101ebdea139ea4ee33661727e9ee25e0dacf`.
[Actions 41039638988](https://github.com/karukimori-wq/numeria-place/actions/runs/41039638988): pinned build/typecheck PASS; normal regression 3 suites / 48 passed, 1 skipped (49 declared); independent workflow SIGKILL step PASS. Final logs read, including the explicit fresh-process verification success message. Do not report 49 ordinary regression passes.

The first run failed before workflow startup because the child lacked --experimental-vm-modules. Explicit child Node flags were aligned with the existing integration command; no acceptance assertions were removed.
