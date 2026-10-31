import test from "node:test";
import assert from "node:assert/strict";
import { DirectChargesPoC, PAYMENT, signedFixture, verifyStripeSignedBody } from "../src/commerce.mjs";

const SECRET = "whsec_synthetic_fixture_only";
const CLOCK = 1_792_467_000;
function fixture() {
  const calls = [];
  const stripe = { checkout: { sessions: { async create(params, options) {
    calls.push({ params, options });
    return { id: "cs_test_" + calls.length };
  } } } };
  const sellers = [
    { sellerId: "seller_A", stripeAccountId: "acct_TEST_A", chargesEnabled: true, businessEnabled: true, applicationFeeMinor: 0 },
    { sellerId: "seller_B", stripeAccountId: "acct_TEST_B", chargesEnabled: true, businessEnabled: false, applicationFeeMinor: 0 },
    { sellerId: "seller_C", stripeAccountId: "acct_TEST_C", chargesEnabled: false, businessEnabled: true, applicationFeeMinor: 0 },
  ];
  const listings = [
    { listingId: "list_A", sellerId: "seller_A", published: true, priceMinor: 2400, currency: "JPY",
      allowedModes: Object.values(PAYMENT), lpEnabled: true, businessLinkAuthorized: true, postpayOptIn: true,
      fulfillment: "NS_BUSINESS" },
    { listingId: "list_B", sellerId: "seller_B", published: true, priceMinor: 1200, currency: "JPY",
      allowedModes: Object.values(PAYMENT), lpEnabled: false, businessLinkAuthorized: false, postpayOptIn: true,
      fulfillment: "NP_MANUAL" },
    { listingId: "list_C", sellerId: "seller_C", published: true, priceMinor: 2500, currency: "JPY",
      allowedModes: [PAYMENT.PREPAY], lpEnabled: false, businessLinkAuthorized: true, postpayOptIn: false,
      fulfillment: "NS_BUSINESS" },
    { listingId: "list_BAD", sellerId: "seller_B", published: true, priceMinor: 0, currency: "JPY",
      allowedModes: [PAYMENT.PREPAY], lpEnabled: false, postpayOptIn: false, fulfillment: "NP_MANUAL" },
  ];
  const p = new DirectChargesPoC({ sellers, listings, stripe, webhookSecret: SECRET, clock: () => CLOCK });
  return { p, calls };
}
function create(f, args = {}) {
  return f.p.createOrder({
    listingId: "list_A", buyerId: "buyer_X", mode: PAYMENT.PREPAY,
    salesChannel: "marketplace", ...args,
  });
}
function event(o, sessionId, overrides = {}, eventId = "evt_fixture_001", type = "checkout.session.completed") {
  return {
    id: eventId, type, account: o.stripeAccountId,
    data: { object: {
      id: sessionId, client_reference_id: o.orderId,
      metadata: { orderId: o.orderId, sellerId: o.sellerId },
      amount_total: o.amountMinor, currency: o.currency.toLowerCase(),
      payment_status: "paid", payment_intent: "pi_test_fixture_1",
      ...overrides,
    } },
  };
}
function signed(e, now = CLOCK) { return signedFixture(e, SECRET, now); }

test("D01: direct checkout uses trusted seller Connect account and fixed order price", async () => {
  const f = fixture(), o = create(f, { salesChannel: "seller_lp" });
  const session = await f.p.beginPayment({ orderId: o.orderId, buyerId: "buyer_X" });
  assert.equal(session.id, "cs_test_1");
  assert.equal(f.calls[0].options.stripeAccount, "acct_TEST_A");
  assert.equal(f.calls[0].params.line_items[0].price_data.unit_amount, 2400);
  assert.equal(f.calls[0].params.payment_intent_data.application_fee_amount, 0);
  assert.equal(f.calls[0].params.metadata.sellerId, "seller_A");
  assert.ok(!JSON.stringify(f.calls[0]).includes("birthDate"));
});

test("D02: buyer cannot pick or redirect a seller's Stripe account", async () => {
  const f = fixture(), o = create(f);
  await f.p.beginPayment({ orderId: o.orderId, buyerId: "buyer_X", stripeAccountId: "acct_TEST_B" });
  assert.equal(f.calls[0].options.stripeAccount, "acct_TEST_A");
  const forged = event(o, "cs_test_1");
  forged.account = "acct_TEST_B";
  assert.throws(() => f.p.acceptWebhook(signed(forged)), /CONNECTED_ACCOUNT_MISMATCH/);
});

