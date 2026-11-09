# B3-05b — pinned Mercur Payment DI, signed HTTP and pre-write payout guard

Date: 2026-10-23 JST. Branch: `poc/stripe-direct-security-00`, Draft PR #2.
Upstream: `mercurjs/mercur@9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`.

## Acceptance boundary

This overlay installs into the **real pinned Mercur integration test app**. It does not modify a deployed Mercur app or `main`. Stripe API transport is a deterministic offline fake. Signatures are generated and verified locally using Stripe SDK v23; PostgreSQL 15 and Redis 7 are real CI services.

The payment adapter is loaded by Medusa `ModuleProvider(Modules.PAYMENT)` and resolved through the running payment module. The HTTP endpoint processes real requests into **NP PoC tables**, not Medusa order/cart completion. Do not treat those two forms of order completion as equivalent.

## B3-05-01: actual fixed-source paths and functions

| Concern | Pinned source | Integration change / evidence |
|---|---|---|
| App configuration | `apps/api/medusa-config.ts`, `integration-tests/medusa-config.ts`; `withMercur` | Only disposable integration config receives Payment and Payout modules. Production app config remains unmodified. |
| Payout DI | `packages/core/src/modules/payout/loaders/provider.ts`, `moduleProviderLoader`; `services/provider-service.ts`, `createPayout` | Exactly one NP no-Transfer provider, never the upstream Stripe payout provider. |
| Payment HTTP | `packages/core/src/api/hooks/payment/[provider]/route.ts`, `POST` | NP provider IDs rejected before event emission. Dedicated `/hooks/np-direct` owns processing. |
| Payment subscriber | `packages/core/src/subscribers/payment-webhook.ts`, default handler | Existing handler calls `getWebhookActionAndData` then `processPaymentWorkflow`. NP adapter returns `not_supported` here to prevent a second path. |
| Payment completion | `packages/core/src/workflows/payment/workflows/process-payment.ts`, `processPaymentWorkflow` | Authorize/capture and `completeCartWithSplitOrdersWorkflow`; **not yet integrated with NP completion**. |
| Split completion | `packages/core/src/subscribers/split-order-payment-captured.ts`; `workflows/payment/workflows/split-order-payments.ts` | Standard split/capture/cancel behavior remains outside NP DI+HTTP acceptance. |
| Payout workflow | `packages/core/src/workflows/payout/workflows/create-payout.ts`, `createPayoutWorkflow` | Calls `createPayoutStep`; graph resolves seller account and commission. |
| Payout step | `packages/core/src/workflows/payout/steps/create-payout.ts`, `createPayoutStep` | Calls `payoutService.createPayouts(input)`. |
| Payout service | `packages/core/src/modules/payout/services/payout-module-service.ts`, `createPayouts` | Fixed-SHA patch throws BEFORE `createPayouts_`, DB insert or provider invocation. All public service callers share this boundary. |
| Transfer SDK call | `packages/providers/payout-stripe-connect/src/services/stripe-connect.ts`, `StripeConnectProviderService.createPayout` | Sole literal `transfers.create` call found in pinned apps/packages TS source. Provider is not registered in this test app. |
| Refund HTTP | `packages/core/src/api/vendor/payments/[id]/refund/route.ts`, `POST` | Uses Medusa `refundPaymentWorkflow`. NP provider refund invocation account-scoped; seller HTTP authorization is not covered. |
| Refund hooks | `packages/core/src/workflows/payment/workflows/payment-hooks.ts`, `refundPaymentWorkflow` | Mercur wraps Medusa refunds. This overlay does not prove standard refund workflow reconciliation. |
| Cancel | `packages/core/src/workflows/payment/workflows/split-order-payments.ts`, `cancelPaymentStep` | Registered provider cancel invocation is account-scoped; standard cart cancel E2E remains pending. |

Full `rg` across pinned `apps`/`packages` TypeScript source (excluding test/spec files) located payout workflow definition, step, service/provider delegation, and the single Stripe SDK call above. No app-level API, subscriber or job invoking `createPayoutWorkflow` was found. This is a fixed-source audit, not a guarantee against new runtime plugins or arbitrary external code.

## Implemented

