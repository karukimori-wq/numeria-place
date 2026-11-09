# B3-05c-3r: effective engine after process restart

Date: 2026-11-08 JST. Disposable pinned Mercur integration overlay only.

The four existing actual SIGKILL/restart cases now inspect both loaded configuration and actual resolved service storage. They require workflows.resolve = @medusajs/medusa/workflow-engine-inmemory, an InMemoryDistributedTransactionStorage instance by constructor label, and absence of Redis storage on the actual orchestrator. This uses pinned internal members; an upstream change must fail the test and be reassessed. It is diagnostic test code, not a public production API.

Only fixed module/storage/mode labels and the test boundary are logged. Services, connection options, map entries, workflow payload/context and secrets are never dumped by this inspection. Existing resource invariance, no replacement workflow and partial/recovered outcomes remain required.

Source paths at Medusa v2.21.2: packages/core/utils/src/common/define-config.ts, packages/core/utils/src/modules-sdk/definition.ts, packages/modules/workflow-engine-inmemory/src/services/workflows-module.ts and workflow-orchestrator.ts. Source inspection alone previously identified the default mapping; these runtime assertions verify the effective bootstrapped configuration and service together.

This does not test Redis workflow retries, worker-mode restart, delayed jobs, arbitrary partial transactions or competing recovery ownership. A PostgreSQL workflow_execution row does not imply durable retry timers. Keep the server-only restriction. Next: a separate isolated Redis-engine experiment with synthetic workflow side effects and persisted retry jobs before any NP worker enablement. Actual Stripe/NS delivery/G0 remain pending.

Validation PASS: code 5bfa32a47fbaea7f47c16df4c7230fcdf3d36561; Actions https://github.com/karukimori-wq/numeria-place/actions/runs/42389194576. Fixed build/typecheck PASS; normal 3 suites / 51 passed + 1 skipped. Four independent restart suites each 1/1 PASS, four supervisor success markers. All four identities logged server / inmemory / InMemoryDistributedTransactionStorage. Final job success and logs checked. Existing partial/recovered outcomes and resource invariance preserved. No production adoption, main merge or money movement.
