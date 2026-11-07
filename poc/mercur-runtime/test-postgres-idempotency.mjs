// PoC 00-B ledger test against a REAL temporary PostgreSQL instance.
// Test-data only: no Stripe calls, no Mercur runtime, no persistent account.
import assert from "node:assert/strict";
import { SQL } from "bun";

const address = process.env.DATABASE_URL;
if (!address?.startsWith("postgresql://")) throw new Error("POC_DATABASE_URL_REQUIRED");
const pg = new SQL(address);

const makeTables = async () => {
  await pg`CREATE TABLE IF NOT EXISTS np_poc_orders (
    order_id text PRIMARY KEY,
    seller_id text NOT NULL,
    connected_account_id text NOT NULL,
    amount_minor integer NOT NULL CHECK (amount_minor > 0),
    currency char(3) NOT NULL,
    payment_state text NOT NULL DEFAULT 'pending' CHECK (payment_state IN ('pending','paid','refunded')),
    payment_intent_id text UNIQUE
  )`;
  await pg`CREATE TABLE IF NOT EXISTS np_poc_webhook_inbox (
    stripe_event_id text PRIMARY KEY,
    order_id text NOT NULL REFERENCES np_poc_orders(order_id),
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await pg`CREATE TABLE IF NOT EXISTS np_poc_ns_intake (
    order_id text PRIMARY KEY REFERENCES np_poc_orders(order_id),
    session_id text NOT NULL UNIQUE
  )`;
  await pg`CREATE TABLE IF NOT EXISTS np_poc_outbox (
    business_key text PRIMARY KEY,
    event_type text NOT NULL,
    order_id text NOT NULL REFERENCES np_poc_orders(order_id)
  )`;
};

async function applyVerifiedPayment({ eventId, orderId, accountId, amountMinor, intentId }) {
  return pg.begin(async tx => {
    const inserted=await tx`INSERT INTO np_poc_webhook_inbox(stripe_event_id,order_id)
      VALUES(${eventId},${orderId})
      ON CONFLICT(stripe_event_id) DO NOTHING
      RETURNING stripe_event_id`;
    if(inserted.length===0) return "duplicate_event";
    const o=await tx`SELECT * FROM np_poc_orders WHERE order_id=${orderId} FOR UPDATE`;
    if(o.length!==1 || o[0].connected_account_id!==accountId ||
      o[0].amount_minor!==amountMinor || o[0].currency!=="JPY"){
      throw new Error("SELLER_OR_PAYMENT_SCOPE_INVALID");
    }
    if(o[0].payment_state==="paid") return "already_paid";
    assert.equal(o[0].payment_state,"pending");
    await tx`UPDATE np_poc_orders SET payment_state='paid',payment_intent_id=${intentId}
      WHERE order_id=${orderId} AND payment_state='pending'`;
    await tx`INSERT INTO np_poc_ns_intake(order_id,session_id)
      VALUES(${orderId},'poc-session-1') ON CONFLICT(order_id) DO NOTHING`;
    await tx`INSERT INTO np_poc_outbox(business_key,event_type,order_id)
      VALUES(${"paid:"+orderId},'place.order.paid.v1',${orderId})
      ON CONFLICT(business_key) DO NOTHING`;
    return "paid";
  });
}

try {
  await pg`DROP TABLE IF EXISTS np_poc_outbox,np_poc_ns_intake,np_poc_webhook_inbox,np_poc_orders CASCADE`;
  await makeTables();
  await pg`INSERT INTO np_poc_orders(order_id,seller_id,connected_account_id,amount_minor,currency)
    VALUES('poc-order-1','seller-A','acctA',2800,'JPY')`;

  // Multi-worker duplication simulation: all writes exercise real PostgreSQL constraints.
  const attempts=await Promise.all(Array.from({length:16},()=>applyVerifiedPayment({
    eventId:"evt_one",orderId:"poc-order-1",accountId:"acctA",amountMinor:2800,intentId:"pi_one",
  })));
  assert.equal(attempts.filter(x=>x==="paid").length,1);
  assert.equal(attempts.filter(x=>x==="duplicate_event").length,15);

  const counts=await pg`SELECT
    (SELECT COUNT(*) FROM np_poc_webhook_inbox) AS inbox,
    (SELECT COUNT(*) FROM np_poc_ns_intake) AS intake,
    (SELECT COUNT(*) FROM np_poc_outbox) AS outbox`;
  assert.equal(Number(counts[0].inbox),1);
  assert.equal(Number(counts[0].intake),1);
  assert.equal(Number(counts[0].outbox),1);
  console.log("PASS 16 duplicate/concurrent paid callbacks -> one inbox, one NS intake, one outbox");

  const again=await applyVerifiedPayment({eventId:"evt_two",orderId:"poc-order-1",
    accountId:"acctA",amountMinor:2800,intentId:"pi_one"});
  assert.equal(again,"already_paid");
  assert.equal(Number((await pg`SELECT COUNT(*) AS n FROM np_poc_outbox`)[0].n),1);
  console.log("PASS distinct Stripe event cannot initiate duplicate paid action");

  for(const invalid of [
    {eventId:"evt_wrong_seller",orderId:"poc-order-1",accountId:"acctB",amountMinor:2800,intentId:"pi_two"},
    {eventId:"evt_wrong_amount",orderId:"poc-order-1",accountId:"acctA",amountMinor:1,intentId:"pi_three"},
  ]){
    await assert.rejects(applyVerifiedPayment(invalid),/SELLER_OR_PAYMENT_SCOPE_INVALID/);
  }
  assert.equal(Number((await pg`SELECT COUNT(*) AS n FROM np_poc_webhook_inbox`)[0].n),2);
  console.log("PASS wrong seller account/amount rolls back transactional inbox insertion");

  await assert.rejects(pg`INSERT INTO np_poc_ns_intake(order_id,session_id)
    VALUES('poc-order-1','poc-session-2')`);
  console.log("PASS real unique constraint prevents a second NS session");
} finally {
  await pg`DROP TABLE IF EXISTS np_poc_outbox,np_poc_ns_intake,np_poc_webhook_inbox,np_poc_orders CASCADE`;
  await pg.close();
}