- `poc/mercur-integration/payment/index.ts`: actual Medusa Payment provider module.
- `payment/service.ts`: `AbstractPaymentProvider` adapter around the B3 prototype.
- `payment/runtime.ts`: real PostgreSQL resolver/registry/reservation + offline Stripe transport, restricted to local disposable test DB and `NODE_ENV=test`.
- `api/route.ts`, `api/middlewares.ts`: preserved raw body, signature verification before transaction, 200 only after COMMIT. Invalid signature 400; missing/unbound intent, account mismatch and DB failures 503 to allow retry/reconciliation. Responses omit internal errors and payloads.
- `scripts/install-direct-runtime.mjs`: SHA assertion, Payout module and legacy webhook patch **before** build; NP provider/route/source/schema copies and focused typecheck config.
- `.github/workflows/poc00-b3-mercur-direct-runtime.yml`: patched upstream build, focused NP typecheck against Medusa 2.21.2, real DI+HTTP tests.

The payout guard intentionally rejects **all** Mercur payouts in this Direct-only test app, including invalid/nonexistent account IDs, before DB lookup. It is not a final per-order mixed-mode settlement policy and must not be deployed as one.

## Test cases added

1. Real Payment DI registration, trusted Connect account and three persistent intent bindings.
2. Repeated session reuses intent; mismatched amount and cross-account references denied; status retrieval.
3. Invalid HTTP signature leaves Inbox/Intake/Outbox empty.
4. Valid signature with another Connect account cannot mark paid.
5. Sixteen concurrent HTTP notifications yield one paid transition/Intake/Outbox, no legacy event emission.
6. Legacy HTTP endpoint rejects NP provider; subscriber adapter cannot complete again.
7. Notification before intent binding returns 503, then exact signed retry succeeds after binding.
8. Failure before COMMIT rolls back, then retry commits once.
9. Refund/cancel use original Connect account; paid order cannot initiate another payment.
10. Eight concurrent actual Mercur payout service attempts never call provider and create no payout row.

CI result: **PASS — patched Mercur build, focused NP typecheck, 1 suite / 10 tests** on tested commit `e216d061dbda89bc6f9b69897f99ee0a9048986f`. [Final Actions run](https://github.com/karukimori-wq/numeria-place/actions/runs/39814075675). All 12 workflows on that commit completed successfully.

Initial run https://github.com/karukimori-wq/numeria-place/actions/runs/39812322518 passed the patched upstream build but failed focused typecheck. The typecheck found a genuine Stripe SDK v23 incompatibility: `paymentIntents.retrieve(id, {stripeAccount})` must pass request options as the **third** argument, `retrieve(id, {}, {stripeAccount})`. Both production-candidate call sites and offline mocks were corrected. TypeScript resolution was also changed to Node16 to honor Medusa package exports. SDK dependencies now install outside the frozen upstream workspace.

Correction commit: `080a330720c4ab0d3b85539000fadb652cb09beb`. The next typecheck then found that the original `IPaymentProvider.getWebhookActionAndData` prototype accepted the whole event envelope rather than Medusa's `ProviderWebhookPayload["payload"]`. Corrected implementation and signature tests in `e216d061dbda89bc6f9b69897f99ee0a9048986f`; the final run above passed typecheck and all 10 runtime tests.

Additional successful regression runs on the same tested commit: [B3-04b PostgreSQL](https://github.com/karukimori-wq/numeria-place/actions/runs/39814075708), [Payment prototype](https://github.com/karukimori-wq/numeria-place/actions/runs/39814075662), [Mercur standard HTTP parity](https://github.com/karukimori-wq/numeria-place/actions/runs/39814075676), [Payout DI](https://github.com/karukimori-wq/numeria-place/actions/runs/39814075664).

## Next engineering stage: B3-05c

Map authenticated buyer/cart and single seller/listing snapshots to Medusa-generated Payment Sessions, then connect standard cart/order completion to the NP paid/Intake/Outbox transaction with crash recovery. Reject caller-supplied account/price/fee/session ownership. Verify the real store checkout and seller refund/cancel HTTP authorization before claiming full B3-05 completion. Keep real Stripe Test Mode as a separate gate; no production/main/funds authorization is implied.

## Still not completed

- Medusa-generated `payses_...` session issuance mapped to NP `ps_...` trusted session and buyer ownership. This test resolves the registered provider and calls it with pre-seeded trusted NP sessions; it does **not** exercise standard store checkout.
- Medusa cart/order completion and NP paid/Outbox reconciliation as one recoverable business flow. Exactly-once behavior asserted here applies to NP tables.
- `apps/api` real deployment configuration and authentic seller/product/cart records.
- Standard vendor refund/cancel HTTP authorization, cumulative partial refunds/application fee policy, disputes/chargebacks.
- Real Stripe Test Mode API, webhook delivery, NS dispatch worker, PDF/full-text authorization, immutable orders, AWS isolation and Japan contracts.
- Arbitrary third-party plugins/jobs or direct SDK clients outside this pinned test configuration.

No main merge, production changes or real funds. G0 and Mercur adoption remain pending.