test("D03: repeat checkout and duplicate signed webhook are idempotent", async () => {
  const f = fixture(), o = create(f);
  await f.p.beginPayment({ orderId: o.orderId, buyerId: "buyer_X" });
  const again = await f.p.beginPayment({ orderId: o.orderId, buyerId: "buyer_X" });
  assert.equal(again.reused, true);
  assert.equal(f.calls.length, 1);
  const signedPaid = signed(event(o, "cs_test_1"));
  assert.equal(f.p.acceptWebhook(signedPaid).paymentState, "paid");
  assert.equal(f.p.acceptWebhook(signedPaid).deduplicated, true);
  assert.equal(f.p.orderSnapshot(o.orderId, "buyer_X").paymentState, "paid");
});

test("D04: wrong order, session, amount, currency or payment state cannot confirm paid", async () => {
  const f = fixture(), o = create(f); await f.p.beginPayment({ orderId: o.orderId, buyerId: "buyer_X" });
  assert.throws(() => f.p.acceptWebhook(signed(event(o, "cs_injected"))), /ORDER_SESSION_MISMATCH/);
  assert.throws(() => f.p.acceptWebhook(signed(event(o, "cs_test_1", { amount_total: 1 }))), /AMOUNT_MISMATCH/);
  assert.throws(() => f.p.acceptWebhook(signed(event(o, "cs_test_1", { currency: "usd" }))), /AMOUNT_MISMATCH/);
  assert.throws(() => f.p.acceptWebhook(signed(event(o, "cs_test_1", { payment_status: "unpaid" }))), /STRIPE_NOT_PAID/);
  assert.throws(() => f.p.acceptWebhook(signed(event(o, "cs_test_1", { metadata: { orderId: "wrong", sellerId: "seller_A" } }))), /ORDER_SESSION_MISMATCH/);
});

test("D05: signed expired session returns to unpaid; retry creates new scoped Checkout", async () => {
  const f = fixture(), o = create(f);
  await f.p.beginPayment({ orderId:o.orderId, buyerId:"buyer_X" });
  const expired=event(o,"cs_test_1",{}, "evt_expired","checkout.session.expired");
  f.p.acceptWebhook(signed(expired));
  assert.equal(f.p.orderSnapshot(o.orderId,"buyer_X").paymentState,"unpaid");
  await f.p.beginPayment({ orderId:o.orderId, buyerId:"buyer_X" });
  assert.equal(f.calls.length,2);
  assert.equal(f.calls[1].options.stripeAccount,"acct_TEST_A");
  assert.notEqual(f.calls[1].options.idempotencyKey,f.calls[0].options.idempotencyKey);
});

test("D06: no double disbursement via Mercur transfer after Direct charge", () => {
  assert.throws(() => fixture().p.makeTransfer(),/DIRECT_CHARGE_FORBIDS_SELLER_TRANSFER/);
});

test("D08: NP-only seller can accept requests with no Business plan", () => {
  const f=fixture(), o=create(f,{listingId:"list_B",mode:PAYMENT.FULL_POSTPAY});
  assert.equal(o.businessAuthorizedAtIntake,false);
  f.p.startReading({orderId:o.orderId,sellerId:"seller_B"});
  f.p.finalizeReport({orderId:o.orderId,sellerId:"seller_B",reportRef:"rep_np_test"});
  assert.equal(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}).fullText,true);
});

test("D08: Business listing requires valid NS link and LP contract", () => {
  const f=fixture();
  assert.throws(()=>create(f,{listingId:"list_B",salesChannel:"seller_lp"}),/LP_NOT_AVAILABLE/);
  f.p.listings.get("list_A").businessLinkAuthorized=false;
  assert.throws(()=>create(f),/NO_BUSINESS_LINK/);
});

test("D09: FULL_POSTPAY yields private full text but never unpaid PDF", () => {
  const f=fixture(),o=create(f,{mode:PAYMENT.FULL_POSTPAY});
  f.p.startReading({orderId:o.orderId,sellerId:"seller_A"});
  f.p.finalizeReport({orderId:o.orderId,sellerId:"seller_A",reportRef:"rep_poc_A"});
  const rights=f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"});
  assert.deepEqual(rights,{fullText:true,partialPreview:true,pdf:false});
  assert.throws(()=>f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_Y"}),/ACCESS_DENIED/);
});

test("D09: PREVIEW_POSTPAY only enables partial content before payment", () => {
  const f=fixture(),o=create(f,{mode:PAYMENT.PREVIEW_POSTPAY});
  f.p.startReading({orderId:o.orderId,sellerId:"seller_A"});
  f.p.finalizeReport({orderId:o.orderId,sellerId:"seller_A",reportRef:"rep_partial"});
  assert.deepEqual(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}),
    {fullText:false,partialPreview:true,pdf:false});
});

