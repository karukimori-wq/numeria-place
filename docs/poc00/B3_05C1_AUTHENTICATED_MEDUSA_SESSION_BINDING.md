# B3-05c-1 — authenticated buyer checkout and actual Medusa session binding

Date: 2026-10-23 JST. Branch `poc/stripe-direct-security-00`, Draft PR #2.
Mercur remains pinned at `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`.

## Scope

B3-05b called the DI-loaded provider with a pre-seeded NP `ps_...` identifier. This stage calls **the real Medusa Payment Module's `createPaymentSession`** through authenticated HTTP. Medusa creates the `payses_...` row and invokes the actual registered provider; the adapter verifies the persisted session and binds it to the NP session before any Stripe intent creation.

This is still a disposable Mercur integration app with real PostgreSQL/Medusa authentication, but an **offline Stripe transport**. The authoritative order/cart/collection association is seeded by trusted test fixtures. There is no production checkout-snapshot ingestion, Clerk integration, cart-to-collection remote-link creation, standard Mercur cart/order completion, or new deployment.

## Server controls

- `POST /np-checkout/:order_id` uses Medusa customer bearer/session authentication. An actor ID in the body or a forged bearer does not grant access.
- Order lookup includes authenticated buyer ownership; other buyers receive the same not-found response as an unknown order.
- Browser body must be empty: account, amount, fee, listing and session references are server-controlled.
- The real cart must belong to that buyer, remain uncompleted, and contain exactly one line with quantity 1, the expected listing reference, price and currency. Shipping, tax lines and discounts are rejected in this narrow digital-item PoC rather than incorrectly priced.
- The real Medusa Payment Collection amount/currency must equal the NP order’s recorded values used by the existing resolver. Full DB-level immutability remains a separate gate.
- A database lease serializes creation. A random checkout proof exists only in server `AsyncLocalStorage`; only its SHA-256 hash is persisted. The raw proof never enters Medusa `data`/`context`, HTTP output or Stripe metadata.
- The provider reads the real auto-generated Medusa session from its own module service. Collection, provider, amount/currency, lease and server proof must match before binding.
- A Medusa session supplied through ordinary `createPaymentSession` without the authenticated server scope is rejected before Stripe calls.
- `payses_...` → NP `ps_...` mapping is unique. The underlying NP reservation/intent registry still supplies Stripe idempotency and seller routing.
- Repeated HTTP requests return the existing real Medusa session. A lost HTTP response after persistence must not create a second intent.
- A dangling/failed cross-database binding stops for reconciliation. It is not erased to enable a blind new charge. Automatic repair of that failure is NOT implemented.

## Changed files

- `poc/mercur-integration/payment/checkout-binding.ts`: authenticated orchestrator, request-local proof, persisted session verification and mapping.
- `payment/checkout-binding-schema.sql`: disposable trusted authority projection and unique session mapping.
- `payment/service.ts`: adapt Medusa-generated sessions to the existing NP resolver.
- `payment/runtime.ts`: response-loss fault injection for integration tests only.
- `api/buyer-route.ts`, `api/middlewares.ts`: authenticated HTTP and empty-body contract.
- `scripts/install-direct-runtime.mjs`: test-app injection and focused typecheck coverage.
- `http/np-buyer-checkout.spec.ts`: 9 authenticated real-Medusa tests.
- `.github/workflows/poc00-b3-mercur-checkout-binding.yml`: run B3-05b and B3-05c-1 together.

## Tests

1. Anonymous, forged bearer and other buyer denied without Stripe calls.
2. Browser-supplied account/amount/fee/order denied.
3. Real Medusa `payses_` row created, bound to NP `ps_`, trusted account used once, repeat reuses session.
4. Ordinary module invocation without server proof denied.
5. Changed cart owner/price denied.
6. Multiple cart items and collection amount mismatch denied.
7. Eight concurrent authenticated requests create one intent/session.
8. Injected response loss after persistence returns the same session on retry.
9. Dangling binding stops for reconciliation without issuing another intent.

CI: **PASS — patched Mercur build, focused implementation + test typecheck, 2 suites / 19 tests** (B3-05b regression 10 + new authenticated checkout 9). Tested commit `52cd70c1a49c464fbaf3985f029105eb23ac2413`. [Final Actions 39860234318](https://github.com/karukimori-wq/numeria-place/actions/runs/39860234318).

Initial [run 39859221589](https://github.com/karukimori-wq/numeria-place/actions/runs/39859221589) passed build/typecheck and 17/19 tests. The two negative mutation tests used the wrong Medusa update API signatures and therefore did not change the cart/collection. Corrected tests use `updateCarts(id, data)`, `updateLineItems(id, data)` and `updatePaymentCollections(id, data)`, assert actual mutation, and use typed Cart/Payment interfaces. The new test file is now included in focused typecheck.

Correction commit `01940701c52b88ff7cb1866bd370c1228aa5a312`; [rerun 39859834562](https://github.com/karukimori-wq/numeria-place/actions/runs/39859834562) caught further test-source type issues: `addLineItems` is the public Cart API, and a possibly missing fixture line needed a guard. The new typed auth fixture uses Medusa's official `generateJwtToken` rather than importing an upstream helper that is not strict-typechecked. Corrected in `52cd70c1a49c464fbaf3985f029105eb23ac2413`.

Final [verification 39860234318](https://github.com/karukimori-wq/numeria-place/actions/runs/39860234318) completed successfully; the log shows `2 passed, 2 total` suites and `19 passed, 19 total` tests. Focused typecheck now includes both the added runtime implementation and the new Cart/Payment-typed test.

Same-code [B3-05b runtime regression](https://github.com/karukimori-wq/numeria-place/actions/runs/39860234356) and [B3-04b PostgreSQL signed webhook regression](https://github.com/karukimori-wq/numeria-place/actions/runs/39860234473) also succeeded.

[Notion detail](https://app.notion.com/p/401e71121fed817a8243d8b4c85bee5c).

## Remaining work / next stage B3-05c-2

- Ingest trusted snapshots from real seller/listing/offer/cart/payment-collection links instead of fixture authority rows. Lock or version the cart and financial snapshot across validation and completion.
- Integrate the standard Mercur cart/split-order completion workflow and reconcile it with NP paid/Inbox/Intake/Outbox across process failures. A successful Medusa session creation is NOT a completed Mercur order.
- Cross-database orphan repair/worker; tests here intentionally stop safely rather than automatically re-create a session.
- Standard seller refund/cancel HTTP authorization, real Stripe Test Mode/API/webhook delivery, NS worker, PDF/full-text entitlements, cumulative refund/dispute accounting, AWS and Japan contracts.
- Production `apps/api` configuration and Clerk identity mapping are untouched.

Main, production and actual funds remain untouched. G0 and full B3-05 acceptance remain pending.
