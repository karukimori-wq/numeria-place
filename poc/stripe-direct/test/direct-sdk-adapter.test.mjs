import test from "node:test";
import assert from "node:assert/strict";
import {createDirectStripeAdapter} from "../src/direct-sdk-adapter.mjs";

const order = {
  orderId:"np_order_one",sellerId:"seller_A",stripeAccountId:"acct_ABC123",
  amountMinor:4500,currency:"JPY",paymentMode:"PREPAY",readingState:"accepted",
  paymentState:"unpaid",paymentIntentId:null,refundedMinor:0,paymentSessionId:null,
};
const seller={sellerId:"seller_A",stripeAccountId:"acct_ABC123",chargesEnabled:true};
function harness() {
  const calls={checkout:[],refund:[],webhook:[]};
  const stripe={
    checkout:{sessions:{create:async(params,opts)=>{calls.checkout.push([params,opts]);return{id:"cs_test_one"};}}},
    refunds:{create:async(params,opts)=>{calls.refund.push([params,opts]);return{id:"re_test_one"};}},
    webhooks:{constructEvent:(raw,signature,secret)=>{
      calls.webhook.push({signature,secret});
      if(signature!=="sdk-mock-verified")throw new Error("MOCK_SIGNATURE_REJECT");
      return JSON.parse(raw);
    }},
  };
  const adapter=createDirectStripeAdapter({stripe,webhookSecret:"whsec_testonly"});
  return {calls,adapter};
}

const urls={successUrl:"https://test.example/success",cancelUrl:"https://test.example/cancel"};

test("seller Connect acct routed through SDK request options, never browser",async()=>{
  const {adapter,calls}=harness();
  await adapter.createCheckout({order,seller,approvedFeeMinor:225,retryId:"order_one_checkout1",...urls,
    stripeAccountId:"acct_ATTEMPTED_SWAP"});
  assert.equal(calls.checkout[0][1].stripeAccount,seller.stripeAccountId);
  assert.equal(calls.checkout[0][1].idempotencyKey,"order_one_checkout1");
  assert.equal(calls.checkout[0][0].payment_intent_data.application_fee_amount,225);
  assert.equal(calls.checkout[0][0].line_items[0].price_data.unit_amount,4500);
  assert.equal(calls.checkout[0][0].client_reference_id,order.orderId);
  assert.equal(JSON.stringify(calls).includes("acct_ATTEMPTED_SWAP"),false);
});

test("cross-tenant seller mismatch, account mismatch and disabled charges fail closed",async()=>{
  const {adapter,calls}=harness();
  const base={order,seller,approvedFeeMinor:0,retryId:"order_one_checkout1",...urls};
  await assert.rejects(adapter.createCheckout({...base,seller:{...seller,sellerId:"seller_B"}}),/SELLER_OWNERSHIP_MISMATCH/);
  await assert.rejects(adapter.createCheckout({...base,seller:{...seller,stripeAccountId:"acct_OTHER"}}),/ORDER_ACCOUNT_MISMATCH/);
  await assert.rejects(adapter.createCheckout({...base,seller:{...seller,chargesEnabled:false}}),/CHARGES_DISABLED/);
  assert.equal(calls.checkout.length,0);
});

test("unapproved fee, insecure URLs and invalid amount cannot create a payment",async()=>{
  const {adapter,calls}=harness();
  const args={order,seller,approvedFeeMinor:0,retryId:"order_one_checkout1",...urls};
  await assert.rejects(adapter.createCheckout({...args,approvedFeeMinor:999999}),/FEE_EXCEEDS_CHARGE/);
  await assert.rejects(adapter.createCheckout({...args,approvedFeeMinor:-1}),/FEE_INVALID/);
  await assert.rejects(adapter.createCheckout({...args,successUrl:"javascript:alert(1)"}),/INVALID_SUCCESS_URL/);
  await assert.rejects(adapter.createCheckout({...args,order:{...order,amountMinor:1.5}}),/ORDER_AMOUNT_INVALID/);
  assert.equal(calls.checkout.length,0);
});

test("FULL_POSTPAY needs finalized report; uses a new seller checkout (not old authorization)",async()=>{
  const {adapter,calls}=harness();
  const args={order:{...order,paymentMode:"FULL_POSTPAY"},seller,
    approvedFeeMinor:0,retryId:"order_one_postpay_checkout",...urls};
  await assert.rejects(adapter.createCheckout(args),/POSTPAY_REPORT_NOT_READY/);
  await adapter.createCheckout({...args,order:{...args.order,readingState:"finalized"}});
  assert.equal(calls.checkout.length,1);
  assert.equal(calls.checkout[0][0].mode,"payment");
  assert.equal(calls.checkout[0][1].stripeAccount,"acct_ABC123");
});

