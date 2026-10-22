// B3-04b: locally signed Stripe SDK events + REAL disposable PostgreSQL 15.
// No Stripe API request, no real funds, no Mercur runtime registration.
import {beforeAll,afterAll,test,expect} from "bun:test";
import {readFileSync} from "node:fs";
import Stripe from "stripe";
import {Pool} from "pg";
import {makeSignedPaymentIntentWebhookProcessor} from "../src/postgres-signed-webhook-processor";

if(!process.env.DATABASE_URL?.startsWith("postgresql://"))
  throw new Error("B3_TEST_TEMP_POSTGRES_REQUIRED");
const db=new Pool({connectionString:process.env.DATABASE_URL,max:18});
const stripe=new Stripe("sk_test_offline_fixture_only");
const secret="whsec_B304b_fake_local";
let failBeforeCommit=false;
const processWebhook=makeSignedPaymentIntentWebhookProcessor({
  db,stripe,webhookSecret:secret,
  beforeCommit:async()=>{if(failBeforeCommit)throw new Error("SIMULATED_TX_FAILURE");}
});
const schema=readFileSync(new URL("../db/b3-checkout-schema.sql",import.meta.url),"utf8");
const webhookSchema=readFileSync(new URL("../db/b3-webhook-schema.sql",import.meta.url),"utf8");
const tables="np_poc_b3_paid_outbox,np_poc_b3_ns_intake,np_poc_b3_webhook_inbox,np_poc_b3_checkout_attempts,np_poc_b3_payment_intents,np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers";
const events=(seller:string,id:string,type="payment_intent.succeeded",overrides:any={})=>{
  const account=seller==="A"?"acct_A123456":"acct_B123456";
  const amount=seller==="A"?2800:3200;
  return {id,type,account,
    data:{object:{
      id:"pi_"+seller+"123",object:"payment_intent",
      amount,currency:"jpy",status:type==="payment_intent.succeeded"?"succeeded":"processing",
      metadata:{session_id:"ps_"+seller+"123",np_order_id:"order"+seller,np_seller_id:"seller"+seller},
      ...overrides
    }}
  };
};
const signed=async (evt:any)=>{
  const raw=JSON.stringify(evt);
  const sig=await stripe.webhooks.generateTestHeaderStringAsync({payload:raw,secret});
  return {raw,sig};
};
const send=async(evt:any)=>{
  const x=await signed(evt);
  return processWebhook(x.raw,x.sig);
};
const count=async(table:string)=>{
  const r=await db.query("SELECT count(*)::int n FROM "+table);
  return r.rows[0].n as number;
};
beforeAll(async()=>{
  await db.query("DROP TABLE IF EXISTS "+tables+" CASCADE");
  await db.query(schema);
  await db.query(webhookSchema);
  for(const [s,amount,fee] of [["A",2800,280],["B",3200,320]] as const){
    await db.query("INSERT INTO np_poc_b3_sellers VALUES($1,'active','verified')",["seller"+s]);
    await db.query("INSERT INTO np_poc_b3_connect_accounts VALUES($1,$2,true,'active')",["seller"+s,"acct_"+s+"123456"]);
    await db.query("INSERT INTO np_poc_b3_listings VALUES($1,$2,'published')",["listing"+s,"seller"+s]);
    await db.query("INSERT INTO np_poc_b3_orders VALUES($1,$2,$3,$4,$5,$6,'jpy','pending')",
      ["order"+s,"seller"+s,"listing"+s,"acct_"+s+"123456",amount,fee]);
    await db.query("INSERT INTO np_poc_b3_payment_sessions VALUES($1,$2,'2099-01-01')",
      ["ps_"+s+"123","order"+s]);
    await db.query(`INSERT INTO np_poc_b3_payment_intents
      (session_id,intent_id,order_id,seller_id,account_id,amount_minor,currency)
      VALUES($1,$2,$3,$4,$5,$6,'jpy')`,
      ["ps_"+s+"123","pi_"+s+"123","order"+s,"seller"+s,"acct_"+s+"123456",amount]);
    await db.query(`INSERT INTO np_poc_b3_checkout_attempts
      (session_id,order_id,seller_id,account_id,amount_minor,fee_minor,
       currency,idempotency_key,state,intent_id)
      VALUES($1,$2,$3,$4,$5,$6,'jpy',$7,'bound',$8)`,
      ["ps_"+s+"123","order"+s,"seller"+s,"acct_"+s+"123456",
       amount,fee,"np:direct:ps_"+s+"123","pi_"+s+"123"]);
  }
});
afterAll(async()=>{await db.query("DROP TABLE IF EXISTS "+tables+" CASCADE");await db.end();});

