// B3-04a PoC: PostgreSQL reservation BEFORE Stripe creation.
// Not wired into Mercur runtime. Stripe calls are mocked in CI.
import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import type {VerifiedCheckout,PaymentIntentBinding} from "./numeria-direct-payment-provider";

export type CheckoutLease =
  | {kind:"create"; leaseToken:string; idempotencyKey:string}
  | {kind:"existing"; intentId:string};
export interface CheckoutAttemptCoordinator {
  acquire(t:VerifiedCheckout):Promise<CheckoutLease>;
  finish(t:VerifiedCheckout,leaseToken:string,intentId:string):Promise<void>;
}
const same=(r:any,t:VerifiedCheckout)=>
  r.session_id===t.sessionId && r.order_id===t.orderId &&
  r.seller_id===t.sellerId && r.account_id===t.accountId &&
  Number(r.amount_minor)===t.amount && Number(r.fee_minor)===t.fee &&
  r.currency===t.currency && r.idempotency_key===`np:direct:${t.sessionId}`;
const intentMatches=(r:any,t:VerifiedCheckout,intentId:string)=>
  r.session_id===t.sessionId && r.intent_id===intentId &&
  r.order_id===t.orderId && r.seller_id===t.sellerId &&
  r.account_id===t.accountId && Number(r.amount_minor)===t.amount &&
  r.currency===t.currency;

export function makePostgresCheckoutAttemptCoordinator(db:Pool):CheckoutAttemptCoordinator {
  return {
    async acquire(t) {
      if (t.orderState!=="pending") throw new Error("NP_ORDER_ALREADY_FINALIZED");
      // DB-side eligibility check closes the gap between resolver and reservation.
      await db.query(`
        INSERT INTO np_poc_b3_checkout_attempts
          (session_id,order_id,seller_id,account_id,amount_minor,fee_minor,
           currency,idempotency_key)
        SELECT ps.session_id,o.order_id,o.seller_id,o.account_id,o.amount_minor,
               o.fee_minor,o.currency,$2
        FROM np_poc_b3_payment_sessions ps
        JOIN np_poc_b3_orders o ON o.order_id=ps.order_id
        JOIN np_poc_b3_sellers s ON s.seller_id=o.seller_id
        JOIN np_poc_b3_connect_accounts ca
          ON ca.seller_id=o.seller_id AND ca.account_id=o.account_id
        JOIN np_poc_b3_listings l
          ON l.listing_id=o.listing_id AND l.seller_id=o.seller_id
        WHERE ps.session_id=$1 AND o.order_id=$3 AND o.seller_id=$4
          AND o.account_id=$5 AND o.amount_minor=$6 AND o.fee_minor=$7
          AND o.currency=$8 AND o.state='pending' AND ps.expires_at>now()
          AND s.status='active' AND s.kyc_status='verified'
          AND ca.charges_enabled=true AND ca.account_status='active'
          AND l.status='published'
        ON CONFLICT (session_id) DO NOTHING
      `,[t.sessionId,`np:direct:${t.sessionId}`,t.orderId,t.sellerId,
         t.accountId,t.amount,t.fee,t.currency]);
      const row=await db.query("SELECT * FROM np_poc_b3_checkout_attempts WHERE session_id=$1",[t.sessionId]);
      if (row.rowCount!==1) throw new Error("NP_CHECKOUT_RESERVATION_DENIED");
      const r=row.rows[0];
      if (!same(r,t)) throw new Error("NP_CHECKOUT_RESERVATION_MISMATCH");
      if (r.state==="bound") {
        if (typeof r.intent_id!=="string") throw new Error("NP_CHECKOUT_BINDING_MISSING");
        return {kind:"existing",intentId:r.intent_id};
      }
      if (r.state==="review") throw new Error("NP_RECONCILIATION_REQUIRED");
      // Stripe may prune idempotency keys after >=24h. NEVER auto-retry after 12h.
      // The lease prevents concurrent workers from creating at once.
      const leaseToken=randomUUID();
      const claim=await db.query(`
        UPDATE np_poc_b3_checkout_attempts
        SET lease_token=$2::uuid, lease_until=now()+interval '90 seconds'
        WHERE session_id=$1 AND state='reserved'
          AND created_at>now()-interval '12 hours'
          AND (lease_until IS NULL OR lease_until<now())
        RETURNING idempotency_key
      `,[t.sessionId,leaseToken]);
      if (claim.rowCount===1)
        return {kind:"create",leaseToken,idempotencyKey:claim.rows[0].idempotency_key};
      // Recheck: another worker might have bound while we were waiting.
      const check=await db.query("SELECT state,intent_id,created_at FROM np_poc_b3_checkout_attempts WHERE session_id=$1",[t.sessionId]);
      if (check.rows[0]?.state==="bound")
        return {kind:"existing",intentId:check.rows[0].intent_id};
      if (check.rows[0]?.state==="review") throw new Error("NP_RECONCILIATION_REQUIRED");
      if (check.rows[0]?.created_at?.getTime() <= Date.now()-12*60*60*1000) {
        await db.query(`
          UPDATE np_poc_b3_checkout_attempts SET state='review'
          WHERE session_id=$1 AND state='reserved'
            AND created_at<=now()-interval '12 hours'
        `,[t.sessionId]);
        throw new Error("NP_RECONCILIATION_REQUIRED");
      }
      throw new Error("NP_CHECKOUT_IN_PROGRESS");
    },
    async finish(t,leaseToken,intentId) {
      if (!/^[0-9a-f-]{36}$/.test(leaseToken) || !/^pi_[A-Za-z0-9]+$/.test(intentId))
        throw new Error("NP_CHECKOUT_FINISH_INVALID");
      const client=await db.connect();
      try {
        await client.query("BEGIN");
        const rows=await client.query(`
          SELECT * FROM np_poc_b3_checkout_attempts WHERE session_id=$1 FOR UPDATE
        `,[t.sessionId]);
        const r=rows.rows[0];
        if (!r || !same(r,t) || r.state!=="reserved" ||
            r.lease_token!==leaseToken ||
            r.created_at.getTime()<=Date.now()-12*60*60*1000)
          throw new Error("NP_CHECKOUT_LEASE_MISMATCH");
        // Single DB transaction: registry binding + reservation completion.
        await client.query(`
          INSERT INTO np_poc_b3_payment_intents
            (session_id,intent_id,order_id,seller_id,account_id,amount_minor,currency)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(session_id) DO NOTHING
        `,[t.sessionId,intentId,t.orderId,t.sellerId,t.accountId,t.amount,t.currency]);
        const b=await client.query(`
          SELECT * FROM np_poc_b3_payment_intents WHERE session_id=$1
        `,[t.sessionId]);
        if (b.rowCount!==1 || !intentMatches(b.rows[0],t,intentId))
          throw new Error("NP_INTENT_BINDING_MISMATCH");
        await client.query(`
          UPDATE np_poc_b3_checkout_attempts
          SET state='bound',intent_id=$2,lease_token=NULL,lease_until=NULL
          WHERE session_id=$1
        `,[t.sessionId,intentId]);
        await client.query("COMMIT");
      } catch(e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
  };
}
