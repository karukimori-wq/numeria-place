import { createHmac, timingSafeEqual } from "node:crypto";

// IN-MEMORY POC ONLY. No live Stripe SDK, persistence or real authentication.
// Inject Stripe SDK-compatible mock checkout.sessions.create for tests.
export const PAYMENT = Object.freeze({
  PREPAY: "PREPAY", PREVIEW_POSTPAY: "PREVIEW_POSTPAY", FULL_POSTPAY: "FULL_POSTPAY",
});
const MODES = new Set(Object.values(PAYMENT));
const CHANNELS = new Set(["marketplace", "seller_lp"]);
const privateError = () => { throw new Error("ACCESS_DENIED"); };
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
function clone(v) { return structuredClone(v); }

export function verifyStripeSignedBody({ rawBody, signature, secret, nowSeconds }) {
  ensure(typeof rawBody === "string" && typeof signature === "string" && !!secret, "INVALID_WEBHOOK_INPUT");
  const pairs = Object.fromEntries(signature.split(",").map(s => s.trim().split("=", 2)));
  const t = Number(pairs.t);
  ensure(Number.isSafeInteger(t) && Math.abs(nowSeconds - t) <= 300, "WEBHOOK_TIMESTAMP");
  const expected = createHmac("sha256", secret).update(t + "." + rawBody).digest("hex");
  const signatureHex = pairs.v1 ?? "";
  ensure(/^[a-f0-9]{64}$/i.test(signatureHex), "WEBHOOK_SIGNATURE");
  ensure(timingSafeEqual(Buffer.from(signatureHex, "hex"), Buffer.from(expected, "hex")), "WEBHOOK_SIGNATURE");
  return JSON.parse(rawBody);
}

export function signedFixture(event, secret, timestamp) {
  const rawBody = JSON.stringify(event);
  const v1 = createHmac("sha256", secret).update(timestamp + "." + rawBody).digest("hex");
  return { rawBody, signature: "t=" + timestamp + ",v1=" + v1 };
}

