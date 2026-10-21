import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { NumeriaDirectNoTransferProvider } from "../src/numeria-direct-no-transfer-provider";

const sdk = new Stripe("sk_test_local_synthetic_only");
const webhookSecret = "whsec_poc_synthetic_only";
const transferCalls:unknown[] = [];
const accountCalls:unknown[] = [];
const linkCalls:unknown[] = [];

const fakeSDK = {
  accounts:{create:async (params:unknown, options:unknown)=>{
    accountCalls.push({params,options});
    return {id:"acct_PocSellerA",charges_enabled:false,payouts_enabled:false};
  }},
  accountLinks:{create:async (params:unknown)=>{
    linkCalls.push(params);
    return {url:"https://connect.stripe.test/setup",expires_at:123456};
  }},
  webhooks:sdk.webhooks,
  // No transfers property; any call to Stripe Transfers would be a test failure.
  transfers:{create:async (...args:unknown[])=>{transferCalls.push(args);throw new Error("FORBIDDEN_TRANSFER_CALLED");}}
};
const provider=()=>new NumeriaDirectNoTransferProvider({},{
  webhookSecret,testStripeClient:fakeSDK as any,
});

describe("Mercur-compatible Direct account management + payout lockout",()=>{
  test("createPayout rejects before any external Stripe transfer",async()=>{
    const p=provider();
    await expect(p.createPayout({
      account_id:"payout_acct_A",amount:1500,currency_code:"JPY",
      context:{idempotency_key:"order_1"},data:{id:"acct_PocSellerA",seller_id:"seller_A"}
    } as any)).rejects.toThrow("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN");
    expect(transferCalls.length).toBe(0);
  });

  test("replay of payout workflow also cannot transfer seller funds",async()=>{
    const p=provider();
    for(let i=0;i<3;i++){
      await expect(p.createPayout({account_id:"A",amount:1000,currency_code:"JPY",data:{}} as any))
        .rejects.toThrow("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN");
    }
    expect(transferCalls.length).toBe(0);
  });

  test("seller onboarding keeps connected-account reference",async()=>{
    const p=provider();
    const res=await p.createPayoutAccount({
      data:{country:"jp",account_id:"poc_internal_A"},context:{idempotency_key:"pocA"}
    } as any);
    expect(res.status).toBe("pending");
    expect(res.id).toBe("acct_PocSellerA");
    expect((accountCalls.at(-1) as any).params.country).toBe("JP");
    expect((accountCalls.at(-1) as any).params.metadata.account_id).toBe("poc_internal_A");
    expect((accountCalls.at(-1) as any).options.idempotencyKey).toBe("pocA");
  });

  test("unsafe onboarding URLs and account IDs fail closed",async()=>{
    const p=provider();
    await expect(p.createOnboarding({data:{
      id:"acct_PocSellerA",refresh_url:"http://unsafe/",return_url:"https://ok.invalid/"
    }} as any)).rejects.toThrow("REFRESH_URL_INVALID");
    await expect(p.createOnboarding({data:{
      id:"acct_invalid-with-hyphen",refresh_url:"https://ok.invalid/",return_url:"https://ok.invalid/"
    }} as any)).rejects.toThrow("CONNECT_ACCOUNT_REQUIRED");
  });

  test("seller onboarding produces safe Stripe hosted link",async()=>{
    const p=provider();
    const x=await p.createOnboarding({data:{
      id:"acct_PocSellerA",refresh_url:"https://np.example.test/connect/refresh",
      return_url:"https://np.example.test/connect/return"
    }} as any);
    expect((x.data as any).url).toContain("https://");
    expect((linkCalls.at(-1) as any).account).toBe("acct_PocSellerA");
  });

  test("actual Stripe SDK validates webhook cryptographic signature, then activates eligible account",async()=>{
    const e={id:"evt_poc_1",type:"account.updated",data:{object:{
      id:"acct_PocSellerA",charges_enabled:true,payouts_enabled:true,
      metadata:{account_id:"poc_internal_A"},requirements:{currently_due:[],past_due:[]}
    }}};
    const payload=JSON.stringify(e);
    const signature=sdk.webhooks.generateTestHeaderString({payload,secret:webhookSecret});
    const res=await provider().getWebhookActionAndData({
      rawData:payload,headers:{"stripe-signature":signature}
    } as any);
    expect(res.action).toBe("account.activated");
    expect((res.data as any).id).toBe("poc_internal_A");
    await expect(provider().getWebhookActionAndData({
      rawData:payload.replace('"charges_enabled":true','"charges_enabled":false'),headers:{"stripe-signature":signature}
    } as any)).rejects.toThrow();
  });

  test("restricted and rejected Stripe accounts cannot become active",async()=>{
    const base={id:"acct_PocSellerA",charges_enabled:false,payouts_enabled:false,
      metadata:{account_id:"poc_internal_A"}};
    const signed=async (acct:unknown)=>{
      const payload=JSON.stringify({id:"evt_poc_2",type:"account.updated",data:{object:acct}});
      const signature=sdk.webhooks.generateTestHeaderString({payload,secret:webhookSecret});
      return provider().getWebhookActionAndData({
        rawData:payload,headers:{"stripe-signature":signature}
      } as any);
    };
    expect((await signed({...base,requirements:{currently_due:["external_account"]}})).action).toBe("account.restricted");
    expect((await signed({...base,requirements:{disabled_reason:"rejected.fraud"}})).action).toBe("account.rejected");
  });
});
