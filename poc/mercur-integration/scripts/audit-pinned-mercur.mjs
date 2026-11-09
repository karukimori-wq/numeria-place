// B3-05a fail-closed source audit for the PINNED Mercur SHA only.
// It is a static safeguard, not a proof of deployed Transfer absence.
import {execFileSync} from "node:child_process";
import {readdirSync,readFileSync,statSync} from "node:fs";
import {join,resolve,relative} from "node:path";
const root=resolve(process.argv[2]||"mercur");
const expected="9fe557067193e0ad4dd3b7fd37e212f0b352ab3c";
const sha=execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(sha!==expected)throw new Error("UNPINNED_MERCUR_SHA:"+sha);
const get=p=>readFileSync(join(root,p),"utf8");
const expectText=(p,text)=>{
  if(!get(p).includes(text))throw new Error("UPSTREAM_SAFETY_ASSUMPTION_CHANGED:"+p+":"+text);
};
expectText("packages/core/src/workflows/payout/workflows/create-payout.ts","createPayoutStep({");
expectText("packages/core/src/workflows/payout/steps/create-payout.ts","payoutService.createPayouts(input)");
expectText("packages/core/src/modules/payout/services/payout-module-service.ts","this.payoutProviderService_.createPayout({");
expectText("packages/core/src/modules/payout/services/provider-service.ts","payoutProviderKeys.length !== 1");
expectText("packages/core/src/modules/payout/loaders/provider.ts","moduleProviderLoader({");
expectText("packages/providers/payout-stripe-connect/src/services/stripe-connect.ts","this.stripe_.transfers.create(");
expectText("packages/core/src/api/hooks/payment/[provider]/route.ts","PaymentWebhookEvents.WEBHOOK_RECEIVED");
expectText("packages/core/src/subscribers/payment-webhook.ts","paymentService.getWebhookActionAndData(input)");
expectText("packages/core/src/workflows/payment/workflows/process-payment.ts","completeCartWithSplitOrdersWorkflow");
const sourceRoots=["apps/api/src","packages/core/src/subscribers","packages/core/src/api"];
function walk(path){
  return readdirSync(path,{withFileTypes:true}).flatMap(e=>{
    const full=join(path,e.name);
    if(e.isDirectory())return walk(full);
    if(!/\.(ts|tsx|js|mjs)$/.test(e.name)||/\.(spec|test)\./.test(e.name))return [];
    return [full];
  });
}
const calls=[];
for(const d of sourceRoots){
  for(const file of walk(join(root,d))){
    const s=readFileSync(file,"utf8");
    if(/\bcreatePayoutWorkflow\b|\bpayout\.requested\b|\btransfers\.create\s*\(/.test(s))
      calls.push(relative(root,file));
  }
}
if(calls.length)throw new Error("PAYOUT_TRIGGER_REVIEW_REQUIRED:"+calls.join(","));
const config=get("integration-tests/medusa-config.ts");
if(!config.includes("resolve: './src/providers/np-no-transfer'")||
   !config.includes("resolve: '@mercurjs/core/modules/payout'"))
  throw new Error("NP_PROVIDER_NOT_REGISTERED_IN_TEST_CONFIG");
if(config.includes("resolve: '@mercurjs/payout-stripe-connect'"))
  throw new Error("STRIPE_TRANSFER_PROVIDER_REGISTERED");
const provider=get("integration-tests/src/providers/np-no-transfer/service.ts");
if(!provider.includes('throw new Error("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN")'))
  throw new Error("NP_PAYOUT_NOT_FAIL_CLOSED");
if(provider.includes("transfers.create"))throw new Error("NP_PROVIDER_TRANSFER_PRESENT");
console.log("PASS: pinned Mercur payout call chain audited, no app-level payout triggers in scanned source, test config uses NP fail-closed provider");
console.log("LIMIT: static audit cannot prove that arbitrary runtime plugins/jobs cannot invoke payout workflows");
