import {test,expect} from "bun:test";
import Stripe from "stripe";
import {NumeriaDirectPaymentProvider} from "../src/numeria-direct-payment-provider";
const account="acct_123456789", session="ps_123", order="order_123", seller="seller_123";
const trusted={orderId:order,sellerId:seller,accountId:account,amount:1500,fee:150,currency:"jpy" as const,sessionId:session};
const intent={id:"pi_123456789",status:"requires_capture",amount:1500,currency:"jpy",
  client_secret:"pi_secret",metadata:{session_id:session,np_order_id:order,np_seller_id:seller}};
function setup(change:any={}) {
 const calls:any[]=[];
 const p={...intent,...change,metadata:{...intent.metadata,...change.metadata}};
 const client={
  paymentIntents:{
   create:async (params:any,opts:any)=>{calls.push(["create",params,opts]);return p;},
   retrieve:async (id:any,opts:any)=>{calls.push(["retrieve",id,opts]);return p;},
   capture:async (id:any,params:any,opts:any)=>{calls.push(["capture",id,opts]);return {...p,status:"succeeded"};},
   cancel:async (id:any,params:any,opts:any)=>{calls.push(["cancel",id,opts]);return {...p,status:"canceled"};},
  },
  refunds:{create:async (params:any,opts:any)=>{calls.push(["refund",params,opts]);return {id:"re_123"};}},
  webhooks:new Stripe("sk_test_placeholder").webhooks
 } as unknown as Stripe;
 const provider=new NumeriaDirectPaymentProvider({},{
  webhookSecret:"whsec_local",stripeClient:client,
  resolveCheckout:async (_session)=>change.resolved ?? trusted
 });
 return {provider,calls,client,p};
}
const ref={id:intent.id,np_connect_account:account,session_id:session};
test("direct charge uses trusted connected account and application fee",async()=>{
 const {provider,calls}=setup();
 const r=await provider.initiatePayment({amount:1500,currency_code:"jpy",data:{session_id:session,accountId:"acct_EVIL",fee:0}});
 expect(r.id).toBe(intent.id);
 expect(calls[0][1].application_fee_amount).toBe(150);
 expect(calls[0][2].stripeAccount).toBe(account);
 expect(calls[0][1].metadata.np_seller_id).toBe(seller);
});
test("reject mismatched amount before Stripe request",async()=>{
 const {provider,calls}=setup();
 await expect(provider.initiatePayment({amount:1400,currency_code:"jpy",data:{session_id:session}})).rejects.toThrow("NP_AMOUNT_MISMATCH");
 expect(calls).toHaveLength(0);
});
test("reject seller account tampering in persisted payment reference",async()=>{
 const {provider,calls}=setup();
 await expect(provider.authorizePayment({data:{...ref,np_connect_account:"acct_EVIL"}})).rejects.toThrow("NP_CONNECT_ACCOUNT_MISMATCH");
 expect(calls).toHaveLength(0);
});
test("reject wrong order mapping in retrieved intent",async()=>{
 const {provider}=setup({metadata:{np_order_id:"order_OTHER"}});
 await expect(provider.authorizePayment({data:ref})).rejects.toThrow("NP_PAYMENT_INTENT_MISMATCH");
});
test("capture occurs only on connected account",async()=>{
 const {provider,calls}=setup();
 await provider.capturePayment({data:ref});
 expect(calls.find(c=>c[0]==="capture")[2].stripeAccount).toBe(account);
});
test("cancel cannot silently cancel a captured charge",async()=>{
 const {provider,calls}=setup({status:"succeeded"});
 await expect(provider.cancelPayment({data:ref})).rejects.toThrow("NP_CANCEL_CAPTURED_REQUIRES_REFUND");
 expect(calls.some(c=>c[0]==="cancel")).toBe(false);
});
test("refund executes on same connected account",async()=>{
 const {provider,calls}=setup({status:"succeeded"});
 await provider.refundPayment({amount:500,data:ref});
 const c=calls.find(c=>c[0]==="refund");
 expect(c[1].refund_application_fee).toBe(true);
 expect(c[2].stripeAccount).toBe(account);
});
test("refund rejects amount exceeding order",async()=>{
 const {provider,calls}=setup({status:"succeeded"});
 await expect(provider.refundPayment({amount:1501,data:ref})).rejects.toThrow("NP_REFUND_INVALID");
 expect(calls.some(c=>c[0]==="refund")).toBe(false);
});
test("webhook requires valid signature and connected account",async()=>{
 const {provider,client}=setup();
 const payload={id:"evt_123",type:"payment_intent.succeeded",account,
  data:{object:{...intent,status:"succeeded"}}};
 const raw=JSON.stringify(payload);
 const sig=await client.webhooks.generateTestHeaderStringAsync({payload:raw,secret:"whsec_local"});
 const ok=await provider.getWebhookActionAndData({provider:"pp_numeria-direct_default",payload:{
  rawData:Buffer.from(raw),headers:{"stripe-signature":sig},data:payload
 }});
 expect(ok.action).toBe("captured");
 const forged=JSON.stringify({...payload,account:"acct_EVIL"});
 const forgedSig=await client.webhooks.generateTestHeaderStringAsync({payload:forged,secret:"whsec_local"});
 await expect(provider.getWebhookActionAndData({provider:"pp_numeria-direct_default",payload:{
  rawData:Buffer.from(forged),headers:{"stripe-signature":forgedSig},data:payload
 }})).rejects.toThrow("NP_WEBHOOK_ORDER_MISMATCH");
});
