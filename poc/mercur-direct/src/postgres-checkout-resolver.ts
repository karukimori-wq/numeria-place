// PoC B3-03: server-side checkout resolver reading REAL PostgreSQL.
// NO client-provided seller/account/fee values are used. NOT production wiring.
import type {Pool, PoolClient} from "pg";
import type {VerifiedCheckout} from "./numeria-direct-payment-provider";

type DB = Pick<Pool, "query"> | Pick<PoolClient, "query">;
const safeInt = (v: unknown) => {
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : NaN;
};
export function makePostgresCheckoutResolver(db: DB) {
  return async (sessionId: string, operation: "initiate" | "existing" = "existing"): Promise<VerifiedCheckout> => {
    if (typeof sessionId !== "string" || !/^ps_[A-Za-z0-9_-]{3,128}$/.test(sessionId))
      throw new Error("NP_SESSION_INVALID");
    const q = await db.query(`
      SELECT ps.session_id, ps.expires_at, o.order_id, o.seller_id,
        o.account_id, o.amount_minor, o.fee_minor, o.currency, o.state,
        s.status AS seller_status, s.kyc_status,
        ca.charges_enabled, ca.account_status,
        l.status AS listing_status
      FROM np_poc_b3_payment_sessions ps
      JOIN np_poc_b3_orders o ON o.order_id = ps.order_id
      JOIN np_poc_b3_sellers s ON s.seller_id = o.seller_id
      JOIN np_poc_b3_connect_accounts ca
        ON ca.seller_id = o.seller_id AND ca.account_id = o.account_id
      JOIN np_poc_b3_listings l
        ON l.listing_id = o.listing_id AND l.seller_id = o.seller_id
      WHERE ps.session_id = $1
    `, [sessionId]);
    if (q.rowCount !== 1) throw new Error("NP_SESSION_NOT_FOUND");
    const r = q.rows[0];
    if (operation === "initiate" && (r.seller_status !== "active" ||
        r.kyc_status !== "verified" || r.charges_enabled !== true ||
        r.account_status !== "active" || r.listing_status !== "published"))
      throw new Error("NP_SELLER_NOT_ELIGIBLE");
    if (!["pending","paid"].includes(r.state)) throw new Error("NP_ORDER_NOT_ELIGIBLE");
    if (operation === "initiate" && (!(r.expires_at instanceof Date) ||
        r.expires_at.getTime() <= Date.now()))
      throw new Error("NP_SESSION_EXPIRED");
    const amount = safeInt(r.amount_minor), fee = safeInt(r.fee_minor);
    if (!(amount > 0) || !(fee >= 0 && fee <= amount) || r.currency !== "jpy")
      throw new Error("NP_ORDER_AMOUNT_INVALID");
    return {
      sessionId: r.session_id, orderId: r.order_id,
      sellerId: r.seller_id, accountId: r.account_id,
      amount, fee, currency: "jpy", orderState: r.state
    };
  };
}
