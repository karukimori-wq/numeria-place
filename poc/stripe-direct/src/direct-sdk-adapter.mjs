// PoC-only Stripe SDK seam. When a genuine Stripe SDK is injected, these are
// actual API-shaped methods. CI uses a fake; there is NO Stripe API key here.
// NEVER publish as production adapter without durable ledger, real Connect KYC,
// entitlement validation, webhook inbox/outbox, and approved seller agreement.

const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const sellerAccount = ({order, seller}) => {
  ensure(order && seller && order.sellerId === seller.sellerId, "SELLER_OWNERSHIP_MISMATCH");
  ensure(typeof seller.stripeAccountId === "string" && /^acct_[A-Za-z0-9]+$/.test(seller.stripeAccountId), "ACCOUNT_INVALID");
  ensure(order.stripeAccountId === seller.stripeAccountId, "ORDER_ACCOUNT_MISMATCH");
  return seller.stripeAccountId;
};
const validAmount = x => Number.isSafeInteger(x) && x > 0;
const idempotency = x => {
  ensure(typeof x === "string" && /^[A-Za-z0-9:_-]{8,200}$/.test(x), "IDEMPOTENCY_INVALID");
  return x;
};

export function createDirectStripeAdapter({stripe, webhookSecret}) {
  ensure(typeof stripe?.checkout?.sessions?.create === "function", "STRIPE_CHECKOUT_MISSING");
  ensure(typeof stripe?.refunds?.create === "function", "STRIPE_REFUNDS_MISSING");
  ensure(typeof stripe?.webhooks?.constructEvent === "function", "STRIPE_WEBHOOK_MISSING");
  ensure(typeof webhookSecret === "string" && webhookSecret.length > 0, "WEBHOOK_SECRET_MISSING");

  function validateOrder(order, seller) {
    const account = sellerAccount({order,seller});
    ensure(validAmount(order.amountMinor), "ORDER_AMOUNT_INVALID");
    ensure(typeof order.currency === "string" && /^[A-Z]{3}$/.test(order.currency), "ORDER_CURRENCY_INVALID");
    ensure(typeof order.orderId === "string" && order.orderId.length > 0, "ORDER_ID_INVALID");
    return account;
  }

  return {
    async createCheckout({order, seller, approvedFeeMinor, successUrl, cancelUrl, retryId}) {
      const stripeAccount = validateOrder(order,seller);
      ensure(seller.chargesEnabled === true, "CHARGES_DISABLED");
      ensure(validAmount(approvedFeeMinor) || approvedFeeMinor === 0, "FEE_INVALID");
      ensure(approvedFeeMinor <= order.amountMinor, "FEE_EXCEEDS_CHARGE");
      ensure(typeof successUrl === "string" && successUrl.startsWith("https://"), "INVALID_SUCCESS_URL");
      ensure(typeof cancelUrl === "string" && cancelUrl.startsWith("https://"), "INVALID_CANCEL_URL");
      ensure(order.paymentState !== "paid" && order.paymentState !== "refunded" && order.paymentState !== "disputed", "ORDER_ALREADY_SETTLED");
      if (order.paymentMode !== "PREPAY") {
        ensure(order.readingState === "finalized", "POSTPAY_REPORT_NOT_READY");
      }
      // Seller stripeAccount resolved via trusted record, NEVER from buyer payload.
      const params = {
        mode:"payment",client_reference_id:order.orderId,
        line_items:[{price_data:{currency:order.currency.toLowerCase(),unit_amount:order.amountMinor,
          product_data:{name:"Numeria Place POC reading"}},quantity:1}],
        payment_intent_data:{application_fee_amount:approvedFeeMinor,
          metadata:{np_order_id:order.orderId,np_seller_id:order.sellerId}},
        metadata:{np_order_id:order.orderId,np_seller_id:order.sellerId},
        success_url:successUrl,cancel_url:cancelUrl,
      };
      return stripe.checkout.sessions.create(params,{
        stripeAccount,idempotencyKey:idempotency(retryId),
      });
    },
    async createRefund({order,seller,amountMinor,approvedRefundApplicationFee,refundRequestId}) {
      const stripeAccount=validateOrder(order,seller);
      ensure(order.paymentState === "paid" && typeof order.paymentIntentId === "string" &&
        order.paymentIntentId.startsWith("pi_"), "PAYMENT_NOT_REFUNDABLE");
      ensure(validAmount(amountMinor) && amountMinor <= order.amountMinor - (order.refundedMinor??0),
        "REFUND_AMOUNT_INVALID");
      ensure(typeof approvedRefundApplicationFee === "boolean","REFUND_FEE_POLICY_REQUIRED");
      // This is a direct account refund, *not* platform refund + transfer reversal.
      return stripe.refunds.create({
        payment_intent:order.paymentIntentId,
        amount:amountMinor,
        refund_application_fee:approvedRefundApplicationFee,
        metadata:{np_order_id:order.orderId},
      },{stripeAccount,idempotencyKey:idempotency(refundRequestId)});
    },
    parsePaidWebhook({rawBody,signature,lookupOrder}) {
      ensure(typeof rawBody === "string" || Buffer.isBuffer(rawBody), "RAW_BODY_REQUIRED");
      ensure(typeof signature === "string","SIGNATURE_REQUIRED");
      ensure(typeof lookupOrder === "function","ORDER_LOOKUP_REQUIRED");
      // Only SDK constructEvent validates the provider signature.
      const event=stripe.webhooks.constructEvent(rawBody,signature,webhookSecret);
      ensure(["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type),
        "NOT_PAYMENT_SUCCESS_EVENT");
      ensure(typeof event.id === "string" && event.id.length > 0, "EVENT_ID_INVALID");
      const session=event.data?.object;
      const order=lookupOrder(session?.client_reference_id);
      ensure(!!order,"ORDER_NOT_FOUND");
      ensure(event.account === order.stripeAccountId,"EVENT_ACCOUNT_MISMATCH");
      ensure(session?.metadata?.np_order_id === order.orderId &&
        session?.metadata?.np_seller_id === order.sellerId,"EVENT_ORDER_MISMATCH");
      ensure(session?.payment_status === "paid","NOT_PAID");
      ensure(session.amount_total === order.amountMinor &&
        session.currency?.toUpperCase() === order.currency,"EVENT_AMOUNT_MISMATCH");
      ensure(session.id === order.paymentSessionId,"EVENT_SESSION_MISMATCH");
      ensure(typeof session.payment_intent === "string" && session.payment_intent.startsWith("pi_"),
        "PAYMENT_INTENT_INVALID");
      // Only return minimal state for separate persistent Inbox, not PII.
      return {eventId:event.id,orderId:order.orderId,paymentIntentId:session.payment_intent,
        connectedAccountId:order.stripeAccountId,paidMinor:order.amountMinor,currency:order.currency};
    },
  };
}
