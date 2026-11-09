# B3-05c-3a: refuse fresh workflows for partial persisted completion

2026-10-24 JST. Limited guard, not automatic workflow recovery.

The previous reconciliation always invoked the standard completion workflow, including when persisted state was incomplete. It now reads order-group count, order-cart count and cart completion state before invocation:

| Group count | Order count | Cart completed | Action |
| --- | --- | --- | --- |
| 0 | 0 | no | Start registered completion workflow |
| 1 | 1 | yes | Verify existing result without invoking another workflow |
| Any other combination | Any | Any | Stop with NP_PARTIAL_COMPLETION_MANUAL_REVIEW |

Existing signature, NP paid evidence, original-account provider capture, source/hash and financial-seal checks remain required. A complete-looking result still undergoes buyer/seller/currency/amount/item verification before acknowledgement. Counts alone do not grant paid access.

Changed files: payment/completion-state.ts, payment/completion.ts and http/np-source-checkout.spec.ts under poc/mercur-integration. Tests cover all 18 count/completion combinations and a real persisted order group with no order after durable NP payment. Repeated reconciliation must reject before invoking the workflow, keep cart incomplete, and avoid another Intent.

This does not simulate process termination or resume an interrupted Medusa workflow transaction. It detects the tested persisted shape and fails closed. General orphan discovery, unlinked order detection, operator-approved repairs, scheduling, backoff, worker isolation and production DB permissions remain pending. No Stripe API/network, funds, NS delivery, main merge or production changes. Draft PR #2 remains Draft.

CI evidence: [Actions 40094985319](https://github.com/karukimori-wq/numeria-place/actions/runs/40094985319), job 120875231625: patched build PASS, implementation/test typecheck PASS, 3 suites / 36 tests PASS. Final logs read. Tested commit: 52a92c66eff17d9dedc1dc9016aadf162e5fdf82. Limited B3-05c-3a guard accepted; B3-05c-3 recovery worker remains incomplete.
