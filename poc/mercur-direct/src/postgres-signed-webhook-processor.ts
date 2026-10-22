// PoC B3-04b. Real Stripe SDK local signature verification + real PostgreSQL
// transaction; synthetic events ONLY. NOT wired into Mercur's webhook route.
// Do not acknowledge upstream delivery until transaction COMMIT succeeds.
import {createHash} from "node:crypto";
import Stripe from "stripe";
import type {Pool} from "pg";

type Result="paid"|"already_paid"|"duplicate_event"|"nonterminal"|"not_supported";
type Config={db:Pool; stripe:Stripe; webhookSecret:string;
  // Fault injection ONLY for isolated test: throws inside DB transaction.
  beforeCommit?:()=>Promise<void>};
const safe=(s:unknown,re:RegExp)=>typeof s==="string"&&re.test(s);
const ident=/^[a-zA-Z0-9_-]{3,128}$/;
const account=/^acct_[a-zA-Z0-9]+$/;
const intent=/^pi_[a-zA-Z0-9]+$/;
const types=new Set([
  "payment_intent.succeeded","payment_intent.payment_failed",
  "payment_intent.amount_capturable_updated","payment_intent.canceled"
]);

export function makeSignedPaymentIntentWebhookProcessor(cfg:Config) {
  if(!cfg.webhookSecret) throw new Error("NP_WEBHOOK_SECRET_REQUIRED");
  return async (rawBody:string|Buffer,signature:string):Promise<Result>=>{
    if(typeof signature!=="string"||!signature)
      throw new Error("NP_WEBHOOK_SIGNATURE_REQUIRED");
    // Stripe SDK verifies raw body BEFORE any database access.
    const event=await cfg.stripe.webhooks.constructEventAsync(
      rawBody,signature,cfg.webhookSecret);
    if(!types.has(event.type))return "not_supported";
    const p=event.data.object as Stripe.PaymentIntent;
    const sid=p.metadata?.session_id;
    const oid=p.metadata?.np_order_id;
    const seller=p.metadata?.np_seller_id;
    if(!safe(event.id,ident)||!safe(event.account,account)||
       !safe(p.id,intent)||!safe(sid,/^ps_[a-zA-Z0-9_-]{3,128}$/)||
       !safe(oid,ident)||!safe(seller,ident)||
       !Number.isSafeInteger(p.amount)||p.amount<=0||p.currency!=="jpy")
      throw new Error("NP_WEBHOOK_INVALID_PAYLOAD");
    const hash=createHash("sha256").update(rawBody).digest("hex");
    const db=await cfg.db.connect();
    try{
      await db.query("BEGIN");
      // Lock order FIRST: competing events for the same order serialize.
      const order=await db.query(`
        SELECT o.*,ps.session_id,ps.expires_at,
               pi.intent_id,pi.account_id AS pi_account,
               pi.seller_id AS pi_seller,pi.order_id AS pi_order,
               pi.amount_minor AS pi_amount,pi.currency AS pi_currency,
               ca.state AS attempt_state,ca.intent_id AS attempt_intent
        FROM np_poc_b3_orders o
        JOIN np_poc_b3_payment_sessions ps ON ps.order_id=o.order_id
        JOIN np_poc_b3_payment_intents pi ON pi.session_id=ps.session_id
        JOIN np_poc_b3_checkout_attempts ca ON ca.session_id=ps.session_id
        WHERE o.order_id=$1
        FOR UPDATE OF o
      `,[oid]);
      if(order.rowCount!==1)throw new Error("NP_WEBHOOK_UNKNOWN_BOUND_ORDER");
      const r=order.rows[0];
      if(r.session_id!==sid||r.seller_id!==seller||
         r.account_id!==event.account||r.account_id!==r.pi_account||
         r.seller_id!==r.pi_seller||r.order_id!==r.pi_order||
         r.intent_id!==p.id||r.attempt_state!=="bound"||
         r.attempt_intent!==p.id||Number(r.amount_minor)!==p.amount||
         Number(r.pi_amount)!==p.amount||
         r.currency!==p.currency||r.pi_currency!==p.currency)
        throw new Error("NP_WEBHOOK_BINDING_MISMATCH");
      // Duplicate event IDs must have IDENTICAL signed payload; no silent
      // acceptance of a reused event ID with changed content.
      const inbox=await db.query(`
        INSERT INTO np_poc_b3_webhook_inbox
          (event_id,event_type,payload_sha256,intent_id,order_id,seller_id)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(event_id) DO NOTHING RETURNING event_id
      `,[event.id,event.type,hash,p.id,oid,seller]);
      if(inbox.rowCount===0){
        const prev=await db.query(`
          SELECT event_type,payload_sha256,intent_id,order_id,seller_id
          FROM np_poc_b3_webhook_inbox WHERE event_id=$1
        `,[event.id]);
        const x=prev.rows[0];
        if(!x||x.payload_sha256!==hash||x.event_type!==event.type||
           x.intent_id!==p.id||x.order_id!==oid||x.seller_id!==seller)
          throw new Error("NP_WEBHOOK_EVENT_ID_COLLISION");
        await db.query("COMMIT");
        return "duplicate_event";
      }
      let result:Result="nonterminal";
      if(event.type==="payment_intent.succeeded"){
        if(r.state==="pending"){
          await db.query("UPDATE np_poc_b3_orders SET state='paid' WHERE order_id=$1",[oid]);
          await db.query(`
            INSERT INTO np_poc_b3_ns_intake(order_id,seller_id,intent_id)
            VALUES($1,$2,$3) ON CONFLICT(order_id) DO NOTHING
          `,[oid,seller,p.id]);
          await db.query(`
            INSERT INTO np_poc_b3_paid_outbox(order_id,seller_id,event_type)
            VALUES($1,$2,'np.order.paid.v1') ON CONFLICT(order_id) DO NOTHING
          `,[oid,seller]);
          result="paid";
        }else if(r.state==="paid") result="already_paid";
        else throw new Error("NP_PAID_AFTER_ORDER_CANCELLED_RECONCILE");
      }
      // Failed/authorized/canceled notifications cannot regress a paid order.
      // Cancellation state is NOT inferred from Stripe webhook in this PoC.
      if(cfg.beforeCommit)await cfg.beforeCommit();
      await db.query("COMMIT");
      return result;
    }catch(e){
      await db.query("ROLLBACK");
      throw e;
    }finally{db.release();}
  };
}