test("seller refund, application fee policy and idempotency are in connected acct",async()=>{
  const {adapter,calls}=harness();
  const args={order:{...order,paymentState:"paid",paymentIntentId:"pi_test_payment"},
    seller,amountMinor:1500,approvedRefundApplicationFee:true,refundRequestId:"order_one_refund1"};
  await adapter.createRefund(args);
  assert.equal(calls.refund.length,1);
  assert.deepEqual(calls.refund[0][0],{
    payment_intent:"pi_test_payment",amount:1500,refund_application_fee:true,
    metadata:{np_order_id:order.orderId},
  });
  assert.deepEqual(calls.refund[0][1],{stripeAccount:"acct_ABC123",idempotencyKey:"order_one_refund1"});
});

test("refund is denied without exact settlement, seller ownership or signed fee decision",async()=>{
  const {adapter,calls}=harness();
  const x={order:{...order,paymentState:"paid",paymentIntentId:"pi_test"},seller,
    amountMinor:100,approvedRefundApplicationFee:false,refundRequestId:"refund_valid_123"};
  await assert.rejects(adapter.createRefund({...x,order:{...x.order,paymentState:"unpaid"}}),/PAYMENT_NOT_REFUNDABLE/);
  await assert.rejects(adapter.createRefund({...x,amountMinor:9000}),/REFUND_AMOUNT_INVALID/);
  await assert.rejects(adapter.createRefund({...x,seller:{...seller,sellerId:"seller_B"}}),/SELLER_OWNERSHIP_MISMATCH/);
  await assert.rejects(adapter.createRefund({...x,approvedRefundApplicationFee:undefined}),/REFUND_FEE_POLICY_REQUIRED/);
  assert.equal(calls.refund.length,0);
});

function event(overrides={}) {return {
  id:"evt_one",type:"checkout.session.completed",account:"acct_ABC123",
  data:{object:{
    id:"cs_test_one",client_reference_id:order.orderId,
    amount_total:4500,currency:"jpy",payment_status:"paid",
    payment_intent:"pi_valid",metadata:{np_order_id:order.orderId,np_seller_id:order.sellerId},
  }},
  ...overrides,
};}
const lookupOrder = id => id===order.orderId ? {...order,paymentSessionId:"cs_test_one"} : null;

test("verified SDK webhook derives minimal payment marker after trusted order mapping",()=>{
  const {adapter,calls}=harness();
  const data=adapter.parsePaidWebhook({rawBody:JSON.stringify(event()),signature:"sdk-mock-verified",lookupOrder});
  assert.deepEqual(data,{eventId:"evt_one",orderId:order.orderId,paymentIntentId:"pi_valid",
    connectedAccountId:"acct_ABC123",paidMinor:4500,currency:"JPY"});
  assert.equal(calls.webhook[0].secret,"whsec_testonly");
  assert.equal(JSON.stringify(data).includes("birth"),false);
});

test("SDK-rejected signature / wrong Connect account / wrong amounts never marks paid",()=>{
  const {adapter}=harness();
  const params={signature:"sdk-mock-verified",lookupOrder};
  assert.throws(()=>adapter.parsePaidWebhook({...params,rawBody:JSON.stringify(event()),signature:"bad"}),/MOCK_SIGNATURE_REJECT/);
  assert.throws(()=>adapter.parsePaidWebhook({...params,rawBody:JSON.stringify(event({account:"acct_OTHER"}))}),/EVENT_ACCOUNT_MISMATCH/);
  const e=event();e.data.object.amount_total=1;
  assert.throws(()=>adapter.parsePaidWebhook({...params,rawBody:JSON.stringify(e)}),/EVENT_AMOUNT_MISMATCH/);
  const e2=event();e2.data.object.payment_status="unpaid";
  assert.throws(()=>adapter.parsePaidWebhook({...params,rawBody:JSON.stringify(e2)}),/NOT_PAID/);
});

test("stale/forged order, session, metadata or unsupported events rejected",()=>{
  const {adapter}=harness();const args={signature:"sdk-mock-verified",lookupOrder};
  for (const obj of [
    { ...event(),type:"checkout.session.expired" },
    event({account:"acct_OTHER"}),
  ])assert.throws(()=>adapter.parsePaidWebhook({...args,rawBody:JSON.stringify(obj)}));
  let e=event();e.data.object.metadata.np_seller_id="seller_B";
  assert.throws(()=>adapter.parsePaidWebhook({...args,rawBody:JSON.stringify(e)}),/EVENT_ORDER_MISMATCH/);
  e=event();e.data.object.id="cs_other";
  assert.throws(()=>adapter.parsePaidWebhook({...args,rawBody:JSON.stringify(e)}),/EVENT_SESSION_MISMATCH/);
});

test("real Stripe SDK still not executed: harness uses only injected fake",()=>{
  const {calls}=harness();
  assert.equal(calls.checkout.length+calls.refund.length+calls.webhook.length,0);
});
