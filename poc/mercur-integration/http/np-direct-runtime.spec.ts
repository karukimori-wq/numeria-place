// Real Mercur boot/DI/HTTP + real NP PoC tables. Stripe API transport mocked.
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { Modules } from "@medusajs/framework/utils";
import { MercurModules } from "@mercurjs/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Stripe from "stripe";
import { database, state, secret, close } from "../../src/providers/np-direct/runtime";
const sdk=new Stripe("sk_test_OFFLINE_ONLY");
const providerId="pp_numeria-direct_np-direct";
let provider:any;
const refs:any={};
const tables="np_poc_b305_checkout_authority,np_poc_b3_paid_outbox,np_poc_b3_ns_intake,np_poc_b3_webhook_inbox,np_poc_b3_checkout_attempts,np_poc_b3_payment_intents,np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers";
jest.setTimeout(180000);
medusaIntegrationTestRunner({testSuite:({getContainer,api})=>{
  const signed=async(s:string,id:string,overrides:any={})=>{
    const p=state.intents.get(refs[s].id);
    const event={id,type:"payment_intent.succeeded",account:"acct_"+s+"123456",
      data:{object:{...p,status:"succeeded"}},...overrides};
    const raw=JSON.stringify(event);
    const signature=await sdk.webhooks.generateTestHeaderStringAsync({payload:raw,secret});
    return {raw,signature};
  };
  const post=(raw:string,signature:string,path="/hooks/np-direct")=>api.post(path,raw,{headers:{"content-type":"application/json","stripe-signature":signature},validateStatus:()=>true});
  const counts=async()=>{
    const db=database();
    return Promise.all(["np_poc_b3_webhook_inbox","np_poc_b3_ns_intake","np_poc_b3_paid_outbox"].map(async t=>Number((await db.query("SELECT count(*) n FROM "+t)).rows[0].n)));
  };
  beforeAll(async()=>{
    const db=database();
    await db.query("DROP TABLE IF EXISTS "+tables+" CASCADE");
    for(const name of ["b3-checkout-schema.sql","b3-webhook-schema.sql"])
      await db.query(readFileSync(join(process.cwd(),"src/providers/np-direct/db",name),"utf8"));
    await db.query(readFileSync(join(process.cwd(),"src/providers/np-direct/checkout-binding-schema.sql"),"utf8"));
    for(const s of ["A","B","C"]){
      await db.query("INSERT INTO np_poc_b3_sellers VALUES($1,'active','verified')",["seller"+s]);
      await db.query("INSERT INTO np_poc_b3_connect_accounts VALUES($1,$2,true,'active')",["seller"+s,"acct_"+s+"123456"]);
      await db.query("INSERT INTO np_poc_b3_listings VALUES($1,$2,'published')",["listing"+s,"seller"+s]);
      await db.query("INSERT INTO np_poc_b3_orders VALUES($1,$2,$3,$4,2800,280,'jpy','pending')",["order"+s,"seller"+s,"listing"+s,"acct_"+s+"123456"]);
      await db.query("INSERT INTO np_poc_b3_payment_sessions VALUES($1,$2,'2099-01-01')",["ps_"+s+"123","order"+s]);
    }
    const payment:any=getContainer().resolve(Modules.PAYMENT);
    provider=payment.paymentProviderService_.retrieveProvider(providerId);
  });
  afterAll(async()=>{await database().query("DROP TABLE IF EXISTS "+tables+" CASCADE");await close();});
  it("registers real Payment Provider through Medusa DI; creates bound connected-account intent",async()=>{
    expect(provider.constructor.identifier).toBe("numeria-direct");
    await db.query(readFileSync(join(process.cwd(),"src/providers/np-direct/checkout-binding-schema.sql"),"utf8"));
    for(const s of ["A","B","C"]){
      const result=await provider.initiatePayment({amount:2800,currency_code:"jpy",data:{session_id:"ps_"+s+"123",accountId:"acct_EVIL"}});
      refs[s]=result.data;
    }
    expect(state.calls.filter(x=>x.method==="create").map(x=>x.account)).toEqual(["acct_A123456","acct_B123456","acct_C123456"]);
    expect(Number((await database().query("SELECT count(*) n FROM np_poc_b3_payment_intents")).rows[0].n)).toBe(3);
  });
  it("reuses persisted intent and rejects wrong amount and cross-account references",async()=>{
    const before=state.calls.filter(x=>x.method==="create").length;
    await provider.initiatePayment({amount:2800,currency_code:"jpy",data:{session_id:"ps_A123"}});
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(before);
    await expect(provider.initiatePayment({amount:1,currency_code:"jpy",data:{session_id:"ps_A123"}})).rejects.toThrow("NP_AMOUNT_MISMATCH");
    await expect(provider.retrievePayment({data:{...refs.A,np_connect_account:"acct_B123456"}})).rejects.toThrow("NP_CONNECT_ACCOUNT_MISMATCH");
    expect((await provider.getPaymentStatus({data:refs.A})).status).toBe("authorized");
  });
  it("HTTP signature rejection does not touch Inbox/Intake/Outbox",async()=>{
    const x=await signed("A","evt_bad_signature");
    expect((await post(x.raw,"invalid")).status).toBe(400);
    expect(await counts()).toEqual([0,0,0]);
  });
  it("HTTP rejects valid signature on wrong Connected Account",async()=>{
    const x=await signed("A","evt_wrong_account",{account:"acct_B123456"});
    expect((await post(x.raw,x.signature)).status).toBe(503);
    expect(await counts()).toEqual([0,0,0]);
  });
  it("16 real HTTP replays commit NP paid/NS Intake/Outbox once, no legacy event emit",async()=>{
    const bus:any=getContainer().resolve(Modules.EVENT_BUS);
    const emit=jest.spyOn(bus,"emit");
    const x=await signed("A","evt_http_A123");
    const responses=await Promise.all(Array.from({length:16},()=>post(x.raw,x.signature)));
    expect(responses.map(r=>r.status)).toEqual(Array(16).fill(200));
    expect(await counts()).toEqual([1,1,1]);
    expect(emit).not.toHaveBeenCalled();emit.mockRestore();
    expect((await database().query("SELECT state FROM np_poc_b3_orders WHERE order_id='orderA'")).rows[0].state).toBe("paid");
  });
  it("legacy HTTP provider endpoint cannot enqueue a second completion",async()=>{
    const x=await signed("A","evt_http_legacy");
    expect((await post(x.raw,x.signature,"/hooks/payment/"+providerId)).status).toBe(409);
    expect(await counts()).toEqual([1,1,1]);
    expect((await provider.getWebhookActionAndData({})).action).toBe("not_supported");
  });
  it("unknown/unbound intent returns retryable error then same signed event succeeds after binding",async()=>{
    const db=database();
    await db.query("DELETE FROM np_poc_b3_payment_intents WHERE session_id='ps_B123'");
    const x=await signed("B","evt_http_early");
    expect((await post(x.raw,x.signature)).status).toBe(503);
    expect(await counts()).toEqual([1,1,1]);
    await db.query("INSERT INTO np_poc_b3_payment_intents(session_id,intent_id,order_id,seller_id,account_id,amount_minor,currency) VALUES('ps_B123',$1,'orderB','sellerB','acct_B123456',2800,'jpy')",[refs.B.id]);
    expect((await post(x.raw,x.signature)).status).toBe(200);
    expect(await counts()).toEqual([2,2,2]);
  });
  it("DB failure returns 503 and rolls back; exact retry commits once",async()=>{
    const x=await signed("C","evt_http_retry");state.failCommit=true;
    try {expect((await post(x.raw,x.signature)).status).toBe(503);}finally{state.failCommit=false;}
    expect(await counts()).toEqual([2,2,2]);
    expect((await post(x.raw,x.signature)).status).toBe(200);
    expect((await post(x.raw,x.signature)).status).toBe(200);
    expect(await counts()).toEqual([3,3,3]);
  });
  it("refund and cancel use original account; paid order cannot initiate again",async()=>{
    await provider.capturePayment({data:refs.A});
    await provider.refundPayment({amount:2800,data:refs.A});
    await provider.cancelPayment({data:refs.B});
    expect(state.calls.find(x=>x.method==="refund")?.account).toBe("acct_A123456");
    expect(state.calls.find(x=>x.method==="cancel")?.account).toBe("acct_B123456");
    await expect(provider.initiatePayment({amount:2800,currency_code:"jpy",data:{session_id:"ps_A123"}})).rejects.toThrow("NP_ORDER_ALREADY_FINALIZED");
  });
  it("actual Mercur service refuses concurrent payout attempts before provider or DB writes",async()=>{
    const payout:any=getContainer().resolve(MercurModules.PAYOUT);
    const call=jest.spyOn(payout.payoutProviderService_,"createPayout");
    const before=await payout.listPayouts({},{withDeleted:true});
    const results=await Promise.allSettled(Array.from({length:8},()=>payout.createPayouts({account_id:"nonexistent",amount:2800,currency_code:"jpy"})));
    expect(results.every(x=>x.status==="rejected" && x.reason.message.includes("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN"))).toBe(true);
    expect(call).not.toHaveBeenCalled();call.mockRestore();
    expect(await payout.listPayouts({},{withDeleted:true})).toHaveLength(before.length);
  });
}});
