# PoC 00-A — Numeria Place Direct Charges / Security Harness

**Status as of 2026-10-20: offline simulation + upstream source boundary checks only.**
**NOT** a running Numeria Place app; **NOT** deployed to AWS; **NOT** a running Mercur backend; **NOT** a Stripe Test Mode charge. No customer data or real credentials.

## Why this was created

Numeria Place requires individual sellers to be contractual sellers and uses **Stripe Connect Direct charges as its first-choice design**. The standard Mercur Stripe integration uses platform charge + seller Transfer (Separate Charges and Transfers). We must ensure a Direct-charge adapter can preserve seller isolation, order state, prepaid and FULL_POSTPAY rules without accidentally sending the seller a second Transfer.

The existing numeria-place repository contained only AGENTS.md, README.md and G0 documents when this isolated branch was made. This harness is a small dependency-free test seam, not a Mercur fork.

## Scope / layout

- `src/commerce.mjs`: synthetic seller/listing/order data, checkout call to **injected mock Stripe client**, HMAC-based Stripe-like event fixture verification, report-view vs PDF entitlement and hard ban on seller Transfer under Direct mode.
- `test/commerce.test.mjs`: Node 22 automated tests for mismatched seller/account, forged webhook, invalid price, duplicate callback, unpaid PDF, unrelated buyer/seller, valid Business vs NP-only, refunded entitlement.
- `scripts/audit-upstream.mjs`: static source baseline for pinned Mercur commit, including `transfers.create` and split-order payment workflow. This is NOT an actual integration with the Mercur runtime.
- `.github/workflows/poc00-direct-safety.yml`: executes test harness + optional Mercur pinned-source checkout automatically for PRs. No keys or billable cloud services.

## How to run (for Codex/GitHub Actions)

```sh
node --test poc/stripe-direct/test/*.test.mjs
```

The test harness is intentionally standard-library-only; no install or Stripe SDK required. The CI also checks source compatibility against Mercur SHA `9fe557067193e0ad4dd3b7fd37e212f0b352ab3c`.

## Coverage map and limitations

| Scenario | Here | Real integration |
| --- | --- | --- |
| D01 Direct account and amount | injected SDK call assertion | Stripe sandbox not run |
| D02 cross-seller account swap | synthetic rejection | auth/DB tests pending |
| D03 duplicate checkout / webhook | one in-memory order | durable inbox + concurrency pending |
| D04 early/invalid events | reject mismatched and unpaid payload | Mercur webhook/cart race pending |
| D05 expiring session | synthetic expiry retry | Stripe provider test pending |
| D06 no seller Transfer with Direct | guard throws | disable Mercur payout workflow pending |
| D07 refunds / disputes | simple simulated full refund only | Stripe Connect fee refund/dispute pending |
| D08 NP-only vs Business | synthetic seller/link policy | Clerk/NS/GE integration pending |
| D09 FULL_POSTPAY / PREVIEW_POSTPAY | synthetic viewer entitlements | private PDF signed URLs pending |
| D10 postpay new payment + release | synthetic Checkout event | Stripe Invoicing / connected-account charge pending |
| D11 unpaid postpay | pending state and PDF block | seller consent, debt, policy pending |
| D12 cross-buyer/seller | in-memory owner checks | server RBAC and external penetration pending |
| D13 Business expires after acceptance | existing order proceeds | entitlement authority and cancellation pending |
| D14 webhook event authenticity | local HMAC mock | real Stripe event construct & replay DB pending |
| D15/D16 Separate charges and Transfer reversal | not implemented | alternative only, pending decision |
| AWS private network/RDS/Redis/S3 | not implemented | infrastructure access + budget approval required |
| Mercur actual boot / DB / Redis | not implemented | staging runtime pending |

## SECURITY / DESIGN WARNINGS

1. **Not production code.** In-memory Maps and counters are not durable, concurrent, or transaction-safe. Never copy this directly into a deployed checkout. Real idempotency requires DB unique constraints + transactional inbox/outbox, Stripe SDK verification, retry locks and incident reconciliation.
2. `signedFixture` is a test-only Stripe signature emulator; only the real Stripe library's webhook verification and verified connected-account context should be used in a live implementation. The code has no live Stripe SDK or real Checkout.
3. `sellerId`, `stripeAccountId`, price and seller fee must be fetched server-side from trusted, access-controlled persisted state. Test clients must not influence Stripe connected-account routing.
4. Application fee in this harness is a synthetic **zero**; no 15% platform fee or other unapproved rate is imposed.
5. There is no document storage, business report, email, SMS, KYC, bank payout or receipt generation in this harness.
6. A customer viewing FULL_POSTPAY text may copy it without paying; PDF gating cannot guarantee collection.
7. Mercur under Direct charges must not run seller `stripe.transfers.create`; seller funds arrive through the connected-account charge.
8. Operator is responsible for legal seller/merchant status and possible connected-account negative-balance liability decisions; nothing in the harness resolves them.
9. Payment state `paid` in this in-memory harness is based on signed-fixture events only. This must never be used as proof that Stripe processed money.
10. Repo CI success is **PoC 00-A PASS**, not the Notion PoC 00 adoption gate **PASS**.

## Next gate: PoC 00-B, Mercur + Stripe Test Mode + isolated AWS

1. Establish isolated AWS Tokyo testing account/role, budget cap and secret handling.
2. Pin Mercur/Medusa package version and boot API/Admin/Vendor with private Postgres, Redis; restrict all external origins.
3. Decide prototype approach: fork Mercur Payment Provider or Medusa-level server-only seller-scoped Direct adapter; use connected account identity from seller data.
4. In Stripe Test Mode only, create test seller A/B; verify Direct charges and application fee. Compare Stripe Dashboard charge location, NP canonical order and seller.
5. Run duplicate webhook and cart completion races, seller A/B access denial, refund / application fee reversal, postpay fresh invoices, buyer-only private PDF preview and download.
6. Test Mercur payout subscriber is **off** for Direct; no `stripe.transfers.create` emitted for these orders.
7. Record evidence, risk and measured effort, then select Mercur fork vs Medusa+adapter vs NP-specific commerce. Keep G0 unapproved pending legal and contract sign-off.

### References
- [Notion PoC 00](https://app.notion.com/p/3f8e71121fed81139c45dc3353e6a948)
- [Notion 09](https://app.notion.com/p/3f7e71121fed81509f2bfb2325128cd9)
- [Contracts draft PR #4](https://github.com/karukimori-wq/professional-platform-contracts/pull/4)
- [Mercur Direct impact map](https://github.com/karukimori-wq/professional-platform-contracts/blob/proposal/numeria-place-commerce-ownership-p0/docs/proposals/np-mercur-direct-charges-impact-matrix.md)
