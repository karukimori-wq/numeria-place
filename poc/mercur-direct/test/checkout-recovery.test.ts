// B3-04a: REAL disposable PostgreSQL + deterministic MOCK Stripe transport.
// Demonstrates crash/retry safety only within a 12-hour Stripe key window.
// No real Stripe API or Mercur runtime is exercised.
import {beforeAll,afterAll,test,expect} from "bun:test";
import {readFileSync} from "node:fs";
import {Pool} from "pg";
import type Stripe from "stripe";
import {NumeriaDirectPaymentProvider} from "../src/numeria-direct-payment-provider";
import {makePostgresCheckoutResolver} from "../src/postgres-checkout-resolver";
import {makePostgresPaymentIntentRegistry} from "../src/postgres-payment-intent-registry";
import {makePostgresCheckoutAttemptCoordinator} from "../src/postgres-checkout-attempt-coordinator";

if (!process.env.DATABASE_URL?.startsWith("postgresql://"))
  throw new Error("B3_TEST_TEMP_POSTGRES_REQUIRED");
const db=new Pool({connectionString:process.env.DATABASE_URL,max:10});
const schema=readFileSync(new URL("../db/b3-checkout-schema.sql",import.meta.url),"utf8");
const resolve=makePostgresCheckoutResolver(db);
const registry=makePostgresPaymentIntentRegistry(db);
const attempts=makePostgresCheckoutAttemptCoordinator(db);
const intents=new Map<string,any>();
const createCalls:{session:string;key:string;account:string}[]=[];
let afterCreateError=false;
let hold:Promise<void>|undefined;
let failFinishOnce=false;
const stripe={
  paymentIntents:{
    create:async (p:any,options:any)=>{
      const sid=p.metadata.session_id;
      const row=await db.query("SELECT state FROM np_poc_b3_checkout_attempts WHERE session_id=$1",[sid]);
      if(row.rowCount!==1 || row.rows[0].state!=="reserved")
        throw new Error("STRIPE_CALLED_WITHOUT_DB_RESERVATION");
      createCalls.push({session:sid,key:options.idempotencyKey,account:options.stripeAccount});
      if(hold) await hold;
      const key=options.idempotencyKey;
      if(!intents.has(key))
        intents.set(key,{id:"pi_"+sid.replace(/[^A-Za-z0-9]/g,""),status:"requires_capture",
          amount:p.amount,currency:p.currency,metadata:p.metadata,client_secret:"fake_secret"});
      if(afterCreateError){afterCreateError=false;throw new Error("SIMULATED_RESPONSE_LOST");}
      return intents.get(key);
    },
    retrieve:async (id:string)=>{
      const p=[...intents.values()].find(x=>x.id===id);
      if(!p) throw new Error("INTENT_NOT_FOUND_IN_MOCK");
      return p;
    }
  }
} as unknown as Stripe;
const provider=new NumeriaDirectPaymentProvider({},{
  webhookSecret:"whsec_fake",stripeClient:stripe,
  resolveCheckout:resolve,paymentIntentRegistry:registry,
  checkoutAttempts:{
    acquire:(t)=>attempts.acquire(t),
    finish:async(t,token,id)=>{
      if(failFinishOnce){failFinishOnce=false;throw new Error("SIMULATED_DB_COMMIT_FAILED");}
      await attempts.finish(t,token,id);
    }
  }
});
const future="2099-01-01T00:00:00Z";
const names=["race","lost","dbcrash","aged","lease","snapshot"];
const session=(name:string)=>"ps_"+name+"001";
const initiate=(name:string)=>provider.initiatePayment({
  amount:2800,currency_code:"jpy",data:{session_id:session(name)}
});
const expireLease=async(name:string)=>db.query(
  "UPDATE np_poc_b3_checkout_attempts SET lease_until=now()-interval '1 second' WHERE session_id=$1",
  [session(name)]);
