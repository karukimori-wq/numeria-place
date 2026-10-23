# B3-05c-2b — Sealed Mercur completion and paid-state reconciliation

Date: 2026-10-23 JST. Status: limited offline integration PASS. Patched build, implementation/test typecheck and 3 suites / 34 tests passed. This does not accept all B3-05 requirements, G0 or production.

Disposable integration app only, Mercur `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`. Stripe transport is offline; synthetic signatures use the official SDK. No production configuration, real Stripe API, funds or main merge.

## Actual source paths and execution

- `packages/core/src/workflows/cart/workflows/complete-cart-with-split-orders.ts`: registered `complete-cart-with-split-orders`, real order group / seller order / remote links, cart `completed_at`, authorization, captured-payment split, commission projection. Its order-group lookup avoids a second group on retry. The disposable overlay preserves explicit `requires_shipping: false` for NP-provider carts instead of forcing every Offer profile into physical shipping; other providers keep the pinned behavior.
- `packages/core/src/workflows/payment/workflows/process-payment.ts`: legacy dispatcher can continue after permanent completion failure. NP does not route its events through this asynchronous dispatcher.
- `packages/core/src/workflows/payment/workflows/split-order-payments.ts`: records existing captured funds against the seller order without creating another provider session/charge.
- `packages/core/src/workflows/payment/steps/create-order-payments.ts` and `record-payment-captures.ts`: generated module row methods and `is_captured: true`, not a second Stripe charge.

`poc/mercur-integration/payment/completion.ts` is an internal reconciliation entry. It reads NP authority and paid/Inbox/Intake/Outbox evidence, verifies the sealed hash, the real Medusa provider session and captured status through its actual DI provider on the original Connected Account, and rechecks the live source before initial completion. It serializes the order through a PostgreSQL advisory lock, persists a cart/hash-specific completion ledger, calls the registered standard workflow, and verifies exactly one group/order with the original buyer/seller/currency/amount and one item before marking reconciliation completed.

The signed HTTP endpoint commits the NP transaction first, then reconciles only the accepted succeeded event's order. It returns 503 if completion or acknowledgement fails; identical signed-event retry still invokes reconciliation. `reconcilePaidOrders` is the internal worker entry for recovery without depending on another webhook. It is not publicly exposed or automatically scheduled.

The cart seal remains installed. A pending ledger permits only completion timestamp changes and order-group / order-cart link writes needed by the standard workflow and compensation. Cart buyer, lines, amounts, currency, adjustments and payment collection principal remain frozen. After the ledger completes, that exception closes. This is a test DB policy, not a production database-role or row-authorization boundary.

## Verification scope

The integration fixture also links a real inventory item because the standard workflow requires that relation even for unmanaged inventory. Tests add unpaid-completion rejection, provider-state mismatch rejection, durable NP-paid recovery before Mercur completion, lost acknowledgement after standard completion, standard completion on signed replay, parallel delivery, no additional provider charge/capture, seller-order refund through the actual Payment Module, and unchanged financial seals. Existing auth/source/financial-seal/no-Transfer tests remain in the run. Final evidence is recorded below. The real refund path exposed that Medusa passes `refund.raw_amount` to providers. The core adapter now normalizes numeric raw values before safe-integer/bounds checks; raw malformed/unsafe amount regressions were added. This fixes interface compatibility, not cumulative-refund accounting.

## Explicit limits

- NP paid/Intake/Outbox commit precedes Mercur order completion; this is reconciliation, not a distributed ACID transaction. Intake and Outbox remain unsent database records. A future delivery worker must gate on the required completion/fulfillment policy.
- Recovery covers the tested boundaries; arbitrary terminated Medusa workflow transactions, orphan sessions/collections, partial-order/group corruption and production retry scheduling/backoff remain unresolved until separately tested.
- The completion ledger is writable by the test application's DB role; production least-privilege/DB policy is not implemented. Order records and global catalog are not comprehensively immutable.
- The existing single-line digital JPY fixture restrictions remain. Fees are zero only in this fixture; no commercial fee/deadline is adopted.
- Real Stripe Test Mode/API/webhook, actual NS sending, Clerk, seller refund/cancel HTTP authorization, cumulative refunds/disputes, full-text/PDF entitlement, AWS, Japan contracts, G0 and formal Mercur adoption remain pending.

