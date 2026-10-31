#!/usr/bin/env node
// B3-05a source-grounded integration audit; not proof of runtime registration.
const fs=require("node:fs");
const path=require("node:path");
const assert=require("node:assert/strict");
const root=process.argv[2];
if(!root)throw Error("Usage: node audit-mercur-direct-gates.cjs <pinned-mercur>");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const service=read("packages/core/src/modules/payout/services/payout-module-service.ts");
const provider=read("packages/providers/payout-stripe-connect/src/services/stripe-connect.ts");
const config=read("apps/api/medusa-config.ts");
const loader=read("packages/core/src/modules/payout/loaders/provider.ts");
const workflow=read("packages/core/src/workflows/payout/workflows/create-payout.ts");
const payoutStep=read("packages/core/src/workflows/payout/steps/create-payout.ts");
const hook=read("packages/core/src/api/hooks/payment/[provider]/route.ts");
const subscriber=read("packages/core/src/subscribers/payment-webhook.ts");
const withMercur=read("packages/core/src/with-mercur.ts");
const assertions=[
 ["Payout guard inside service",service.includes('process.env.NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT === "true"')],
 ["Guard before payout row creation",service.indexOf("NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT")<service.indexOf("this.createPayouts_(input, sharedContext)")],
 ["Guard before provider payout",service.indexOf("NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT")<service.indexOf("this.payoutProviderService_.createPayout(")],
 ["Payout step calls service",payoutStep.includes("payoutService.createPayouts(input)")],
 ["Payout workflow calls payout step",workflow.includes("createPayoutStep({")],
 ["Legacy Stripe provider uses Transfer",provider.includes("this.stripe_.transfers.create(")],
 ["Provider loader accepts providers",loader.includes("moduleProviderLoader")&&loader.includes("options?.providers")],
 ["Config uses withMercur",config.includes("withMercur({")],
 ["withMercur preserves modules",withMercur.includes("...(config.modules ?? [])")],
 ["Mercur payment webhook is event-bus deferred",hook.includes("PaymentWebhookEvents.WEBHOOK_RECEIVED")&&hook.includes("eventBus.emit(")],
 ["Mercur payment subscriber invokes workflow",subscriber.includes("processPaymentWorkflowId")&&subscriber.includes("getWebhookActionAndData(input)")]
];
for(const [name,ok] of assertions){
  assert.ok(ok,"B3_05A_UPSTREAM_DRIFT: "+name);
  console.log("AUDIT PASS:",name);
}
console.log("B3-05a source audit passed",assertions.length,"checks. NOT runtime registration or Stripe integration.");