test("16 concurrent identical signed callbacks -> one paid transition and one NS/outbox",async()=>{
  const x=await signed(events("A","evt_A_001"));
  const result=await Promise.all(Array.from({length:16},()=>processWebhook(x.raw,x.sig)));
  expect(result.filter(x=>x==="paid")).toHaveLength(1);
  expect(result.filter(x=>x==="duplicate_event")).toHaveLength(15);
  expect(await count("np_poc_b3_webhook_inbox")).toBe(1);
  expect(await count("np_poc_b3_ns_intake")).toBe(1);
  expect(await count("np_poc_b3_paid_outbox")).toBe(1);
  const r=await db.query("SELECT state FROM np_poc_b3_orders WHERE order_id='orderA'");
  expect(r.rows[0].state).toBe("paid");
});
test("new event ID for already-paid order does not duplicate intake or outbox",async()=>{
  expect(await send(events("A","evt_A_002"))).toBe("already_paid");
  expect(await count("np_poc_b3_ns_intake")).toBe(1);
  expect(await count("np_poc_b3_paid_outbox")).toBe(1);
});
test("late failed event after success cannot downgrade paid order",async()=>{
  expect(await send(events("A","evt_A_failed","payment_intent.payment_failed"))).toBe("nonterminal");
  const r=await db.query("SELECT state FROM np_poc_b3_orders WHERE order_id='orderA'");
  expect(r.rows[0].state).toBe("paid");
});
test("out-of-order failure before success leaves pending then completes once",async()=>{
  expect(await send(events("B","evt_B_failed","payment_intent.payment_failed"))).toBe("nonterminal");
  let r=await db.query("SELECT state FROM np_poc_b3_orders WHERE order_id='orderB'");
  expect(r.rows[0].state).toBe("pending");
  expect(await send(events("B","evt_B_success"))).toBe("paid");
  r=await db.query("SELECT state FROM np_poc_b3_orders WHERE order_id='orderB'");
  expect(r.rows[0].state).toBe("paid");
  expect(await count("np_poc_b3_ns_intake")).toBe(2);
  expect(await count("np_poc_b3_paid_outbox")).toBe(2);
});
test("cryptographically valid event with other connected account is rejected and rolled back",async()=>{
  const evt=events("A","evt_cross_account");
  evt.account="acct_B123456";
  const before=await count("np_poc_b3_webhook_inbox");
  await expect(send(evt)).rejects.toThrow("NP_WEBHOOK_BINDING_MISMATCH");
  expect(await count("np_poc_b3_webhook_inbox")).toBe(before);
});
test("wrong amount and seller metadata are rejected without inbox side effects",async()=>{
  const before=await count("np_poc_b3_webhook_inbox");
  await expect(send(events("A","evt_wrong_amount",undefined,{amount:3}))).rejects.toThrow("NP_WEBHOOK_BINDING_MISMATCH");
  await expect(send(events("A","evt_wrong_seller",undefined,{metadata:{
    session_id:"ps_A123",np_order_id:"orderA",np_seller_id:"sellerB"
  }}))).rejects.toThrow("NP_WEBHOOK_BINDING_MISMATCH");
  expect(await count("np_poc_b3_webhook_inbox")).toBe(before);
});
test("unknown PaymentIntent cannot complete order or enter inbox",async()=>{
  const before=await count("np_poc_b3_webhook_inbox");
  await expect(send(events("A","evt_unknown_intent",undefined,{id:"pi_FORGED123"})))
    .rejects.toThrow("NP_WEBHOOK_BINDING_MISMATCH");
  expect(await count("np_poc_b3_webhook_inbox")).toBe(before);
});
test("forged signature fails before DB mutation",async()=>{
  const evt=events("A","evt_forged");
  const x=await signed(evt);
  const before=await count("np_poc_b3_webhook_inbox");
  await expect(processWebhook(x.raw.replace("2800","9999"),x.sig)).rejects.toThrow();
  expect(await count("np_poc_b3_webhook_inbox")).toBe(before);
});
test("reused event ID with changed signed payload is rejected",async()=>{
  const before=await count("np_poc_b3_webhook_inbox");
  await expect(send(events("A","evt_A_001","payment_intent.payment_failed")))
    .rejects.toThrow("NP_WEBHOOK_EVENT_ID_COLLISION");
  expect(await count("np_poc_b3_webhook_inbox")).toBe(before);
});
test("transaction failure rolls back inbox, order transition, NS intake and outbox",async()=>{
  // A new order in same seller account, to prove a first paid transition rolls back.
  await db.query("INSERT INTO np_poc_b3_orders VALUES ('orderC','sellerA','listingA','acct_A123456',2800,280,'jpy','pending')");
  await db.query("INSERT INTO np_poc_b3_payment_sessions VALUES ('ps_C123','orderC','2099-01-01')");
  await db.query(`INSERT INTO np_poc_b3_payment_intents
    (session_id,intent_id,order_id,seller_id,account_id,amount_minor,currency)
    VALUES('ps_C123','pi_C123','orderC','sellerA','acct_A123456',2800,'jpy')`);
  await db.query(`INSERT INTO np_poc_b3_checkout_attempts
    (session_id,order_id,seller_id,account_id,amount_minor,fee_minor,currency,idempotency_key,state,intent_id)
    VALUES('ps_C123','orderC','sellerA','acct_A123456',2800,280,'jpy','np:direct:ps_C123','bound','pi_C123')`);
  const evt=events("A","evt_C_001");
  evt.data.object.id="pi_C123";
  evt.data.object.metadata={session_id:"ps_C123",np_order_id:"orderC",np_seller_id:"sellerA"};
  const before=await count("np_poc_b3_webhook_inbox");
  failBeforeCommit=true;
  try{await expect(send(evt)).rejects.toThrow("SIMULATED_TX_FAILURE");}
  finally{failBeforeCommit=false;}
  expect(await count("np_poc_b3_webhook_inbox")).toBe(before);
  const r=await db.query("SELECT state FROM np_poc_b3_orders WHERE order_id='orderC'");
  expect(r.rows[0].state).toBe("pending");
  expect(await count("np_poc_b3_ns_intake")).toBe(2);
  expect(await count("np_poc_b3_paid_outbox")).toBe(2);
  expect(await send(evt)).toBe("paid");
  expect(await count("np_poc_b3_ns_intake")).toBe(3);
  expect(await count("np_poc_b3_paid_outbox")).toBe(3);
});
test("unsupported event type does not touch inbox",async()=>{
  const before=await count("np_poc_b3_webhook_inbox");
  expect(await send(events("A","evt_unhandled","customer.updated"))).toBe("not_supported");
  expect(await count("np_poc_b3_webhook_inbox")).toBe(before);
});
