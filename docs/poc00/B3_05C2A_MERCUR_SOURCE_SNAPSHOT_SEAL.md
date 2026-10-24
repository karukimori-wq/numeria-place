# B3-05c-2a — real Mercur source projection and PostgreSQL checkout seal

2026-10-23 JST. Pinned upstream `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`.
Draft PR #2; branch `poc/stripe-direct-security-00`.

## What changed

B3-05c-1 manually seeded NP order/cart/collection authority rows. This stage derives those rows from actual Mercur/Medusa Product, Variant, Offer, Seller, Payout Account, Price, Cart and remote-link records. The records themselves are disposable test fixtures; this is not live merchant data or Stripe onboarding.

Authenticated `POST /np-cart-checkout/:cart_id` accepts no financial body fields. The server resolves the real line-item→Offer link, Offer→Seller/Product/Variant/Price links, Seller→Payout Account link and Cart→Payment Collection link. Client metadata listing/seller values are deliberately ignored.

The narrow candidate supports one digital line, quantity 1, published product, open seller, active payout account, one unambiguous positive JPY base price, no price list/tier/unrecognized rule, shipping, taxes or discounts. Offer/variant/product/cart price must agree. The existing NP verified Connect registry must independently match the real seller and account. That registry is still a test-only onboarding fixture; payout-account metadata alone never grants KYC/charge eligibility.

If needed, the server creates and links the actual Medusa Payment Collection. A PostgreSQL advisory lock serializes preparation. Parent-cart row locking and child/link write triggers serialize sealing against concurrent cart mutations. The final graph is read again after acquiring the parent lock, then its deterministic fingerprint and snapshot are committed to the Medusa-side seal table.

Only then does a single NP DB transaction create the listing projection, order, NP payment session and buyer/cart/collection authority mapping. Order/session IDs are deterministic per cart. The existing authenticated real Medusa session adapter creates the intent with server-owned seller account and price. An injected failure after the durable cart seal but before NP projection can retry and reconstruct the projection before any intent creation.

The candidate fee of zero and the one-hour internal NP session lifetime are PoC fixtures, **not adopted commercial fees or postpay deadlines**.

## Database protections

A test-only SQL installer, restricted to `NODE_ENV=test`, discovers pinned runtime module/link tables and adds guards for:

- Cart root updates/deletion.
- Cart child rows, including line item, shipping, tax and discount adjustment changes.
- Remote line-item→Offer and Cart→Payment Collection link changes.
- Payment Collection principal amount, raw amount, currency and deletion changes. Ordinary settlement-status changes are not principal repricing.
- Source-backed NP order financial snapshot columns; `pending`→`paid` remains permitted.

These are fail-closed temporary guards in a disposable integration app. They currently also block standard Cart completion mutations. There is **no trusted completion/unseal policy**, cancellation unlock or production migration. A privileged database operator able to remove triggers/seals is outside this PoC's guarantee.

Catalog prices and seller eligibility are not globally frozen for other buyers. A source fingerprint is checked again before issuing/reusing this checkout. Source changes cause safe rejection/reconciliation rather than silently repricing the order. Complete multi-database/catalog TOCTOU protection remains part of the next stage.

## Real source paths checked

- `packages/core/src/links/cart-line-item-offer-link.ts`
- `packages/core/src/links/offer-seller-link.ts`
- `packages/core/src/links/offer-product-link.ts`
- `packages/core/src/links/offer-variant-link.ts`
- `packages/core/src/links/offer-price-link.ts`
- `packages/core/src/links/seller-payout-account-link.ts`
- `packages/core/src/modules/offer/models/offer.ts`
- `packages/core/src/modules/seller/models/seller.ts`
- `packages/core/src/workflows/cart/steps/link-line-item-to-offer.ts`
- `packages/core/src/workflows/offer/workflows/create-offers.ts`

## Added implementation

`poc/mercur-integration/payment/source-checkout.ts`, `payment/cart-seal.ts`, optional fingerprint in the authority schema, authenticated source HTTP route/middleware, overlay injection/typecheck, `http/np-source-checkout.spec.ts`, and a dedicated source-snapshot CI workflow. Existing B3-05b and B3-05c-1 tests remain in the combined run.

## Ten new tests

1. Build NP order/authority/session from actual module/link records; ignore forged client metadata.
2. Deny anonymous/other buyer and financial browser overrides before intent creation.
3. Deny catalog/cart price mismatch before sealing or Stripe.
4. Require actual Offer link and independent verified Connect registry.
5. Reject module and direct SQL mutations of sealed cart, line price/quantity, collection amount and NP order principal.
6. Reject remote Offer/collection link removal after sealing.
7. Retry a failure after durable seal/before NP projection; rebuild once and reuse the real session/intent.
8. Live catalog-price drift after sealing rejects reuse without repricing/another intent.
9. Eight concurrent preparations produce one order/seal and one linked collection/intent.
10. Real source projection→actual Medusa session→locally signed HTTP notification produces NP paid/Intake/Outbox once.

Initial [CI 39862286267](https://github.com/karukimori-wq/numeria-place/actions/runs/39862286267) passed build/typecheck and 27/27 tests (19 existing + first 8 new). Additional review added explicit principal-ID protection and tests for raw amount/adjustment mutation, catalog drift and concurrent preparation in `4b8f0a1ef5a34eccdddf47f12d41f61b804ef17c`. Final [CI 39862902620](https://github.com/karukimori-wq/numeria-place/actions/runs/39862902620) **completed/success**. Patched Mercur build, focused implementation/test typecheck and **3 suites / 29 tests PASS** (19 prior + 10 new). Verified the final job log, including source, buyer and provider/HTTP suites. Tested commit: `4b8f0a1ef5a34eccdddf47f12d41f61b804ef17c`.

[Notion detail](https://app.notion.com/p/401e71121fed81af87e6d212071874e3).

## Still not completed — next B3-05c-2b

- Trusted standard Mercur cart/split-order completion through the seal, and reconciliation with NP paid/Intake/Outbox after crashes.
- Automated repair of orphan Medusa sessions, collections, cross-database projections and review queues.
- Full atomicity across global source updates and multiple databases; production DB privileges and migrations.
- Actual Connect onboarding/API/webhook delivery, platform fee policy, Clerk, NS dispatch, full-text/PDF access, cumulative refunds/disputes, AWS and Japanese contracts.

No main merge, production deployment or real funds. Full B3-05 and G0 remain pending.