const waitFor=async(predicate:()=>boolean)=>{
  for(let i=0;i<100;i++){
    if(predicate())return;
    await new Promise(r=>setTimeout(r,10));
  }
  throw new Error("TEST_TIMEOUT_WAITING_FOR_STRIPE");
};
beforeAll(async()=>{
  await db.query("DROP TABLE IF EXISTS np_poc_b3_checkout_attempts,np_poc_b3_payment_intents,np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers CASCADE");
  await db.query(schema);
  await db.query("INSERT INTO np_poc_b3_sellers VALUES ('sellerA','active','verified')");
  await db.query("INSERT INTO np_poc_b3_connect_accounts VALUES ('sellerA','acct_A123456',true,'active')");
  await db.query("INSERT INTO np_poc_b3_listings VALUES ('listingA','sellerA','published')");
  for(const n of names){
    await db.query(`INSERT INTO np_poc_b3_orders VALUES
      ($1,'sellerA','listingA','acct_A123456',2800,280,'jpy','pending')`,["order_"+n]);
    await db.query("INSERT INTO np_poc_b3_payment_sessions VALUES ($1,$2,$3)",
      [session(n),"order_"+n,future]);
  }
});
afterAll(async()=>{
  await db.query("DROP TABLE IF EXISTS np_poc_b3_checkout_attempts,np_poc_b3_payment_intents,np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers CASCADE");
  await db.end();
});
test("DB reservation precedes Stripe; 8 simultaneous requests make one Stripe create",async()=>{
  const before=createCalls.length;
  let release!:()=>void;
  hold=new Promise<void>(r=>{release=r;});
  try{
    const first=initiate("race");
    await waitFor(()=>createCalls.length>before);
    const pending=await Promise.allSettled(Array.from({length:7},()=>initiate("race")));
    expect(pending.every(x=>x.status==="rejected" &&
      String((x as PromiseRejectedResult).reason).includes("NP_CHECKOUT_IN_PROGRESS"))).toBe(true);
    release();hold=undefined;
    const result=await first;
    expect(result.id).toBe("pi_psrace001");
    expect(createCalls.filter(x=>x.session===session("race"))).toHaveLength(1);
    const again=await initiate("race");
    expect(again.id).toBe(result.id);
    expect(createCalls.filter(x=>x.session===session("race"))).toHaveLength(1);
  }finally{release?.();hold=undefined;}
});
test("lost Stripe response retries SAME key after lease expiry, one mock intent",async()=>{
  afterCreateError=true;
  await expect(initiate("lost")).rejects.toThrow("SIMULATED_RESPONSE_LOST");
  const before=intents.size;
  await expect(initiate("lost")).rejects.toThrow("NP_CHECKOUT_IN_PROGRESS");
  await expireLease("lost");
  const result=await initiate("lost");
  expect(result.id).toBe("pi_pslost001");
  expect(intents.size).toBe(before);
  const keys=createCalls.filter(x=>x.session===session("lost")).map(x=>x.key);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
  const r=await db.query("SELECT state,intent_id FROM np_poc_b3_checkout_attempts WHERE session_id=$1",[session("lost")]);
  expect(r.rows[0].state).toBe("bound");
  expect(r.rows[0].intent_id).toBe(result.id);
});
test("DB commit failure after Stripe success recovers with same key",async()=>{
  failFinishOnce=true;
  await expect(initiate("dbcrash")).rejects.toThrow("SIMULATED_DB_COMMIT_FAILED");
  const before=intents.size;
  const unbound=await db.query("SELECT count(*)::int n FROM np_poc_b3_payment_intents WHERE session_id=$1",[session("dbcrash")]);
  expect(unbound.rows[0].n).toBe(0);
  await expireLease("dbcrash");
  const result=await initiate("dbcrash");
  expect(result.id).toBe("pi_psdbcrash001");
  expect(intents.size).toBe(before);
  const row=await db.query("SELECT state,intent_id FROM np_poc_b3_checkout_attempts WHERE session_id=$1",[session("dbcrash")]);
  expect(row.rows[0].state).toBe("bound");
  expect(row.rows[0].intent_id).toBe(result.id);
});
test("after 12h without binding, never create with an expired idempotency key",async()=>{
  const t=await resolve(session("aged"),"initiate");
  const lease=await attempts.acquire(t);
  expect(lease.kind).toBe("create");
  await db.query(`UPDATE np_poc_b3_checkout_attempts
    SET created_at=now()-interval '13 hours',lease_until=now()-interval '1 hour'
    WHERE session_id=$1`,[session("aged")]);
  const before=createCalls.length;
  await expect(initiate("aged")).rejects.toThrow("NP_RECONCILIATION_REQUIRED");
  expect(createCalls).toHaveLength(before);
  const r=await db.query("SELECT state FROM np_poc_b3_checkout_attempts WHERE session_id=$1",[session("aged")]);
  expect(r.rows[0].state).toBe("review");
});
test("invalid lease cannot bind PaymentIntent and transaction rolls back",async()=>{
  const t=await resolve(session("lease"),"initiate");
  const lease=await attempts.acquire(t);
  expect(lease.kind).toBe("create");
  await expect(attempts.finish(t,"00000000-0000-4000-8000-000000000000","pi_FORGED"))
    .rejects.toThrow("NP_CHECKOUT_LEASE_MISMATCH");
  const r=await db.query("SELECT count(*)::int n FROM np_poc_b3_payment_intents WHERE session_id=$1",[session("lease")]);
  expect(r.rows[0].n).toBe(0);
});
test("reservation snapshot mismatch rejects changed amount/account before Stripe",async()=>{
  const t=await resolve(session("snapshot"),"initiate");
  await attempts.acquire(t);
  await db.query("UPDATE np_poc_b3_orders SET amount_minor=2900 WHERE order_id='order_snapshot'");
  try {
    const updated=await resolve(session("snapshot"),"initiate");
    await expect(attempts.acquire(updated)).rejects.toThrow("NP_CHECKOUT_RESERVATION_MISMATCH");
  }finally{
    await db.query("UPDATE np_poc_b3_orders SET amount_minor=2800 WHERE order_id='order_snapshot'");
  }
});
