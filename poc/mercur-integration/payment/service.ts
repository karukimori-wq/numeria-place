// CI-only adapter: real Medusa provider registration; Stripe transport is offline.
import { AbstractPaymentProvider } from "@medusajs/framework/utils";
import { NumeriaDirectPaymentProvider } from "./core/numeria-direct-payment-provider";
import { options } from "./runtime";
import {bindMedusaSession} from "./checkout-binding";
export default class NumeriaDirectService extends AbstractPaymentProvider<{}> {
  static identifier = "numeria-direct";
  private delegate: NumeriaDirectPaymentProvider;
  private sessionService:any;
  constructor(cradle: Record<string, unknown>, config: {}) {
    super(cradle, config);
    this.delegate = new NumeriaDirectPaymentProvider(cradle, options());
    this.sessionService=cradle.paymentSessionService;
  }
  async initiatePayment(input: Parameters<NumeriaDirectPaymentProvider["initiatePayment"]>[0]) {
    const id=input.data?.session_id;
    // B3-05b fixtures still use seeded ps_ sessions directly; B3-05c HTTP
    // uses Medusa payses_ rows + server proof. This remains a test-only app.
    if(typeof id==="string" && id.startsWith("payses_")) {
      const np=await bindMedusaSession(input,this.sessionService);
      const result=await this.delegate.initiatePayment({...input,data:{session_id:np}});
      return {...result,data:{...result.data,np_medusa_session_id:id}};
    }
    return this.delegate.initiatePayment(input);
  }
  async updatePayment(input: Parameters<NumeriaDirectPaymentProvider["updatePayment"]>[0]) { return this.delegate.updatePayment(input); }
  async authorizePayment(input: Parameters<NumeriaDirectPaymentProvider["authorizePayment"]>[0]) { return this.delegate.authorizePayment(input); }
  async getPaymentStatus(input: Parameters<NumeriaDirectPaymentProvider["getPaymentStatus"]>[0]) { return this.delegate.getPaymentStatus(input); }
  async capturePayment(input: Parameters<NumeriaDirectPaymentProvider["capturePayment"]>[0]) { return this.delegate.capturePayment(input); }
  async refundPayment(input: Parameters<NumeriaDirectPaymentProvider["refundPayment"]>[0]) { return this.delegate.refundPayment(input); }
  async retrievePayment(input: Parameters<NumeriaDirectPaymentProvider["retrievePayment"]>[0]) { return this.delegate.retrievePayment(input); }
  async cancelPayment(input: Parameters<NumeriaDirectPaymentProvider["cancelPayment"]>[0]) { return this.delegate.cancelPayment(input); }
  async deletePayment(input: Parameters<NumeriaDirectPaymentProvider["deletePayment"]>[0]) { return this.delegate.deletePayment(input); }
  // The dedicated synchronous HTTP endpoint owns Inbox/Outbox processing.
  // Never allow the legacy async subscriber to complete the same payment.
  async getWebhookActionAndData(): Promise<{action: "not_supported"}> {
    return {action: "not_supported"};
  }
}
