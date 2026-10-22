// B3-02 isolated prototype. NOT registered in Mercur; no live Stripe calls in CI.
// A server-side resolver MUST verify cart ownership, one seller, seller KYC,
// currency, amount, and fee against authoritative persisted NP records.
import Stripe from "stripe";
import type {
  IPaymentProvider, InitiatePaymentInput, InitiatePaymentOutput,
  UpdatePaymentInput, UpdatePaymentOutput, AuthorizePaymentInput,
  AuthorizePaymentOutput, CapturePaymentInput, CapturePaymentOutput,
  RefundPaymentInput, RefundPaymentOutput, RetrievePaymentInput,
  RetrievePaymentOutput, CancelPaymentInput, CancelPaymentOutput,
  DeletePaymentInput, DeletePaymentOutput, GetPaymentStatusInput,
  GetPaymentStatusOutput, ProviderWebhookPayload, WebhookActionResult,
} from "@medusajs/framework/types";

export type VerifiedCheckout = {
  orderId: string; sellerId: string; accountId: string;
  amount: number; fee: number; currency: "jpy"; sessionId: string;
  orderState: "pending" | "paid";
};
export type TrustedCheckoutResolver = (sessionId: string, operation?: "initiate" | "existing") => Promise<VerifiedCheckout>;
type Options = {
  apiKey?: string; webhookSecret: string;
  resolveCheckout: TrustedCheckoutResolver;
  // Mock client ONLY in isolated tests; production injects secret via environment.
  stripeClient?: Stripe;
};
const accountPattern = /^acct_[a-zA-Z0-9]+$/;
const intentPattern = /^pi_[a-zA-Z0-9]+$/;
const validAmount = (n: number) => Number.isSafeInteger(n) && n > 0;
const exposed = (p: Stripe.PaymentIntent, account: string) => ({
  id: p.id, status: p.status, currency: p.currency, amount: p.amount,
  client_secret: p.client_secret, np_connect_account: account,
  session_id: p.metadata?.session_id,
});
const status = (p: Stripe.PaymentIntent) =>
  p.status === "succeeded" ? "captured" :
  p.status === "requires_capture" ? "authorized" :
  p.status === "canceled" ? "canceled" :
  p.status === "processing" ? "pending" : "requires_more";

export class NumeriaDirectPaymentProvider implements IPaymentProvider {
  static identifier = "numeria-direct";
  private stripe: Stripe;
  private options: Options;
  constructor(_cradle: Record<string, unknown>, options: Options) {
    if (!options.webhookSecret || typeof options.resolveCheckout !== "function")
      throw new Error("NP_DIRECT_CONFIG_INCOMPLETE");
    if (!options.apiKey && !options.stripeClient) throw new Error("NP_DIRECT_KEY_REQUIRED");
    this.options = options;
    this.stripe = options.stripeClient ?? new Stripe(options.apiKey!);
  }
  getIdentifier() { return NumeriaDirectPaymentProvider.identifier; }

