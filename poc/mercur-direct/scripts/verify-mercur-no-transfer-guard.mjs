// B3-05a: verify the ACTUAL pinned upstream source is guarded.
// Source-level contract only. Does not prove runtime wiring or Stripe absence.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
const root=resolve(process.argv[2]||"");
if(!process.argv[2])throw Error("USAGE: verify-mercur-no-transfer-guard.mjs <upstream>");
const src=(p)=>readFileSync(join(root,p),"utf8");
const service=src("packages/core/src/modules/payout/services/payout-module-service.ts");
const start=service.indexOf("    async createPayouts(");
const end=service.indexOf("    @InjectTransactionManager()",start);
assert(start>0&&end>start,"payout service boundaries");
const method=service.slice(start,end);
assert(method.includes("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN"));
assert(method.includes("throw new MedusaError"));
assert(!method.includes("payoutProviderService_.createPayout("));
assert(!method.includes("createPayouts_("));
const provider=src("packages/providers/payout-stripe-connect/src/services/stripe-connect.ts");
assert(provider.includes("this.stripe_.transfers.create("),
  "legacy upstream transfer exists and must stay unreachable in NP");
const step=src("packages/core/src/workflows/payout/steps/create-payout.ts");
assert(step.includes("payoutService.createPayouts(input)"));
const wf=src("packages/core/src/workflows/payout/workflows/create-payout.ts");
assert(wf.includes("createPayoutStep("));
const providerService=src("packages/core/src/modules/payout/services/provider-service.ts");
assert(providerService.includes("this.payoutProvider_.createPayout(data)"));
const diff=execFileSync("git",["diff","--name-only"],{cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean);
assert.deepEqual(diff,["packages/core/src/modules/payout/services/payout-module-service.ts"],
  "unexpected upstream files modified");
console.log("PASS: pinned upstream payout workflow -> service guarded at createPayouts boundary");
console.log("PASS: legacy Stripe transfers.create remains in upstream but guarded service cannot call it");
console.log("PASS: no unexpected upstream source changes");
console.log("LIMIT: source-level only; runtime provider wiring, HTTP and Stripe Test Mode NOT proven");