export class DirectChargesPoC {
  constructor({ sellers, listings, stripe, webhookSecret, clock = () => Math.floor(Date.now() / 1000) }) {
    ensure(stripe?.checkout?.sessions?.create, "MOCK_STRIPE_REQUIRED");
    this.sellers = new Map(sellers.map(s => [s.sellerId, clone(s)]));
    this.listings = new Map(listings.map(l => [l.listingId, clone(l)]));
    this.stripe = stripe;
    this.webhookSecret = webhookSecret;
    this.clock = clock;
    this.orders = new Map();
    this.events = new Set();
    this.nextId = 1;
  }
  createOrder({ listingId, buyerId, mode, salesChannel }) {
    ensure(typeof buyerId === "string" && buyerId.length > 0, "BUYER_REQUIRED");
    ensure(MODES.has(mode) && CHANNELS.has(salesChannel), "INVALID_SALES_TERMS");
    const listing = this.listings.get(listingId);
    ensure(listing?.published && listing.allowedModes?.includes(mode), "LISTING_UNAVAILABLE");
    const seller = this.sellers.get(listing.sellerId);
    ensure(!!seller, "UNKNOWN_SELLER");
    ensure(Number.isSafeInteger(listing.priceMinor) && listing.priceMinor > 0 &&
      /^[A-Z]{3}$/.test(listing.currency), "INVALID_LISTING_PRICE");
    if (salesChannel === "seller_lp") {
      ensure(listing.lpEnabled && seller.businessEnabled, "LP_NOT_AVAILABLE");
    }
    const orderId = "np_poc_" + this.nextId++;
    const o = {
      orderId, listingId, sellerId: seller.sellerId, buyerId, mode, salesChannel,
      amountMinor: listing.priceMinor, currency: listing.currency,
      stripeAccountId: seller.stripeAccountId, fulfillment: listing.fulfillment,
      businessAuthorizedAtIntake: seller.businessEnabled && listing.businessLinkAuthorized === true,
      sellerPostpayOptIn: listing.postpayOptIn === true,
      paymentState: "unpaid", readingState: "accepted", reportRef: null,
      paymentSessionId: null, paymentIntentId: null, attempt: 0,
      refundedMinor: 0, settledMinor: 0,
    };
    if (o.fulfillment === "NS_BUSINESS" && !o.businessAuthorizedAtIntake) {
      throw new Error("NO_BUSINESS_LINK");
    }
    if (mode !== "PREPAY" && !o.sellerPostpayOptIn) throw new Error("POSTPAY_NOT_AUTHORIZED");
    ensure(typeof o.stripeAccountId === "string" && o.stripeAccountId.startsWith("acct_"), "SELLER_ACCOUNT_MISSING");
    this.orders.set(orderId, o);
    return clone(o);
  }
  getOrder(orderId) { const o = this.orders.get(orderId); ensure(o, "UNKNOWN_ORDER"); return o; }
  orderSnapshot(orderId, requestingBuyerId) {
    const o = this.getOrder(orderId);
    if (o.buyerId !== requestingBuyerId) privateError();
    return clone(o);
  }
  async beginPayment({ orderId, buyerId }) {
    const o = this.getOrder(orderId);
    if (o.buyerId !== buyerId) privateError();
    ensure(o.paymentState !== "paid" && o.paymentState !== "refunded", "PAYMENT_ALREADY_SETTLED");
    ensure(o.readingState !== "canceled", "ORDER_CANCELED");
    const seller = this.sellers.get(o.sellerId);
    ensure(seller?.chargesEnabled, "SELLER_CHARGES_DISABLED");
    if (o.mode !== "PREPAY") ensure(o.readingState === "finalized", "POSTPAY_NOT_READY");
    if (o.paymentSessionId) return { id: o.paymentSessionId, reused: true };
    const idempotencyKey = "np:" + o.orderId + ":payment:" + o.attempt;
    const appFee = seller.applicationFeeMinor ?? 0; // demo amount only; not a rate or production policy
    ensure(Number.isSafeInteger(appFee) && appFee >= 0 && appFee <= o.amountMinor, "INVALID_FEE");
    // Direct charge account is ALWAYS resolved from the trusted server-side seller map.
    const session = await this.stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: o.orderId,
      line_items: [{ price_data: { currency: o.currency.toLowerCase(),
        unit_amount: o.amountMinor, product_data: { name: "POC reading" } }, quantity: 1 }],
      payment_intent_data: { application_fee_amount: appFee,
        metadata: { orderId: o.orderId, sellerId: o.sellerId } },
      metadata: { orderId: o.orderId, sellerId: o.sellerId },
      success_url: "https://example.invalid/poc/success",
      cancel_url: "https://example.invalid/poc/cancel",
    }, { stripeAccount: o.stripeAccountId, idempotencyKey });
    ensure(typeof session?.id === "string" && session.id.startsWith("cs_"), "INVALID_CHECKOUT_RESPONSE");
    o.paymentSessionId = session.id;
    o.paymentState = "pending";
    return { id: session.id, reused: false }; // no hosted URL exposed by this POC
  }
  acceptWebhook({ rawBody, signature }) {
    const event = verifyStripeSignedBody({
      rawBody, signature, secret: this.webhookSecret, nowSeconds: this.clock(),
    });
    ensure(typeof event.id === "string" && event.id.length > 0, "INVALID_EVENT_ID");
    if (this.events.has(event.id)) return { deduplicated: true };
    // In production, durable inbox records and a transaction lock are required.
    const session = event.data?.object;
    const orderId = session?.client_reference_id;
    const o = this.getOrder(orderId);
    ensure(event.account === o.stripeAccountId, "CONNECTED_ACCOUNT_MISMATCH");
    ensure(session?.metadata?.orderId === o.orderId &&
      session.metadata.sellerId === o.sellerId &&
      session.id === o.paymentSessionId, "ORDER_SESSION_MISMATCH");
    if (event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded") {
      ensure(session.payment_status === "paid", "STRIPE_NOT_PAID");
      ensure(session.amount_total === o.amountMinor &&
        String(session.currency).toUpperCase() === o.currency, "AMOUNT_MISMATCH");
      ensure(typeof session.payment_intent === "string", "NO_PAYMENT_INTENT");
      ensure(o.paymentState !== "refunded" && o.paymentState !== "disputed", "REVERSED_ORDER");
      if (o.paymentState !== "paid") {
        o.paymentState = "paid";
        o.paymentIntentId = session.payment_intent;
        o.settledMinor = o.amountMinor;
      }
    } else if (event.type === "checkout.session.expired") {
      if (o.paymentState === "pending") {
        o.paymentState = "unpaid"; o.paymentSessionId = null; o.attempt++;
      }
    } else throw new Error("UNSUPPORTED_EVENT");
    this.events.add(event.id);
    return { deduplicated: false, paymentState: o.paymentState };
  }
  startReading({ orderId, sellerId }) {
    const o = this.getOrder(orderId);
    if (o.sellerId !== sellerId) privateError();
    ensure(o.readingState === "accepted", "INVALID_READING_STATE");
    ensure(o.paymentState !== "refunded" && o.paymentState !== "disputed", "ORDER_BLOCKED");
    if (o.mode === "PREPAY") ensure(o.paymentState === "paid", "PAYMENT_REQUIRED");
    if (o.fulfillment === "NS_BUSINESS") ensure(o.businessAuthorizedAtIntake, "BUSINESS_NOT_AUTHORIZED");
    o.readingState = "in_progress";
  }
  finalizeReport({ orderId, sellerId, reportRef }) {
    const o = this.getOrder(orderId);
    if (o.sellerId !== sellerId) privateError();
    ensure(o.readingState === "in_progress", "INVALID_READING_STATE");
    ensure(typeof reportRef === "string" && reportRef.startsWith("rep_"), "INVALID_REPORT");
    o.reportRef = reportRef; o.readingState = "finalized";
  }
  readEntitlement({ orderId, buyerId }) {
    const o = this.getOrder(orderId);
    if (o.buyerId !== buyerId) privateError();
    const reportReady = o.readingState === "finalized" && !!o.reportRef;
    const paid = o.paymentState === "paid";
    const noReversal = o.paymentState !== "refunded" && o.paymentState !== "disputed";
    return {
      fullText: reportReady && noReversal && (paid || o.mode === "FULL_POSTPAY"),
      partialPreview: reportReady && noReversal && (paid ||
        o.mode === "FULL_POSTPAY" || o.mode === "PREVIEW_POSTPAY"),
      pdf: reportReady && noReversal && paid,
    };
  }
  recordFullRefund({ orderId, sellerId }) {
    // Simulation of a VERIFIED connected-account refund (not a live Stripe call).
    const o = this.getOrder(orderId);
    if (o.sellerId !== sellerId) privateError();
    ensure(o.paymentState === "paid", "NOT_PAID");
    o.paymentState = "refunded"; o.refundedMinor = o.amountMinor;
    // App fee refund requires a separate approved Stripe operation in the real adapter.
  }
  makeTransfer() {
    throw new Error("DIRECT_CHARGE_FORBIDS_SELLER_TRANSFER");
  }
}
