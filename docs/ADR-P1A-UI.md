# ADR P1-A: fixture-only React Router UI

Date: 2026-10-21. Scope: **UI prototype ONLY**.

Use React + TypeScript, React Router framework mode SSR, Cloudflare Vite Plugin (Workers), and one fixture-only commerce boundary. Reason: public listings, independent seller LPs and search indexable documents; order back-end decisions remain separate. Browser URL routes and responsive UI are built, but **no real authentication, payment, order, Report or PDF** exists in P1-A.

- Do not access production Cloudflare, Clerk, Stripe, Mercur, GE, NS or APC.
- Do not merge into main or deploy to an existing production Worker.
- Keep public fixtures clearly labelled デモ／架空; all information and quoted prices are synthetic.
- Existing PoC PR #2 and contracts PR #4 remain untouched.
- Required: route navigation, one canonical seller/listing/order data model, three payment-policy access examples, responsive widths 375/390/430/768/1440, CI build/typecheck/unit test, browser test and screenshots if browser tooling runs.
- If network access or browser tooling blocks validation, report NOT RUN (do not claim PASS).
- Sources: Notion #33 https://app.notion.com/p/400e71121fed81cb8b7aedce70d6e2c0 and #32 https://app.notion.com/p/400e71121fed818896d5de201d2ad590; Cloudflare https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/.
