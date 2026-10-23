# B3-05c-2b — Sealed Mercur completion and paid-state reconciliation

Date: 2026-10-23 JST. Status: implementation under CI verification; not accepted yet.

Disposable integration app only, Mercur `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`. Stripe transport is offline; synthetic signatures use the official SDK. No production configuration, real Stripe API, funds or main merge.

## Actual source paths and execution

- `packages/core/src/workflows/cart/workflows/complete-cart-with-split-orders.ts`: registered `complete-cart-with-split-orders`, real order group / seller order / remote links, cart `completed_at`, authorization, captured-payment split, commission projection. Its order-group lookup avoids a second group on retry.
- `packages/core/src/workflows/payment/workflows/process-payment.ts`: legacy dispatcher can continue after permanent completion failure. NP does not route its events through this asynchronous dispatcher.
- `packages/core/src/workflows/payment/workflows/split-order-payments.ts`: records existing captured funds against the seller order without creating another provider session/charge.
- `packages/core/src/workflows/payment/steps/create-order-payments.ts` and `record-payment-captures.ts`: generated module row methods and `is_captured: true`, not a second Stripe charge.

`poc/mercur-integration/payment/completion.ts` is an internal reconciliation entry. It reads NP authority and paid/Inbox/Intake/Outbox evidence, verifies the sealed hash and the real Medusa provider session, and rechecks the live source before initial completion. It serializes the order through a PostgreSQL advisory lock, persists a cart/hash-specific completion ledger, calls the registered standard workflow, and verifies exactly one group/order with the original buyer/seller/currency/amount and one item before marking reconciliation completed.

The signed HTTP endpoint commits the NP transaction first, then reconciles only the accepted succeeded event's order. It returns 503 if completion or acknowledgement fails; identical signed-event retry still invokes reconciliation. `reconcilePaidOrders` is the internal worker entry for recovery without depending on another webhook. It is not publicly exposed or automatically scheduled.

The cart seal remains installed. A pending ledger permits only completion timestamp changes and order-group / order-cart link writes needed by the standard workflow and compensation. Cart buyer, lines, amounts, currency, adjustments and payment collection principal remain frozen. After the ledger completes, that exception closes. This is a test DB policy, not a production database-role or row-authorization boundary.

## Verification scope

Tests add unpaid-completion rejection, durable NP-paid recovery before Mercur completion, lost acknowledgement after standard completion, and standard completion on signed replay. Existing auth/source/financial-seal/no-Transfer tests remain in the run. Final evidence will be recorded after CI completes.

## Explicit limits

- NP paid/Intake/Outbox commit precedes Mercur order completion; this is reconciliation, not a distributed ACID transaction. Intake and Outbox remain unsent database records. A future delivery worker must gate on the required completion/fulfillment policy.
- Recovery covers the tested boundaries; arbitrary terminated Medusa workflow transactions, orphan sessions/collections, partial-order/group corruption and production retry scheduling/backoff remain unresolved until separately tested.
- The completion ledger is writable by the test application's DB role; production least-privilege/DB policy is not implemented. Order records and global catalog are not comprehensively immutable.
- The existing single-line digital JPY fixture restrictions remain. Fees are zero only in this fixture; no commercial fee/deadline is adopted.
- Real Stripe Test Mode/API/webhook, actual NS sending, Clerk, seller refund/cancel HTTP authorization, cumulative refunds/disputes, full-text/PDF entitlement, AWS, Japan contracts, G0 and formal Mercur adoption remain pending.
