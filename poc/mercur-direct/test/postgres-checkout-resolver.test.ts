// B3-03: REAL disposable PostgreSQL + mock Stripe API. No real charges.
import {beforeAll,afterAll,test,expect} from "bun:test";
import {readFileSync} from "node:fs";
import {Pool} from "pg";
import type Stripe from "stripe";
import {makePostgresCheckoutResolver} from "../src/postgres-checkout-resolver";
import {makePostgresPaymentIntentRegistry} from "../src/postgres-payment-intent-registry";
import {makePostgresCheckoutAttemptCoordinator} from "../src/postgres-checkout-attempt-coordinator";
import {NumeriaDirectPaymentProvider} from "../src/numeria-direct-payment-provider";

if (!process.env.DATABASE_URL?.startsWith("postgresql://"))
  throw new Error("B3_TEST_TEMP_POSTGRES_REQUIRED");
const db=new Pool({connectionString:process.env.DATABASE_URL,max:8});
const schema=readFileSync(new URL("../db/b3-checkout-schema.sql",import.meta.url),"utf8");
const resolve=makePostgresCheckoutResolver(db);
const registry=makePostgresPaymentIntentRegistry(db);
const checkoutAttempts=makePostgresCheckoutAttemptCoordinator(db);
const nowFuture="2099-01-01T00:00:00Z";
const calls:any[]=[];
const stripe={
  paymentIntents:{
    create:async (p:any,o:any)=>{
      calls.push({params:p,options:o});
      return {id:p.metadata.session_id==="ps_orderA"?"pi_A123":"pi_B123",status:"requires_capture",amount:p.amount,currency:p.currency,
        client_secret:"secret_test",metadata:p.metadata};
    },
    retrieve:async (id:string)=>{
      const a=id==="pi_A123";
      return {id,status:"requires_capture",amount:a?2800:3200,currency:"jpy",
        client_secret:"secret_test",
        metadata:{session_id:a?"ps_orderA":"ps_orderB",
          np_order_id:a?"orderA":"orderB",np_seller_id:a?"sellerA":"sellerB"}};
    }
  }
} as unknown as Stripe;
const provider=new NumeriaDirectPaymentProvider({},{
  webhookSecret:"whsec_fake_no_external",stripeClient:stripe,resolveCheckout:resolve,
  paymentIntentRegistry:registry,checkoutAttempts
});
beforeAll(async()=>{
 await db.query("DROP TABLE IF EXISTS np_poc_b3_checkout_attempts,np_poc_b3_payment_intents,np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers CASCADE");
 await db.query(schema);
 await db.query(`INSERT INTO np_poc_b3_sellers VALUES
   ('sellerA','active','verified'),('sellerB','active','verified'),('sellerC','suspended','pending')`);
 await db.query(`INSERT INTO np_poc_b3_connect_accounts VALUES
   ('sellerA','acct_A123456',true,'active'),
   ('sellerB','acct_B123456',true,'active'),
   ('sellerC','acct_C123456',false,'restricted')`);
 await db.query(`INSERT INTO np_poc_b3_listings VALUES
   ('listingA','sellerA','published'),('listingB','sellerB','published'),
   ('listingC','sellerC','published')`);
 await db.query(`INSERT INTO np_poc_b3_orders VALUES
   ('orderA','sellerA','listingA','acct_A123456',2800,280,'jpy','pending'),
   ('orderB','sellerB','listingB','acct_B123456',3200,320,'jpy','pending'),
   ('orderC','sellerC','listingC','acct_C123456',1800,180,'jpy','pending')`);
 await db.query("INSERT INTO np_poc_b3_payment_sessions VALUES ('ps_orderA','orderA',$1),('ps_orderB','orderB',$1),('ps_orderC','orderC',$1)",[nowFuture]);
});
afterAll(async()=>{
 await db.query("DROP TABLE IF EXISTS np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers CASCADE");
 await db.end();
});
test("real PostgreSQL resolves seller and amount, ignores hostile client account",async()=>{
 calls.length=0;
 const result=await provider.initiatePayment({amount:2800,currency_code:"jpy",
   data:{session_id:"ps_orderA",accountId:"acct_B123456",application_fee_amount:0}});
 expect(result.id).toBe("pi_A123");
 expect(calls).toHaveLength(1);
 expect(calls[0].options.stripeAccount).toBe("acct_A123456");
 expect(calls[0].params.application_fee_amount).toBe(280);
 expect(calls[0].params.metadata.np_order_id).toBe("orderA");
 const rows=await db.query("SELECT intent_id,account_id FROM np_poc_b3_payment_intents WHERE session_id=$1",["ps_orderA"]);
 expect(rows.rows[0].intent_id).toBe("pi_A123");
 expect(rows.rows[0].account_id).toBe("acct_A123456");
});
test("another seller resolves to their own account",async()=>{
 calls.length=0;
 await provider.initiatePayment({amount:3200,currency_code:"jpy",data:{session_id:"ps_orderB"}});
 expect(calls[0].options.stripeAccount).toBe("acct_B123456");
});
test("cross-seller listing is blocked by composite FK",async()=>{
 await expect(db.query(`INSERT INTO np_poc_b3_orders VALUES
  ('orderBad','sellerA','listingB','acct_A123456',2800,0,'jpy','pending')`))
   .rejects.toThrow();
});
test("cross-seller account is blocked by composite FK",async()=>{
 await expect(db.query(`INSERT INTO np_poc_b3_orders VALUES
  ('orderBad2','sellerA','listingA','acct_B123456',2800,0,'jpy','pending')`))
   .rejects.toThrow();
});
test("duplicate payment session for one order is blocked",async()=>{
 await expect(db.query(`INSERT INTO np_poc_b3_payment_sessions VALUES
   ('ps_duplicate','orderA',$1)`,[nowFuture])).rejects.toThrow();
});
test("suspended seller and disabled charges cannot start payment",async()=>{
 calls.length=0;
 await expect(provider.initiatePayment({amount:1800,currency_code:"jpy",
  data:{session_id:"ps_orderC"}})).rejects.toThrow("NP_SELLER_NOT_ELIGIBLE");
 expect(calls).toHaveLength(0);
});
test("wrong amount or currency fails before Stripe API",async()=>{
 calls.length=0;
 await expect(provider.initiatePayment({amount:2801,currency_code:"jpy",
  data:{session_id:"ps_orderA"}})).rejects.toThrow("NP_AMOUNT_MISMATCH");
 await expect(provider.initiatePayment({amount:2800,currency_code:"usd",
  data:{session_id:"ps_orderA"}})).rejects.toThrow("NP_CURRENCY_MISMATCH");
 expect(calls).toHaveLength(0);
});
test("expired checkout session cannot initiate a charge",async()=>{
 calls.length=0;
 await db.query("UPDATE np_poc_b3_payment_sessions SET expires_at='2000-01-01' WHERE session_id='ps_orderA'");
 try {
  await expect(provider.initiatePayment({amount:2800,currency_code:"jpy",
    data:{session_id:"ps_orderA"}})).rejects.toThrow("NP_SESSION_EXPIRED");
  expect(calls).toHaveLength(0);
 } finally {
  await db.query("UPDATE np_poc_b3_payment_sessions SET expires_at=$1 WHERE session_id='ps_orderA'",[nowFuture]);
 }
});
test("paid order cannot initiate a second charge",async()=>{
 calls.length=0;
 await db.query("UPDATE np_poc_b3_orders SET state='paid' WHERE order_id='orderA'");
 try {
  await expect(provider.initiatePayment({amount:2800,currency_code:"jpy",
    data:{session_id:"ps_orderA"}})).rejects.toThrow("NP_ORDER_ALREADY_FINALIZED");
  expect(calls).toHaveLength(0);
 } finally {
  await db.query("UPDATE np_poc_b3_orders SET state='pending' WHERE order_id='orderA'");
 }
});
test("existing paid order can still be resolved after seller suspended and session expired",async()=>{
 await db.query("UPDATE np_poc_b3_orders SET state='paid' WHERE order_id='orderA'");
 await db.query("UPDATE np_poc_b3_sellers SET status='suspended' WHERE seller_id='sellerA'");
 await db.query("UPDATE np_poc_b3_payment_sessions SET expires_at='2000-01-01' WHERE session_id='ps_orderA'");
 try {
  const r=await resolve("ps_orderA","existing");
  expect(r.orderState).toBe("paid");
  expect(r.accountId).toBe("acct_A123456");
 } finally {
  await db.query("UPDATE np_poc_b3_orders SET state='pending' WHERE order_id='orderA'");
  await db.query("UPDATE np_poc_b3_sellers SET status='active' WHERE seller_id='sellerA'");
  await db.query("UPDATE np_poc_b3_payment_sessions SET expires_at=$1 WHERE session_id='ps_orderA'",[nowFuture]);
 }
});
test("invalid session identifier rejected before DB lookup",async()=>{
 await expect(resolve("ps_' OR 1=1 --")).rejects.toThrow("NP_SESSION_INVALID");
});

