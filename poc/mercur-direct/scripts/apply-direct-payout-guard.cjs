#!/usr/bin/env node
// B3-05a pinned-Mercur fail-closed payout patch for an ISOLATED CI checkout.
// No production deployment, no Stripe calls, no silent upstream drift.
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const assert=require("node:assert/strict");
const root=process.argv[2];
const expected="9fe557067193e0ad4dd3b7fd37e212f0b352ab3c";
if(!root)throw Error("Usage: node apply-direct-payout-guard.cjs <pinned-mercur-checkout>");
const actual=cp.execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
assert.equal(actual,expected,"NP_PINNED_MERCUR_SHA_MISMATCH");
const relative="packages/core/src/modules/payout/services/payout-module-service.ts";
const file=path.join(root,relative);
const source=fs.readFileSync(file,"utf8");
const needle=`    const { payout, payoutAccount } = await this.createPayouts_(input, sharedContext)`;
const guard=`    // NP B3-05a: Direct charges already credit the connected account.
    // Fail before creating ANY Mercur payout row or calling Stripe Transfer.
    // This is a fail-closed transitional gate, not a reconciliation workflow.
    if (process.env.NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT === "true") {
        throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN"
        )
    }

`+needle;
assert.equal(source.split(needle).length-1,1,"NP_PAYOUT_PATCH_ANCHOR_CHANGED");
assert.ok(source.includes("async createPayouts("),"NP_PAYOUT_SERVICE_ENTRY_MISSING");
assert.ok(source.includes("this.payoutProviderService_.createPayout("),"NP_PROVIDER_CALL_CHANGED");
assert.ok(!source.includes("NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT"),"NP_PATCH_ALREADY_APPLIED");
fs.writeFileSync(file,source.replace(needle,guard));
const patched=fs.readFileSync(file,"utf8");
assert.ok(patched.indexOf("NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT")<
  patched.indexOf("this.createPayouts_(input, sharedContext)"));
assert.ok(patched.indexOf("NP_DIRECT_CHARGES_NO_MERCUR_PAYOUT")<
  patched.indexOf("this.payoutProviderService_.createPayout("));
console.log("B3-05a PATCH APPLIED to",relative);
console.log("Pinned Mercur",actual,"/ NO runtime build or payment executed.");
