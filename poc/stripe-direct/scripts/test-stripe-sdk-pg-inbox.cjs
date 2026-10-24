/* PoC 00-B2: a REAL stripe-node v23 webhook signature + REAL PostgreSQL
   transactional inbox/order/outbox test, but NO Stripe API calls or real funds.
   CI-only, ephemeral schema. NOT a production implementation. */
const assert=require("node:assert/strict");
const Stripe=require("stripe");
const {Pool}=require("pg");
const secret="whsec_poc_no_real_key";
const stripe=new Stripe("sk_test_offline_fixture_not_a_key");
const url=process.env.DATABASE_URL;
if(!url || !url.startsWith("postgresql://")) throw new Error("TEMP_DATABASE_ONLY");
const pool=new Pool({connectionString:url,max:8,connectionTimeoutMillis:10000});
const build=(id,eventID,changes={})=>({
 id:eventID,type:"checkout.session.completed",account:"acct_PocSellerA",
 data:{object:{
   id:"cs_poc_A",client_reference_id:id,payment_intent:"pi_poc_A",
   amount_total:3200,currency:"jpy",payment_status:"paid",
   metadata:{np_order_id:id,np_seller_id:"sellerA"},
   ...changes,
 }}
});
function signed(evt){
 const rawBody=JSON.stringify(evt);
 const signature=stripe.webhooks.generateTestHeaderString({payload:rawBody,secret});
 return {rawBody,signature};
}
async function processOne(input){
 // Vendor signature verified *before* DB changes.
 const evt=stripe.webhooks.constructEvent(input.rawBody,input.signature,secret);
 assert.equal(evt.type,"checkout.session.completed");
 const obj=evt.data.object;
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const e=await client.query(`
    INSERT INTO np_poc_sdk_inbox(event_id) VALUES($1)
    ON CONFLICT DO NOTHING RETURNING event_id`,[evt.id]);
  if(e.rowCount===0){await client.query("COMMIT");return "duplicate_event";}
  const q=await client.query(`SELECT * FROM np_poc_sdk_orders WHERE order_id=$1 FOR UPDATE`,[obj.client_reference_id]);
  if(q.rowCount!==1){throw new Error("ORDER_NOT_FOUND");}
  const o=q.rows[0];
  if(evt.account!==o.stripe_account || obj.id!==o.checkout_id||
    obj.metadata?.np_order_id!==o.order_id ||obj.metadata?.np_seller_id!==o.seller_id ||
    obj.payment_intent!==o.payment_intent || obj.payment_status!=="paid" ||
    obj.amount_total!==o.amount_minor || obj.currency?.toUpperCase()!==o.currency){
    throw new Error("SELLER_OR_CHARGE_MISMATCH");
  }
  if(o.payment_state!=="paid"){
    if(o.payment_state!=="pending")throw new Error("INVALID_TRANSITION");
    await client.query("UPDATE np_poc_sdk_orders SET payment_state='paid' WHERE order_id=$1",[o.order_id]);
    await client.query(`INSERT INTO np_poc_sdk_intake(order_id) VALUES($1) ON CONFLICT DO NOTHING`,[o.order_id]);
    await client.query(`INSERT INTO np_poc_sdk_outbox(order_id) VALUES($1) ON CONFLICT DO NOTHING`,[o.order_id]);
  }
  await client.query("COMMIT");
  return o.payment_state==="paid"?"already_paid":"paid";
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
async function count(table){const r=await pool.query("SELECT count(*)::integer n FROM "+table);return r.rows[0].n}
(async()=>{
 const tables=["np_poc_sdk_outbox","np_poc_sdk_intake","np_poc_sdk_inbox","np_poc_sdk_orders"];
 try{
  await pool.query("CREATE TABLE np_poc_sdk_orders (order_id text PRIMARY KEY,seller_id text NOT NULL,stripe_account text NOT NULL,amount_minor integer NOT NULL,currency text NOT NULL,checkout_id text NOT NULL,payment_intent text NOT NULL,payment_state text NOT NULL)");
  await pool.query("CREATE TABLE np_poc_sdk_inbox (event_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE np_poc_sdk_intake (order_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE np_poc_sdk_outbox (order_id text PRIMARY KEY)");
  await pool.query("INSERT INTO np_poc_sdk_orders VALUES('np-test-A','sellerA','acct_PocSellerA',3200,'JPY','cs_poc_A','pi_poc_A','pending')");
  // Concurrent, identical event replay: only one paid transition, one NS request and one outbox.
  const valid=signed(build("np-test-A","evt_poc_paid_A"));
  const results=await Promise.all(Array.from({length:16},()=>processOne(valid)));
  assert.equal(results.filter(x=>x==="paid").length,1);
  assert.equal(results.filter(x=>x==="duplicate_event").length,15);
  assert.equal(await count("np_poc_sdk_inbox"),1);
  assert.equal(await count("np_poc_sdk_intake"),1);
  assert.equal(await count("np_poc_sdk_outbox"),1);
  console.log("PASS: 16 verified Stripe SDK signed callbacks -> 1 paid, 1 NS intake, 1 outbox");
  // Another provider event for the same paid order cannot create duplicate work.
  assert.equal(await processOne(signed(build("np-test-A","evt_poc_paid_again"))),"already_paid");
  assert.equal(await count("np_poc_sdk_outbox"),1);
  // Both cryptographic signature mismatch and cryptographically valid cross-seller attempts fail.
  const wrongAcct=build("np-test-A","evt_cross_seller");
  wrongAcct.account="acct_PocSellerB";
  await assert.rejects(processOne(signed(wrongAcct)),/SELLER_OR_CHARGE_MISMATCH/);
  const wrongAmt=build("np-test-A","evt_wrong_amount",{amount_total:5});
  await assert.rejects(processOne(signed(wrongAmt)),/SELLER_OR_CHARGE_MISMATCH/);
  await assert.rejects(processOne({...valid,rawBody:valid.rawBody.replace("3200","3500")}),/signature|Signature/);
  assert.equal(await count("np_poc_sdk_inbox"),2);
  assert.equal(await count("np_poc_sdk_intake"),1);
  assert.equal(await count("np_poc_sdk_outbox"),1);
  console.log("PASS: mismatched account/amount and forged Stripe signature reject and roll back");
  console.log("PASS: verified different eventID for same paid order is idempotent");
 }finally{
   for(const t of tables){try{await pool.query("DROP TABLE IF EXISTS "+t)}catch{}}
   await pool.end();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