test("different PaymentIntent cannot replace durable session binding",async()=>{
 const t=await resolve("ps_orderA","existing");
 await expect(registry.bind({
  sessionId:t.sessionId,orderId:t.orderId,sellerId:t.sellerId,
  accountId:t.accountId,amount:t.amount,currency:t.currency,intentId:"pi_FORGED123"
 })).rejects.toThrow("NP_INTENT_BINDING_MISMATCH");
});
test("wrong seller cannot verify a bound intent",async()=>{
 const t=await resolve("ps_orderA","existing");
 await expect(registry.verify({
  sessionId:t.sessionId,orderId:t.orderId,sellerId:"sellerB",
  accountId:t.accountId,amount:t.amount,currency:t.currency,intentId:"pi_A123"
 })).rejects.toThrow("NP_INTENT_BINDING_MISMATCH");
});
test("repeat same session has one durable PaymentIntent and one Stripe idempotency key",async()=>{
 calls.length=0;
 await Promise.all(Array.from({length:8},()=>provider.initiatePayment({
  amount:2800,currency_code:"jpy",data:{session_id:"ps_orderA"}
 })));
 expect(calls).toHaveLength(0); // Already bound: all requests retrieve same intent.
 const rows=await db.query("SELECT count(*)::integer n FROM np_poc_b3_payment_intents WHERE session_id=$1",["ps_orderA"]);
 expect(rows.rows[0].n).toBe(1);
});