  private async trusted(sessionId: string, amount?: unknown, currency?: unknown,
    operation: "initiate" | "existing" = "existing") {
    if (typeof sessionId !== "string" || !sessionId) throw new Error("NP_SESSION_REQUIRED");
    const t = await this.options.resolveCheckout(sessionId, operation);
    if (!t || t.sessionId !== sessionId || !accountPattern.test(t.accountId) ||
        !t.orderId || !t.sellerId || t.currency !== "jpy" ||
        !["pending","paid"].includes(t.orderState) ||
        !validAmount(t.amount) || !Number.isSafeInteger(t.fee) ||
        t.fee < 0 || t.fee > t.amount) throw new Error("NP_UNTRUSTED_CHECKOUT");
    if (operation === "initiate" && t.orderState !== "pending")
      throw new Error("NP_ORDER_ALREADY_FINALIZED");
    if (amount !== undefined && Number(amount) !== t.amount) throw new Error("NP_AMOUNT_MISMATCH");
    if (currency !== undefined && currency !== t.currency) throw new Error("NP_CURRENCY_MISMATCH");
    return t;
  }
  private async retrieve(data?: Record<string, unknown>) {
    const id = data?.id, account = data?.np_connect_account, sessionId = data?.session_id;
    if (typeof id !== "string" || !intentPattern.test(id) ||
        typeof account !== "string" || !accountPattern.test(account) ||
        typeof sessionId !== "string") throw new Error("NP_PAYMENT_REFERENCE_INVALID");
    const t = await this.trusted(sessionId);
    if (t.accountId !== account) throw new Error("NP_CONNECT_ACCOUNT_MISMATCH");
    const intent = await this.stripe.paymentIntents.retrieve(id, {stripeAccount: t.accountId});
    if (intent.metadata?.session_id !== t.sessionId ||
        intent.metadata?.np_order_id !== t.orderId ||
        intent.metadata?.np_seller_id !== t.sellerId ||
        intent.amount !== t.amount || intent.currency !== t.currency)
      throw new Error("NP_PAYMENT_INTENT_MISMATCH");
    return {intent, t};
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    // Session ID must be issued by Medusa, not copied from untrusted client data.
    const sessionId = input.data?.session_id;
    const t = await this.trusted(sessionId as string, input.amount, input.currency_code, "initiate");
    const p = await this.stripe.paymentIntents.create({
      amount: t.amount, currency: t.currency,
      application_fee_amount: t.fee,
      automatic_payment_methods: {enabled: true},
      metadata: {session_id: t.sessionId, np_order_id: t.orderId, np_seller_id: t.sellerId},
    }, {stripeAccount: t.accountId, idempotencyKey: `np:direct:${t.sessionId}`});
    return {id: p.id, status: status(p), data: exposed(p,t.accountId)};
  }
  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const {intent,t} = await this.retrieve(input.data);
    if (Number(input.amount) !== t.amount || input.currency_code !== t.currency)
      throw new Error("NP_PAYMENT_UPDATE_REQUIRES_NEW_SESSION");
    return {status: status(intent),data: exposed(intent,t.accountId)};
  }
  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const {intent,t}=await this.retrieve(input.data);
    return {status: status(intent),data: exposed(intent,t.accountId)};
  }
  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    return this.authorizePayment(input);
  }
  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const {intent,t}=await this.retrieve(input.data);
    if (intent.status === "succeeded") return {data: exposed(intent,t.accountId)};
    if (intent.status !== "requires_capture") throw new Error("NP_CAPTURE_STATE_INVALID");
    const p=await this.stripe.paymentIntents.capture(intent.id,{},{
      stripeAccount:t.accountId,idempotencyKey:input.context?.idempotency_key ?? `np:capture:${intent.id}`
    });
    return {data: exposed(p,t.accountId)};
  }
  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const {intent,t}=await this.retrieve(input.data);
    const amount=Number(input.amount);
    if (intent.status !== "succeeded" || !validAmount(amount) || amount>t.amount)
      throw new Error("NP_REFUND_INVALID");
    // Fee refund behavior is subject to verified Connect account contract.
    const refund=await this.stripe.refunds.create({
      payment_intent:intent.id,amount,refund_application_fee:true
    },{stripeAccount:t.accountId,idempotencyKey:input.context?.idempotency_key ??
      `np:refund:${intent.id}:${amount}`});
    return {data:{...exposed(intent,t.accountId),refund_id:refund.id}};
  }
  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const {intent,t}=await this.retrieve(input.data);return {data:exposed(intent,t.accountId)};
  }
  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const {intent,t}=await this.retrieve(input.data);
    if (intent.status==="canceled") return {data:exposed(intent,t.accountId)};
    if (intent.status==="succeeded") throw new Error("NP_CANCEL_CAPTURED_REQUIRES_REFUND");
    const p=await this.stripe.paymentIntents.cancel(intent.id,{},{
      stripeAccount:t.accountId,idempotencyKey:input.context?.idempotency_key ?? `np:cancel:${intent.id}`
    });
    return {data:exposed(p,t.accountId)};
  }
  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return this.cancelPayment(input);
  }
  async getWebhookActionAndData(payload: ProviderWebhookPayload): Promise<WebhookActionResult> {
    const signature=payload.payload?.headers?.["stripe-signature"];
    if (typeof signature!=="string") throw new Error("NP_WEBHOOK_SIGNATURE_REQUIRED");
    const event=await this.stripe.webhooks.constructEventAsync(
      payload.payload.rawData as string|Buffer,signature,this.options.webhookSecret
    );
    if (!event.type.startsWith("payment_intent.")) return {action:"not_supported"};
    const p=event.data.object as Stripe.PaymentIntent;
    const sid=p.metadata?.session_id;
    if (!sid || !event.account) throw new Error("NP_WEBHOOK_ACCOUNT_OR_SESSION_MISSING");
    const t=await this.trusted(sid);
    if (event.account!==t.accountId || p.metadata?.np_order_id!==t.orderId ||
        p.metadata?.np_seller_id!==t.sellerId || p.amount!==t.amount ||
        p.currency!==t.currency) throw new Error("NP_WEBHOOK_ORDER_MISMATCH");
    const action=event.type==="payment_intent.succeeded"?"captured":
      event.type==="payment_intent.amount_capturable_updated"?"authorized":
      event.type==="payment_intent.payment_failed"?"failed":"not_supported";
    if (action==="not_supported") return {action};
    return {action,data:{session_id:sid,amount:t.amount}};
  }
}
