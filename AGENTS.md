# Codex / AI agent instructions — Numeria Place

## Mission
Implement **Numeria Place**, a marketplace for individual fortune tellers and official AI characters. Use the specifications linked from [README.md](README.md) and Notion. Initial source is being established; do not treat design mocks as a running app.

## Required preparation
1. Inspect the current repository files/branches and record what exists. Do not stop after this inspection: make an actionable plan and implement the **safe, unblocked** parts (especially independent UI and tests).
2. Consult [Notion 22 (UI/UX cross-screen audit)](https://app.notion.com/p/3fee71121fed81c6a9f0fad8fb2b50a1), [Notion 16](https://app.notion.com/p/3fde71121fed8184a77bfc7ad2b44470) and Notion 17–21. If local handoff ZIP is available, follow `00_START_HERE.md` and `09_CODEX_HANDOFF.md`.
3. Check [professional-platform-contracts](https://github.com/karukimori-wq/professional-platform-contracts). Its NP proposal [PR #4](https://github.com/karukimori-wq/professional-platform-contracts/pull/4) was open, draft, unmerged as of 2026-10-20; recheck before relying on it as canonical.
4. Define an isolated plan for the chosen framework and deployment. **No stack or production destination is approved by this README alone.** Start UI-only work on a branch if backend/Stripe decisions are blocked.

## Invariants
- NP is the marketplace source of truth for seller, listing, order, payment/invoice/refund, seller payout projection and buyer delivery entitlements.
- GE orchestrates connected Business fulfillment and cross-app projections; NS owns calculation, session, formal Report and PDF; APC owns AI text generation.
- Sellers without NS Business may operate solely inside NP. Business entitlement must never gate NP_MANUAL listings, past orders or connected seller payout history.
- Business LP and standard NP shop **share the exact NP seller and listing**. No separate LP cart, price table or Stripe Checkout. Exactly one seller/listing per order.
- Payment policies: PREPAY; PREVIEW_POSTPAY; FULL_POSTPAY. For FULL_POSTPAY, unpaid buyer may view *full text in an authorized web viewer*, but **cannot download PDF** until verified payment.
- The following are independent states: fulfillment, invoice/payment, full-view access, PDF-download entitlement, Connect charges_enabled, payouts_enabled, Business entitlement, and LP publish status.
- Customer access to private orders/Reports/PDFs must be checked on the server (ownership + order + current entitlement). Never place raw Report or customer data in public caches, logs, Stripe metadata or GE event payloads.
- All AI/manual/human-assisted modes must be accurately labeled. PR placement based on seller fee must be marked as such.

## UI and UX
- Base appearance: deep navy `#111A32`, warm canvas `#F8F7F5`, gold `#E2C596`, iris `#8879D3`; LP permits theme customization while legal and commerce displays stay consistent.
- Buyer mobile navigation: 探す / 鑑定書 / マイページ. Seller mobile navigation: ホーム / 注文 / 商品 / ショップ.
- Priority surfaces: seller action-needed orders; buyer next action and 3-axis status. Keep purchase price, legal seller, delivery estimate, payment timing and cancellation rules visible.
- Forms must keep draft/selection through authentication and show explicit consent to seller-shared data and payment terms. Never silently submit order or payment.
- No inert production buttons. For blocked functions show a correct unavailable state or omit them.
- Responsive and accessibility targets: 375/390/430/768/1440px, safe area, accessible dialogs/buttons/labels, keyboard navigation and clear errors.

## Guardrails for change
- No live Stripe charges, creation of production customers/invoices, irreversible DB migration, DNS changes, Cloudflare production deployment, Clerk admin changes, or secrets in git without explicit user approval.
- No unsupported use of a 7-day payment deadline, ¥5,000 postpay limit, 15% fee or final Stripe architecture: these values have only been discussed as examples/proposals.
- No unilateral merge of contracts PR #4 or adoption of Mercur payment defaults that conflict with seller-as-merchant.
- Business expiry must not wipe or restrict NP standalone listings. The fate of a previously published LP (retain vs redirect vs hide) remains unresolved.
- Work on an isolated feature branch and propose PRs with screenshots, test outputs, edited files and unresolved blockers. Avoid unconditional main pushes after this initial documentation baseline.

## Definition of Done
- Demonstrate real screen-to-screen navigation; same listingId/orderId and consistent product details across buyer listing, seller dashboard and LP.
- Provide tests for authorization and money/document entitlements: one seller cannot see another seller's orders; another buyer cannot read text/PDF; FULL_POSTPAY unpaid buyer can view text but not PDF; verified webhook permits PDF; retries do not duplicate orders/charges.
- Provide responsive screenshots, validation logs, test summaries (PASS/FAIL/NOT RUN) and preview URL if actually deployed.
- Distinguish local UI prototype vs integration tests vs production readiness. Report exactly what is still blocked.