test("D10: postpay opens fresh checkout only after finalized; paid webhook enables PDF", async () => {
  const f=fixture(),o=create(f,{mode:PAYMENT.FULL_POSTPAY});
  await assert.rejects(f.p.beginPayment({orderId:o.orderId,buyerId:"buyer_X"}),/POSTPAY_NOT_READY/);
  f.p.startReading({orderId:o.orderId,sellerId:"seller_A"});
  f.p.finalizeReport({orderId:o.orderId,sellerId:"seller_A",reportRef:"rep_A"});
  const s=await f.p.beginPayment({orderId:o.orderId,buyerId:"buyer_X"});
  assert.equal(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}).pdf,false);
  f.p.acceptWebhook(signed(event(o,s.id)));
  assert.equal(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}).pdf,true);
  assert.equal(f.calls.length,1);
});

test("D11: nonpayment cannot fabricate a paid state", async () => {
  const f=fixture(),o=create(f,{mode:PAYMENT.FULL_POSTPAY});
  f.p.startReading({orderId:o.orderId,sellerId:"seller_A"});
  f.p.finalizeReport({orderId:o.orderId,sellerId:"seller_A",reportRef:"rep_A"});
  const session=await f.p.beginPayment({orderId:o.orderId,buyerId:"buyer_X"});
  assert.equal(session.reused,false);
  assert.equal(f.p.orderSnapshot(o.orderId,"buyer_X").paymentState,"pending");
  assert.equal(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}).pdf,false);
});

test("D12: seller B cannot finish seller A's reading and buyer Y cannot inspect it", () => {
  const f=fixture(),o=create(f,{mode:PAYMENT.FULL_POSTPAY});
  assert.throws(()=>f.p.startReading({orderId:o.orderId,sellerId:"seller_B"}),/ACCESS_DENIED/);
  assert.throws(()=>f.p.orderSnapshot(o.orderId,"buyer_Y"),/ACCESS_DENIED/);
  assert.throws(()=>f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_Y"}),/ACCESS_DENIED/);
});

test("D13: Business expiry after acceptance does not orphan existing accepted order", () => {
  const f=fixture(),o=create(f,{mode:PAYMENT.FULL_POSTPAY});
  f.p.sellers.get("seller_A").businessEnabled=false;
  f.p.startReading({orderId:o.orderId,sellerId:"seller_A"});
  f.p.finalizeReport({orderId:o.orderId,sellerId:"seller_A",reportRef:"rep_A"});
  assert.equal(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}).fullText,true);
  assert.throws(()=>create(f),/NO_BUSINESS_LINK|LP_NOT_AVAILABLE/);
});

test("D14: webhook signature/timestamp are verified on raw body", async () => {
  const f=fixture(),o=create(f);await f.p.beginPayment({orderId:o.orderId,buyerId:"buyer_X"});
  const fixtureEvent=signed(event(o,"cs_test_1"));
  assert.equal(verifyStripeSignedBody({...fixtureEvent,secret:SECRET,nowSeconds:CLOCK}).id,"evt_fixture_001");
  assert.throws(()=>f.p.acceptWebhook({...fixtureEvent,rawBody:fixtureEvent.rawBody+"x"}),/WEBHOOK_SIGNATURE/);
  assert.throws(()=>f.p.acceptWebhook(signed(event(o,"cs_test_1"),CLOCK-900)),/WEBHOOK_TIMESTAMP/);
});

test("refund simulation revokes future PDF and content access",async()=>{
  const f=fixture(),o=create(f);
  const s=await f.p.beginPayment({orderId:o.orderId,buyerId:"buyer_X"});
  f.p.acceptWebhook(signed(event(o,s.id)));
  f.p.startReading({orderId:o.orderId,sellerId:"seller_A"});
  f.p.finalizeReport({orderId:o.orderId,sellerId:"seller_A",reportRef:"rep_A"});
  assert.equal(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}).pdf,true);
  f.p.recordFullRefund({orderId:o.orderId,sellerId:"seller_A"});
  assert.equal(f.p.readEntitlement({orderId:o.orderId,buyerId:"buyer_X"}).pdf,false);
});

test("disabled charge eligibility and invalid/listing prices fail closed", async () => {
  const f=fixture(),o=create(f,{listingId:"list_C"});
  await assert.rejects(f.p.beginPayment({orderId:o.orderId,buyerId:"buyer_X"}),/SELLER_CHARGES_DISABLED/);
  assert.throws(()=>create(f,{listingId:"list_BAD"}),/INVALID_LISTING_PRICE/);
});

test("prepay never starts reading while unpaid", () => {
  const f=fixture(),o=create(f);
  assert.throws(()=>f.p.startReading({orderId:o.orderId,sellerId:"seller_A"}),/PAYMENT_REQUIRED/);
});
