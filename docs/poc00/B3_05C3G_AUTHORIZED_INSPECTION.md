# B3-05c-3g: authorized retry status/audit inspection API

2026-10-25 JST. Limited offline integration PASS; review UI is not implemented.

Changed paths under poc/mercur-integration: api/inspection-route.ts, api/middlewares.ts, scripts/install-direct-runtime.mjs and http/np-source-checkout.spec.ts.

GET /np-ops/retries/:order_id requires Medusa user bearer authentication and an independently enabled operator grant. The grant is checked before checking whether an order exists. It is share-locked during the inspection transaction so revocation serializes with that operation. Unauthorized callers receive no queue or audit records.

The response selects only order ID/state/attempts/ceiling/next due time/stop reason, latest attempt statuses/times, and latest requeue request IDs/actor IDs/budgets/reasons/times. It omits lease tokens, provider payloads, client secrets and customer data. Responses use Cache-Control: no-store. History and audit each return at most the latest 50 records with a has_more flag; historical pagination is not yet available. Reads use ordinary PostgreSQL transaction isolation, not a guaranteed stable cross-table snapshot under concurrent workers.

The existing authenticated HTTP test is extended for anonymous/customer/no-grant denial, authorized missing-order 404, authorized inspection, explicit response keys, audit actor, cache header, sensitive field omission and revocation. No new test case count is claimed.

[Actions 40194351841](https://github.com/karukimori-wq/numeria-place/actions/runs/40194351841): patched build and implementation/test typecheck PASS; 3 suites / 45 tests PASS. Final logs read. Tested commit: 8485195e7625ab419805440b913d62c59a52e4c8.

Limits: actual production Clerk mapping, interactive admin login, UI, audit tamper resistance, denied-read logging, rate limits, full history pagination, scheduling, arbitrary workflow repair, process-kill proof, real Stripe/NS delivery and G0 remain pending. Fictitious Medusa test users and operator grants only. No main merge/deployment/funds; Draft PR #2 remains Draft.

Next: minimal operator review screen using these authorized APIs, with clear partial-state and unavailable-action feedback, plus browser/UI validation before acceptance.
