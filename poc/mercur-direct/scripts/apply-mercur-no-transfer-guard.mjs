// B3-05a: fail-closed overlay for pinned Mercur payout module.
// Run against an ISOLATED upstream checkout, never a production repo.
// This is NOT yet runtime-registered; guard must be verified by real Mercur tests.
import {readFileSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
const root=resolve(process.argv[2]||"");
if(!process.argv[2])throw Error("USAGE: node apply-mercur-no-transfer-guard.mjs <pinned-mercur-checkout>");
const sha=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const expected="9fe557067193e0ad4dd3b7fd37e212f0b352ab3c";
if(sha!==expected)throw Error("NP_MERCUR_UPSTREAM_SHA_MISMATCH: "+sha);
const path=join(root,"packages/core/src/modules/payout/services/payout-module-service.ts");
const source=readFileSync(path,"utf8");
const startMarker=`    async createPayouts(
        input: CreatePayoutDTO,
        @MedusaContext() sharedContext?: Context<EntityManager>
    ): Promise<PayoutDTO> {`;
const endMarker=`    @InjectTransactionManager()
    protected async createPayouts_(`;
const a=source.indexOf(startMarker);
const b=source.indexOf(endMarker,a);
if(a<0||b<0||source.indexOf(startMarker,a+1)>=0)throw Error("NP_MERCUR_GUARD_ANCHOR_CHANGED");
const guarded=source.slice(0,a)+`    async createPayouts(
        _input: CreatePayoutDTO,
        @MedusaContext() _sharedContext?: Context<EntityManager>
    ): Promise<PayoutDTO> {
        // NP Direct Charge seller receives funds via Stripe connected account.
        // This module boundary blocks legacy Transfer for workflows, API, jobs
        // and direct service invocations. Never mark a fictional payout PAID.
        throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN"
        )
    }

`+source.slice(b);
writeFileSync(path,guarded);
console.log("B3-05a guard applied to pinned Mercur payout module. Legacy createPayouts is fail-closed.");
