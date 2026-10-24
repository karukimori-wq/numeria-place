// B3-05a: actual Mercur module boot + payoutService.createPayouts.
// This uses a disposable PostgreSQL and an OFFLINE Stripe SDK key.
// It does not call Stripe, and no seller funds are moved.
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { MercurModules, PayoutAccountStatus } from "@mercurjs/types";
import type { MedusaContainer } from "@medusajs/framework/types";

jest.setTimeout(120000);
medusaIntegrationTestRunner({
  testSuite: ({getContainer})=>{
    describe("NP Direct charges Mercur payout hard stop",()=>{
      let container:MedusaContainer;
      beforeAll(()=>{container=getContainer();});
      it("loads the NP provider, not Mercur SystemPayoutProvider",async()=>{
        const service:any=container.resolve(MercurModules.PAYOUT);
        const provider:any=service.payoutProviderService_;
        expect(provider).toBeDefined();
        await expect(provider.createPayout({
          account_id:"pacc_poc_A",amount:1500,currency_code:"jpy",
          data:{id:"acct_TestOnly",order_id:"order_poc"}
        })).rejects.toThrow("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN");
      });
      it("real payout module does not mark paid or retain payout row on attempted transfer",async()=>{
        const service:any=container.resolve(MercurModules.PAYOUT);
        const account=await service.createPayoutAccounts({
          status:PayoutAccountStatus.ACTIVE,data:{id:"acct_TestOnly"}
        });
        await expect(service.createPayouts({
          account_id:account.id,amount:1500,currency_code:"jpy",
          data:{id:"acct_TestOnly",order_id:"order_poc"},
          context:{idempotency_key:"order_poc"}
        })).rejects.toThrow("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN");
        const records=await service.listPayouts({account_id:account.id},{withDeleted:true});
        expect(records).toHaveLength(0);
      });
    });
  }
});
