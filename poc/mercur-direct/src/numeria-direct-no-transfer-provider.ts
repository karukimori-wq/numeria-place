// PoC 00-B2: Mercur IPayoutProvider-compatible prototype.
// This is a fail-closed financial safeguard for a future seller-owned
// Direct Charges checkout. No real Checkout/charge is created here.
// IMPORTANT: Not registered into Mercur medusa-config or production.
import Stripe from "stripe";
import type {
  IPayoutProvider, PayoutAccountStatus,
  CreatePayoutAccountInput, CreatePayoutAccountResponse,
  CreateOnboardingInput, CreateOnboardingResponse,
  CreatePayoutInput, CreatePayoutResponse,
  PayoutWebhookActionInput, PayoutWebhookResult
} from "@mercurjs/types";

type StripeClient = Pick<Stripe, "accounts" | "accountLinks" | "webhooks">;

type Config = {
  apiKey?: string;
  webhookSecret: string;
  // Only for isolated tests; production must inject secrets via environment.
  testStripeClient?: StripeClient;
};

export class NumeriaDirectNoTransferProvider implements IPayoutProvider {
  static identifier = "numeria-direct-no-transfer";
  private stripe: StripeClient;
  private secret: string;

  constructor(_cradle: Record<string, unknown>, config: Config) {
    if (!config.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET_REQUIRED");
    if (!config.apiKey && !config.testStripeClient) throw new Error("STRIPE_KEY_REQUIRED");
    this.stripe = config.testStripeClient ?? new Stripe(config.apiKey!);
    this.secret = config.webhookSecret;
  }

  async createPayoutAccount(input: CreatePayoutAccountInput): Promise<CreatePayoutAccountResponse> {
    // Account onboarding stays possible. Charge type/account type must be
    // approved for Japanese seller-of-record before this is deployable.
    const country = input.data?.country;
    const accountID = input.data?.account_id;
    if (typeof country !== "string" || !/^[A-Z]{2}$/i.test(country)) throw new Error("COUNTRY_INVALID");
    if (typeof accountID !== "string" || !accountID) throw new Error("ACCOUNT_MAPPING_REQUIRED");

    const acct = await this.stripe.accounts.create({
      type: "express", country: country.toUpperCase(),
      metadata: {account_id:accountID}
    },{idempotencyKey:input.context?.idempotency_key});
    return {id:acct.id,status:"pending" as PayoutAccountStatus,
      data:{id:acct.id,charges_enabled:acct.charges_enabled,payouts_enabled:acct.payouts_enabled}};
  }

  async createOnboarding(input: CreateOnboardingInput): Promise<CreateOnboardingResponse> {
    const id = input.data?.id;
    const refresh = input.data?.refresh_url;
    const ret = input.data?.return_url;
    if (typeof id !== "string" || !/^acct_[a-zA-Z0-9]+$/.test(id)) throw new Error("CONNECT_ACCOUNT_REQUIRED");
    if (typeof refresh !== "string" || !refresh.startsWith("https://")) throw new Error("REFRESH_URL_INVALID");
    if (typeof ret !== "string" || !ret.startsWith("https://")) throw new Error("RETURN_URL_INVALID");
    const link=await this.stripe.accountLinks.create({account:id,type:"account_onboarding",refresh_url:refresh,return_url:ret});
    return {data:{url:link.url,expires_at:link.expires_at}};
  }

  async createPayout(_input: CreatePayoutInput): Promise<CreatePayoutResponse> {
    // An NP Direct charge credited the connected account itself. Calling the
    // Mercur seller Transfer pipeline a second time is dangerous.
    // Intentionally FAIL, do NOT mark a fictional Mercur payout as PAID.
    // A separate, source-of-truth-aware read-only settlement reconciliation
    // is required before adopting this provider.
    throw new Error("NP_DIRECT_CHARGE_MERCUR_TRANSFER_FORBIDDEN");
  }

  async getWebhookActionAndData(payload: PayoutWebhookActionInput): Promise<PayoutWebhookResult> {
    const signature = payload.headers["stripe-signature"];
    if (typeof signature !== "string") throw new Error("STRIPE_SIGNATURE_REQUIRED");
    const event = await this.stripe.webhooks.constructEventAsync(
      payload.rawData as Buffer | string,
      signature,
      this.secret
    );
    if (event.type !== "account.updated") return {action:"not_supported"};
    const acct=event.data.object as Stripe.Account;
    const accountID=acct.metadata?.account_id;
    if (!accountID) return {action:"not_supported"};
    if (acct.requirements?.disabled_reason?.startsWith("rejected.")) {
      return {action:"account.rejected",data:{id:accountID}};
    }
    if (acct.charges_enabled && acct.payouts_enabled &&
        !acct.requirements?.currently_due?.length &&
        !acct.requirements?.past_due?.length) {
      return {action:"account.activated",data:{id:accountID}};
    }
    return {action:"account.restricted",data:{id:accountID}};
  }
}
