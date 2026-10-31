# B3-05c-3n: reverse NP resource inventory and step projection

2026-10-31. Limited verification PASS. Disposable pinned integration app only.

## Reverse inventory

inspectOrphanInventory scans actual non-deleted Payment Sessions for the NP provider and Collection IDs recorded in NP cart seals. It compares these resource IDs to NP checkout authority across the separate DB connections, rather than requiring a surviving paid order to discover them. Missing matches are persisted in a dedicated np_poc_orphan_resources review ledger, unique by kind/resource ID. No order is fabricated for a resource with unknown ownership. No resource is deleted, recreated, charged or automatically repaired.

Pages use a stable C-collated kind/ID cursor, at most 100 candidates per call. The caller must scan to the end and restart scans to observe new or changed resources. Repeated scans deduplicate stored observations. A reference may temporarily be absent during an active checkout or cross-DB race: unmatched_authority means review evidence, not confirmed corruption or permission to repair. Resolution/closing observations after later reattachment is not implemented.

Coverage: provider-attributable sessions and seal-attributable collections only. Collections with no session/seal evidence cannot safely be attributed to NP; other providers are not scanned. Soft-deleted sessions, complete destruction of provenance, changes between the two database reads, and large-scale production scan/least privilege are not covered. This is not exhaustive marketplace-wide orphan discovery or an automatically scheduled worker.

## Step projection

The real SIGKILL/restarted-Medusa test projects only invoke/compensate state fields from execution.steps (or execution.flow.steps) using SQL, without retrieving responses/input/context payloads. It compares the selected rows before and after standard reconciliation. Logs include only step counts and fixed-state counts, not raw step objects. Empty persisted steps must be reported as absence, not proof of durable step execution or resumability.

## Acceptance

One new integration case: valid checkout produces zero findings; removal of its NP authority preserves real resources and yields one collection then one session across limit=1 pages, ending in an empty page. Repeated full scan persists exactly two review rows, with no additional workflow/Intent. Invalid limit is refused. Existing kill/restart suite verifies projected step metadata stays unchanged.

Files: new payment/orphan-inventory.ts; http/np-source-checkout.spec.ts; http/workflow-restart.spec.ts under poc/mercur-integration.

Full recovery stage, arbitrary crash boundaries, automatic repair/worker resume, Stripe Test Mode, NS delivery, production migration/DB roles, G0 and release remain incomplete. PR #2 stays Draft; no main/production/funds.


## Evidence

Code `94b780b695a60ef07abfad75a73623d7a654e3f6`; [Actions 41171107874](https://github.com/karukimori-wq/numeria-place/actions/runs/41171107874). Fixed Mercur build/typecheck PASS; normal 3 suites / **51 passed + 1 skipped** (52 declared), independent restart 1 suite / 1 PASS and parent SIGKILL/restart marker PASS. Final job logs read; job success confirmed. One reverse-inventory case added to the previous 51-declared/50-passed suite.

Observed persisted checkpoint: **29 step entries, invoking count 0, done count 0**, one execution in not_started state. These counts do not classify the remaining states or prove all steps were not_started. The selected invoke/compensate metadata stayed unchanged through standard reconciliation. Actual DB still had one group, zero orders and zero cart-order links. Business-state verification therefore remains necessary even with persisted step entries.

Next mandatory gap: expand crash boundaries (especially actual orders/links persisted), background-worker resume behavior and review-resolution policy; complete no-provenance orphan coverage only after defining trustworthy ownership attribution. This successful bounded inventory is not stage-1 recovery acceptance or production readiness.
