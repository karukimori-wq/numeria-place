import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Static source-compatibility check; DOES NOT start Mercur or exercise Stripe.
const path = process.argv[2];
if (!path) throw new Error("Pass checked-out pinned Mercur path");
const targets = [
  ["packages/core/src/workflows/cart/workflows/complete-cart-with-split-orders.ts",
    ["completeCartWithSplitOrdersWorkflow", "splitCapturedCartPaymentWorkflow"]],
  ["packages/core/src/workflows/payment/workflows/process-payment.ts",
    ["processPaymentWorkflow", "completeCartWithSplitOrdersWorkflow"]],
  ["packages/core/src/workflows/payment/workflows/split-order-payments.ts",
    ["splitCapturedCartPaymentWorkflow", "PaymentEvents.CAPTURED"]],
  ["packages/providers/payout-stripe-connect/src/services/stripe-connect.ts",
    ["transfers.create", "createPayout"]],
  ["packages/core/src/api/vendor/payments/[id]/refund/route.ts",
    ["refundPaymentWorkflow", "validateSellerPayment"]],
  ["packages/core/src/api/hooks/payment/[provider]/route.ts",
    ["PaymentWebhookEvents.WEBHOOK_RECEIVED"]],
];
for (const [relative, tokens] of targets) {
  const source = await readFile(join(path, relative), "utf8");
  for (const token of tokens) assert.ok(source.includes(token), relative + ": missing " + token);
  console.log("BASELINE VERIFIED:", relative);
}
console.log("STATIC MERCUR SOURCE CHECK PASS. Not a runtime integration result.");
