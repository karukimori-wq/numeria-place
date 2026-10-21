# P1-A UI implementation status (2026-10-21)
This branch contains *fixture-only* connected React Router pages. No live checkout, customer data, or real PDF storage.
## Required review
- [ ] npm install and lockfile / dependency review (not yet executed in local tool runtime; CI may generate its own lockfile).
- [ ] npm test: entitlement across 3 payment modes, buyer filtering, shared listing/seller refs.
- [ ] npm run typecheck.
- [ ] npm run build (SSR bundle; never deploy).
- [ ] npm run e2e (real Chromium).
- [ ] Five screens x five widths (375, 390, 430, 768, 1440), screenshot artifact present and no horizontal overflow.
- [ ] Reviewer confirms usable 4-step *demo* wizard and no dead CTA.
- [ ] Same listing ID, price, seller and payment conditions on LP and product details.
- [ ] FULL_POSTPAY unpaid: synthetic web text visible, no PDF download. PREVIEW_POSTPAY unpaid: preview only.
- [ ] Business not required for NP_MANUAL seller. Business downgrade does not erase standalone seller.
- [ ] PR reviewed; main unchanged and no Cloudflare/Stripe/Clerk/NS/GE/APC production interaction.
## Explicit limits
All identity, ownership, permissions and payments are illustrations, not genuine security controls. Do not publish the fixture-only order pages as real user account services. Environment has no real preview URL until a separate preview permission and deployment succeeds.
## References
- Notion #33 https://app.notion.com/p/400e71121fed81cb8b7aedce70d6e2c0
- Notion #32 https://app.notion.com/p/400e71121fed818896d5de201d2ad590
- UI pages https://app.notion.com/p/3fde71121fed8184a77bfc7ad2b44470
