// B3-03: durable PostgreSQL binding for Stripe PaymentIntent, after Stripe create.
// Must be combined with Stripe idempotency key; not an atomic distributed transaction.
// A crash after Stripe creation but before DB commit requires retry/reconciliation.
import type {Pool, PoolClient} from "pg";
import type {PaymentIntentBinding, PaymentIntentRegistry} from "./numeria-direct-payment-provider";
type DB = Pick<Pool, "query"> | Pick<PoolClient, "query">;
const valid = (b: PaymentIntentBinding) =>
  /^ps_[A-Za-z0-9_-]{3,128}$/.test(b.sessionId) &&
  /^pi_[A-Za-z0-9]+$/.test(b.intentId) &&
  /^acct_[A-Za-z0-9]+$/.test(b.accountId) &&
  b.orderId.length>0 && b.sellerId.length>0 &&
  Number.isSafeInteger(b.amount) && b.amount>0 && b.currency==="jpy";
const matches=(r:any,b:PaymentIntentBinding)=>
  r.session_id===b.sessionId && r.intent_id===b.intentId &&
  r.order_id===b.orderId && r.seller_id===b.sellerId &&
  r.account_id===b.accountId && Number(r.amount_minor)===b.amount &&
  r.currency===b.currency;
export function makePostgresPaymentIntentRegistry(db: DB): PaymentIntentRegistry {
  return {
    async bind(b) {
      if (!valid(b)) throw new Error("NP_INTENT_BINDING_INVALID");
      // Atomic INSERT checks current eligibility and snapshot consistency.
      // ON CONFLICT session_id -> read existing and accept only exact same binding.
      await db.query(`
        INSERT INTO np_poc_b3_payment_intents
          (session_id,intent_id,order_id,seller_id,account_id,amount_minor,currency)
        SELECT ps.session_id,$2,o.order_id,o.seller_id,o.account_id,o.amount_minor,o.currency
        FROM np_poc_b3_payment_sessions ps
        JOIN np_poc_b3_orders o ON o.order_id=ps.order_id
        JOIN np_poc_b3_sellers s ON s.seller_id=o.seller_id
        JOIN np_poc_b3_connect_accounts ca
          ON ca.seller_id=o.seller_id AND ca.account_id=o.account_id
        JOIN np_poc_b3_listings l
          ON l.listing_id=o.listing_id AND l.seller_id=o.seller_id
        WHERE ps.session_id=$1 AND o.order_id=$3 AND o.seller_id=$4
          AND o.account_id=$5 AND o.amount_minor=$6 AND o.currency=$7
          AND o.state='pending' AND ps.expires_at>now()
          AND s.status='active' AND s.kyc_status='verified'
          AND ca.charges_enabled=true AND ca.account_status='active'
          AND l.status='published'
        ON CONFLICT(session_id) DO NOTHING
      `,[b.sessionId,b.intentId,b.orderId,b.sellerId,b.accountId,b.amount,b.currency]);
      await this.verify(b);
    },
    async verify(b) {
      if (!valid(b)) throw new Error("NP_INTENT_BINDING_INVALID");
      const r=await db.query(`
        SELECT session_id,intent_id,order_id,seller_id,account_id,amount_minor,currency
        FROM np_poc_b3_payment_intents WHERE session_id=$1
      `,[b.sessionId]);
      if (r.rowCount!==1 || !matches(r.rows[0],b))
        throw new Error("NP_INTENT_BINDING_MISMATCH");
    }
  };
}
