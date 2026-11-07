# B3-05c-3f: authenticated operator HTTP requeue

2026-10-25 JST. Limited offline integration PASS.

Changed files under poc/mercur-integration: api/requeue-route.ts, api/middlewares.ts, scripts/install-direct-runtime.mjs and http/np-source-checkout.spec.ts.

POST /np-ops/retries/:order_id/requeue is installed only into the disposable integration app. authenticate("user",["bearer"]) requires a Medusa user token; customer tokens and anonymous requests are rejected. Cookie-session and API-key authentication are not enabled for this operation.

The actor comes exclusively from req.auth_context.actor_id; body fields are limited to requestId, expectedAttempts, budget and reason. An independent enabled server-side operator grant is still required. The route invokes the existing atomic/idempotent audited requeue function; it does not charge, run reconciliation directly or repair partial orders. It returns generic errors without internal exception messages. Existing partial-state refusal, attempt ceilings and grants remain enforced.

Tests create an actual Medusa User and Auth Identity and an officially signed local user JWT. Real HTTP verifies anonymous/customer rejection, user without grant rejection, forbidden actorId body, permitted operation, idempotent resend, audit actor identity and rejection after revocation. Previous 44 tests remain included.

[Actions 40193700978](https://github.com/karukimori-wq/numeria-place/actions/runs/40193700978): patched fixed-SHA Mercur build PASS, implementation and HTTP-test typecheck PASS; 3 suites / 45 tests PASS. Final logs read. Tested code 18bff6f832e9386ac87df0da4096f10614d0f561.

This proves the Medusa test authentication/middleware boundary, not production Clerk mapping, a complete interactive login flow, production role provisioning or a management UI. Grants are test fixtures. No production DB tamper-proof audit, rejected-operation audit, scheduler, forced-process recovery, actual Stripe/NS sending, main merge, production or funds. Draft PR #2 stays Draft.

Next: authorized operator status/audit inspection and minimal safe review UI; keep production identity integration separate and unresolved until verified.