## Changed files

- `poc/mercur-integration/payment/completion.ts`: trusted paid reconciliation and internal batch entry.
- `poc/mercur-integration/payment/cart-seal.ts`: pending completion ledger and narrow write exceptions; closes after verified completion.
- `poc/mercur-integration/payment/source-checkout.ts`: explicit no-shipping eligibility.
- `poc/mercur-integration/payment/runtime.ts`: offline boundary fault injection.
- `poc/mercur-integration/api/route.ts`: signed accepted-order reconciliation before HTTP acknowledgement.
- `poc/mercur-integration/scripts/install-direct-runtime.mjs`: exact upstream digital-line patch and all three HTTP specs in the focused typecheck.
- `poc/mercur-integration/http/np-source-checkout.spec.ts`: actual inventory relation, completion / capture-state / replay / seller-order refund tests.
- `poc/mercur-integration/http/np-direct-runtime.spec.ts`: shared authority schema setup for regression compatibility.
- `poc/mercur-direct/src/numeria-direct-payment-provider.ts`: Medusa raw numeric input normalization.
- `poc/mercur-direct/test/numeria-direct-payment-provider.test.ts`: raw refund and invalid/unsafe value regressions.
- `.github/workflows/poc00-b3-mercur-source-snapshot.yml`: completion verification and corrected scope summary.

## Next

B3-05c-3: terminated workflow/partial-order/orphan-state reconciliation, recovery worker scheduling and controlled retries. Keep real Stripe Test Mode/API and real webhook delivery separate until the test environment is prepared. Draft PR #2 stays unmerged.


## Final evidence

- Tested code: `fbc859077df2455dc74ec1624c5fecb8707ad256`.
- [Integration Actions 39892929211](https://github.com/karukimori-wq/numeria-place/actions/runs/39892929211), job `120216636898`: completed / success; patched fixed-SHA Mercur build PASS; focused implementation and all three HTTP-test typechecks PASS; **3 suites / 34 tests PASS** (19 prior runtime/buyer + 15 source/completion).
- [Provider unit Actions 39892929048](https://github.com/karukimori-wq/numeria-place/actions/runs/39892929048), job `120216636511`: **13 PASS / 0 FAIL**, including raw numeric refund / malformed amount regressions. Counts are separate from integration tests.
- Final logs were read, not inferred from workflow registration. Initial inventory-fixture, raw-amount compatibility and test-setup/link-direction failures were corrected and rerun; failed runs are not acceptance evidence.
- [Notion detail](https://app.notion.com/p/402e71121fed8102831fe2c707d30f5b) and [progress tracker](https://app.notion.com/p/3f7e71121fed81509f2bfb2325128cd9).

| Assertion | Final evidence |
| --- | --- |
| Real source -> Medusa session -> signed NP paid -> standard seller order | One group, one buyer/seller order, one digital item, same JPY principal |
| Unpaid or uncaptured state | Completion rejected; no completion permit for uncaptured provider state |
| Failure after NP commit / before standard completion | Internal reconciliation completes without another intent |
| Completion succeeded / acknowledgement lost | Identical event replay verifies existing group/order; no second order |
| Four parallel signed deliveries | All 200; one seller-order payment capture; one Intent creation |
| Refund through real Payment Module | Raw amount normalized; original Connected Account; offline refund call only |
| No standard Transfer | Zero payout rows through completed path; existing service-boundary concurrent rejection test passes |
| Seal after completion | Quantity/buyer changes and order-cart link dismissal rejected |

The dedicated endpoint still writes NS Intake/Outbox before Mercur completion and sends neither. Generalized worker delivery, arbitrary mid-workflow termination/repair, orphan state and production authorization/DB roles remain unaccepted.
