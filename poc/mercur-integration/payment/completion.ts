import {installRetryQueue,runDueReconciliation} from "./reconciliation-retry";
// Offline integration app only. Replays trusted NP paid state into registered
// Mercur workflow; never takes a browser order/session/account as authority.
import {ContainerRegistrationKeys,Modules} from "@medusajs/framework/utils";
import {database,state} from "./runtime";
import {sourceSnapshot} from "./source-checkout";
import {completionDisposition} from "./completion-state";
import {reconcileBatch} from "./reconciliation-batch";
import {providerId} from "./checkout-binding";
export async function reconcilePaidOrder(orderId:string,scope:any,requireSource=false) {
  const pg=scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  // A dedicated advisory lock serializes duplicate webhooks and worker retries
  // across processes. Modules use their own connections, so do not row-lock cart.
  return pg.transaction(async(lock:any)=>{
    await lock.raw("SELECT pg_advisory_xact_lock(hashtext(?))",["np:complete:"+orderId]);
    const {rows}=await database().query(`SELECT a.*,o.state,o.amount_minor,o.currency,o.seller_id,o.account_id,pi.intent_id
      FROM np_poc_b305_checkout_authority a JOIN np_poc_b3_orders o USING(order_id)
      LEFT JOIN np_poc_b3_payment_intents pi USING(order_id)
      WHERE a.order_id=$1 AND a.snapshot_hash IS NOT NULL`,[orderId]);
    const a=rows[0];if(!a){
      // Independent legacy suites do not install the source-completion tables.
      const installed=(await lock.raw("SELECT to_regclass('public.np_poc_completion') AS relation")).rows[0].relation;
      const knownSource=installed ? await lock("np_poc_completion").where({order_id:orderId}).first() : null;
      if(requireSource||knownSource)throw Error("NP_ORPHAN_COMPLETION_MANUAL_REVIEW");
      return; // Legacy independent fixtures are not source-backed completion claims.
    }
    if(!a.intent_id)throw Error("NP_COMPLETION_INTENT_MISSING");
    if(a.state!=="paid")throw Error("NP_COMPLETION_REQUIRES_PAID");
    const evidence=await database().query(`SELECT 1 FROM np_poc_b3_webhook_inbox i
      JOIN np_poc_b3_ns_intake n USING(order_id) JOIN np_poc_b3_paid_outbox b USING(order_id)
      WHERE i.order_id=$1 AND i.event_type='payment_intent.succeeded' AND i.intent_id=$2`,[orderId,a.intent_id]);
    if(!evidence.rowCount)throw Error("NP_COMPLETION_EVIDENCE_MISSING");
    const seal=await pg("np_poc_cart_seals").where({cart_id:a.cart_id}).first();
    if(!seal || seal.snapshot_hash!==a.snapshot_hash)throw Error("NP_COMPLETION_SEAL_MISMATCH");
    const snap=seal.snapshot;
    if(snap.buyerId!==a.buyer_id||snap.sellerId!==a.seller_id||snap.accountId!==a.account_id||snap.amount!==Number(a.amount_minor)||snap.collectionId!==a.payment_collection_id)
      throw Error("NP_COMPLETION_AUTHORITY_MISMATCH");
    // Partial persisted state is already unsafe to recreate; classify before
    // contacting the provider so restart safety does not depend on transport.
    const graph=scope.resolve(ContainerRegistrationKeys.QUERY);
    const cart=await scope.resolve(Modules.CART).retrieveCart(a.cart_id);
    const priorGroups=await graph.graph({entity:"order_group",fields:["id"],filters:{cart_id:a.cart_id}});
    const priorOrders=await graph.graph({entity:"order_cart",fields:["order.id"],filters:{cart_id:a.cart_id}});
    const disposition=completionDisposition(priorGroups.data.length,priorOrders.data.length,!!cart.completed_at);
    if(disposition==="review")throw Error("NP_PARTIAL_COMPLETION_MANUAL_REVIEW");
    const payment=scope.resolve(Modules.PAYMENT);
    const session=await payment.retrievePaymentSession(a.medusa_session_id);
    if(session.provider_id!==providerId||session.payment_collection_id!==a.payment_collection_id||session.data?.id!==a.intent_id||Number(session.amount)!==snap.amount||session.currency_code!==a.currency)
      throw Error("NP_COMPLETION_SESSION_MISMATCH");
    // Use the same real DI provider as Medusa authorization: verify remote
    // state and original Connect scope before issuing any completion permit.
    const provider=payment.paymentProviderService_.retrieveProvider(providerId);
    const remote=await provider.getPaymentStatus({data:session.data});
    if(remote.status!=="captured")throw Error("NP_COMPLETION_PROVIDER_NOT_CAPTURED");
    if(!cart.completed_at){
      const current=await sourceSnapshot(a.buyer_id,a.cart_id,scope);
      if(current.hash!==a.snapshot_hash)throw Error("NP_COMPLETION_SOURCE_CHANGED");
    }
    // Durable authorization is specific to this frozen cart/hash, not an unseal.
    await pg("np_poc_completion").insert({cart_id:a.cart_id,order_id:orderId,snapshot_hash:a.snapshot_hash,state:"pending"}).onConflict("cart_id").ignore();
    const ledger=await pg("np_poc_completion").where({cart_id:a.cart_id}).first();
    if(ledger.order_id!==orderId||ledger.snapshot_hash!==a.snapshot_hash)throw Error("NP_COMPLETION_LEDGER_CONFLICT");
    if(state.failCompletion)throw Error("NP_INJECTED_BEFORE_COMPLETION");
    const engine=scope.resolve(Modules.WORKFLOW_ENGINE);
    const result=disposition==="start" ? await engine.run("complete-cart-with-split-orders",{input:{cart_id:a.cart_id}}) : {};
    if(result.errors?.length)throw Error("NP_MERCUR_COMPLETION_FAILED");
    if(state.failCompletionAck)throw Error("NP_INJECTED_AFTER_COMPLETION");
    const groups=await graph.graph({entity:"order_group",fields:["id","cart_id"],filters:{cart_id:a.cart_id}});
    const orders=await graph.graph({entity:"order_cart",fields:["order.id","order.customer_id","order.currency_code","order.total","order.items.*","order.seller.id"],filters:{cart_id:a.cart_id}});
    const o=orders.data[0]?.order;
    const completed=await scope.resolve(Modules.CART).retrieveCart(a.cart_id);
    if(groups.data.length!==1||orders.data.length!==1||!completed.completed_at||!o||o.customer_id!==a.buyer_id||o.seller?.id!==a.seller_id||o.currency_code!==a.currency||Number(o.total)!==snap.amount||o.items?.length!==1||Number(o.items[0].quantity)!==1||o.items[0].requires_shipping!==false||Number(o.items[0].unit_price)!==snap.amount)
      throw Error("NP_COMPLETION_RESULT_RECONCILE");
    await pg("np_poc_completion").where({cart_id:a.cart_id}).update({state:"completed",medusa_order_id:o.id,order_group_id:groups.data[0].id});
    return {orderId:o.id,orderGroupId:groups.data[0].id};
  });
}
// Internal worker entry: safe after NP commit / before HTTP acknowledgement crash.
// No public HTTP repair endpoint; production scheduling/backoff remains pending.
// NP projection and Medusa tables can live in different test databases. Page
// each source separately, then check paid status only in the NP database.
async function paidCompletionCandidates(scope:any,afterOrderId="") {
  const pg=scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const ledger=await pg("np_poc_completion").select("order_id").where("order_id",">",afterOrderId).orderBy("order_id").limit(100);
  const authority=await database().query(`SELECT a.order_id FROM np_poc_b305_checkout_authority a
    JOIN np_poc_b3_orders o USING(order_id) WHERE o.state='paid' AND a.order_id>$1 ORDER BY a.order_id LIMIT 100`,[afterOrderId]);
  const ids=[...new Set<string>([...ledger,...authority.rows].map(row=>row.order_id))].sort().slice(0,100);
  const {rows}=await database().query("SELECT order_id FROM np_poc_b3_orders WHERE state='paid' AND order_id=ANY($1::text[]) ORDER BY order_id",[ids]);
  return {ids:rows.map(row=>row.order_id as string),nextCursor:ids.length===100?ids[99]:null};
}
export async function reconcilePaidOrders(scope:any,afterOrderId="") {
  const page=await paidCompletionCandidates(scope,afterOrderId);
  const results=await reconcileBatch(page.ids,id=>reconcilePaidOrder(id,scope,true));
  return {results,nextCursor:page.nextCursor};
}

// Re-scan from authoritative paid records; do not use a completed cursor as a watermark.
export async function reconcileDuePaidOrders(scope:any) {
  
  const db=database();await installRetryQueue(db);
  let cursor="";
  do {
    const page=await paidCompletionCandidates(scope,cursor);
    await db.query("INSERT INTO np_poc_retry_queue(order_id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING",[page.ids]);
    cursor=page.nextCursor??"";
  }while(cursor);
  return runDueReconciliation(db,id=>reconcilePaidOrder(id,scope,true));
}
