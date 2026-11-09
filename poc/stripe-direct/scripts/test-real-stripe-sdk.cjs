// Offline verification with REAL pinned stripe-node SDK (v23.0.0).
// No API request: Checkouts and refunds are injected stubs; SDK webhooks are real.
// Assumes NODE_PATH points to the ephemeral CI installation of stripe.
const assert = require("node:assert/strict");
const Stripe = require("stripe");
(async () => {
  const { createDirectStripeAdapter } = await import("../src/direct-sdk-adapter.mjs");
  const realStripe = new Stripe("sk_test_local_fixture_not_a_secret");
  const calls = [];
  const sdkShape = {
    checkout: { sessions: { create: async (p, opts) => {
      calls.push({ kind: "checkout", params: p, options: opts });
      return { id: "cs_test_local_fixture" };
    }}},
    refunds: { create: async(p, opts) => {
      calls.push({kind:"refund",params:p,options:opts});
      return {id:"re_test_local_fixture"};
    }},
    // Real Stripe SDK signature verification; no network.
    webhooks: realStripe.webhooks,
  };
  const adapter = createDirectStripeAdapter({stripe:sdkShape,webhookSecret:"whsec_local_fixture"});
  const order = {
    orderId:"order_local_fixture",sellerId:"seller_A",stripeAccountId:"acct_ExampleA",
    paymentState:"unpaid",paymentMode:"PREPAY",readingState:"accepted",
    amountMinor:2400,currency:"JPY",paymentSessionId:"cs_test_local_fixture"
  };
  const seller={sellerId:"seller_A",stripeAccountId:"acct_ExampleA",chargesEnabled:true};
  await adapter.createCheckout({order,seller,approvedFeeMinor:0,
    retryId:"order_local_fixture_1",successUrl:"https://example.test/success",
    cancelUrl:"https://example.test/cancel"});
  assert.equal(calls[0].options.stripeAccount,"acct_ExampleA");
  const evt = {
    id:"evt_local_fixture",object:"event",type:"checkout.session.completed",account:"acct_ExampleA",
    data:{object:{id:order.paymentSessionId,object:"checkout.session",client_reference_id:order.orderId,
      metadata:{np_order_id:order.orderId,np_seller_id:order.sellerId},
      payment_status:"paid",amount_total:2400,currency:"jpy",payment_intent:"pi_local_fixture"}}
  };
  const payload=JSON.stringify(evt),secret="whsec_local_fixture";
  const header=realStripe.webhooks.generateTestHeaderString({payload,secret});
  const parsed=adapter.parsePaidWebhook({rawBody:payload,signature:header,lookupOrder:id=>
    id===order.orderId?order:null});
  assert.equal(parsed.connectedAccountId,order.stripeAccountId);
  assert.equal(parsed.paidMinor,2400);
  assert.throws(()=>adapter.parsePaidWebhook({
    rawBody:payload.replace('"paid"','"unpaid"'),signature:header,lookupOrder:()=>order
  }),/signature|Signature|No signatures/i);
  assert.throws(()=>adapter.parsePaidWebhook({rawBody:payload,signature:"t=1,v1="+"f".repeat(64),
    lookupOrder:()=>order}),/signature|Signature|timestamp|Timestamp/i);
  const forged={...evt,account:"acct_Other"};
  const forgedPayload=JSON.stringify(forged);
  const forgedHeader=realStripe.webhooks.generateTestHeaderString({payload:forgedPayload,secret});
  assert.throws(()=>adapter.parsePaidWebhook({rawBody:forgedPayload,signature:forgedHeader,
    lookupOrder:()=>order}),/EVENT_ACCOUNT_MISMATCH/);
  console.log("PASS Stripe SDK v23 real local signature verification + seller account scope");
  console.log("PASS No Stripe network calls; Direct SDK API is still only a mocked transport.");
})().catch(e=>{console.error(e);process.exitCode=1});
