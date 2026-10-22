// B3-05c-1: real Medusa payment-session binding in disposable integration app.
// Authority rows must be seeded by trusted server ingestion; never from browser data.
import {createHash,randomBytes} from "node:crypto";
import {AsyncLocalStorage} from "node:async_hooks";
import {database} from "./runtime";
export const providerId="pp_numeria-direct_np-direct";
const checkoutScope=new AsyncLocalStorage<{proof:string;order:string;collection:string}>();
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
export async function bindMedusaSession(input:any,sessionService:any) {
  const id=input.data?.session_id, scope=checkoutScope.getStore(), proof=scope?.proof;
  if(typeof id!=="string" || !id.startsWith("payses_") || typeof proof!=="string")
    throw Error("NP_AUTHENTICATED_CHECKOUT_REQUIRED");
  const session=await sessionService.retrieve(id);
  if(session.payment_collection_id!==scope?.collection || session.provider_id!==providerId || Number(session.amount)!==Number(input.amount) || session.currency_code!==input.currency_code)
    throw Error("NP_MEDUSA_SESSION_MISMATCH");
  const db=await database().connect();
  try {
    await db.query("BEGIN");
    const q=await db.query(`SELECT a.*,o.amount_minor,o.currency,ps.session_id AS np_session
      FROM np_poc_b305_checkout_authority a
      JOIN np_poc_b3_orders o USING(order_id)
      JOIN np_poc_b3_payment_sessions ps USING(order_id)
      WHERE a.payment_collection_id=$1 FOR UPDATE OF a`,[session.payment_collection_id]);
    const a=q.rows[0];
    if(!a || a.order_id!==scope?.order || a.proof_hash!==hash(proof) || !a.lease_until || a.lease_until.getTime()<=Date.now() ||
      Number(a.amount_minor)!==Number(session.amount) || a.currency!==session.currency_code)
      throw Error("NP_CHECKOUT_AUTHORITY_MISMATCH");
    if(a.medusa_session_id && a.medusa_session_id!==id)throw Error("NP_MEDUSA_SESSION_ALREADY_BOUND");
    await db.query("UPDATE np_poc_b305_checkout_authority SET medusa_session_id=$2 WHERE order_id=$1",[a.order_id,id]);
    await db.query("COMMIT");
    return a.np_session as string;
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
export async function startBuyerCheckout(actor:string,order:string,cartService:any,payment:any) {
  if(!actor)throw Error("NP_BUYER_REQUIRED");
  const db=database();
  const q=await db.query(`SELECT a.*,o.listing_id,o.amount_minor,o.currency,o.state
    FROM np_poc_b305_checkout_authority a JOIN np_poc_b3_orders o USING(order_id)
    WHERE a.order_id=$1 AND a.buyer_id=$2`,[order,actor]);
  const a=q.rows[0];if(!a)throw Error("NP_CHECKOUT_NOT_FOUND");
  const cart=await cartService.retrieveCart(a.cart_id,{relations:["items","items.tax_lines","items.adjustments","shipping_methods"]});
  const item=cart.items?.[0];
  if(cart.customer_id!==actor || cart.completed_at || cart.currency_code!==a.currency ||
      cart.items?.length!==1 || Number(item?.quantity)!==1 ||
      item?.metadata?.np_listing_id!==a.listing_id || Number(item?.unit_price)!==Number(a.amount_minor) ||
      cart.shipping_methods?.length || item?.tax_lines?.length || item?.adjustments?.length)
    throw Error("NP_CART_SNAPSHOT_MISMATCH");
  const collection=await payment.retrievePaymentCollection(a.payment_collection_id);
  if(Number(collection.amount)!==Number(a.amount_minor)||collection.currency_code!==a.currency)
    throw Error("NP_COLLECTION_AMOUNT_MISMATCH");
  if(a.medusa_session_id){
    // A broken bridge must stop for reconciliation; never create another intent.
    const s=await payment.retrievePaymentSession(a.medusa_session_id);
    if(s.provider_id!==providerId || s.payment_collection_id!==a.payment_collection_id || !s.data?.id)
      throw Error("NP_BOUND_SESSION_RECONCILIATION_REQUIRED");
    return s;
  }
  if(a.state!=="pending")throw Error("NP_ORDER_ALREADY_FINALIZED");
  const proof=randomBytes(32).toString("hex");
  const claim=await db.query(`UPDATE np_poc_b305_checkout_authority SET proof_hash=$2,lease_until=now()+interval '90 seconds'
    WHERE order_id=$1 AND medusa_session_id IS NULL AND (lease_until IS NULL OR lease_until<now()) RETURNING order_id`,[order,hash(proof)]);
  if(claim.rowCount!==1)throw Error("NP_CHECKOUT_IN_PROGRESS");
  // Medusa inserts its real payses_ row before calling our provider.
  // Errors retain the lease/mapping for reconciliation, not blind recharging.
  return checkoutScope.run({proof,order,collection:a.payment_collection_id},()=>payment.createPaymentSession(a.payment_collection_id,{
    provider_id:providerId,amount:Number(a.amount_minor),currency_code:a.currency,
    data:{},context:{}
  }));
}
