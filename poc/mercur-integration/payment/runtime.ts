// OFFLINE disposable PoC only. No production env/secrets or Stripe network.
import Stripe from "stripe";
import { Pool } from "pg";
import { makePostgresCheckoutResolver } from "./core/postgres-checkout-resolver";
import { makePostgresPaymentIntentRegistry } from "./core/postgres-payment-intent-registry";
import { makePostgresCheckoutAttemptCoordinator } from "./core/postgres-checkout-attempt-coordinator";
import { makeSignedPaymentIntentWebhookProcessor } from "./core/postgres-signed-webhook-processor";
let db: Pool;
export const secret = "whsec_B305_OFFLINE_SYNTHETIC_ONLY";
export const state = { failCommit: false, failResponse:false, failProjection:false, calls: [] as {method:string;account:string}[], intents: new Map<string, any>() };
export function database() {
  if (!db) {
    const url = process.env.NP_POC_DATABASE_URL;
    if (process.env.NODE_ENV !== "test" || !url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
      throw new Error("NP_DISPOSABLE_LOCAL_TEST_DB_REQUIRED");
    db = new Pool({connectionString:url, max:18});
  }
  return db;
}
const sdk = new Stripe("sk_test_OFFLINE_NOT_A_KEY");
function record(method:string, opts:any) {
  if (!opts?.stripeAccount) throw new Error("NP_ACCOUNT_SCOPE_REQUIRED");
  state.calls.push({method, account:opts.stripeAccount});
}
const client = {
  paymentIntents: {
    create: async (params:any, opts:any) => {
      record("create",opts);
      const p = {...params, id:"pi_"+params.metadata.session_id.replace(/[^a-zA-Z0-9]/g,""), status:"requires_capture",client_secret:"offline"};
      state.intents.set(p.id,p); return p;
    },
    retrieve: async (id:string, _params:any, opts:any) => {record("retrieve",opts); const p=state.intents.get(id); if(!p)throw new Error("UNKNOWN_OFFLINE_INTENT");return p;},
    capture: async (id:string, _params:any, opts:any) => {record("capture",opts);const p={...state.intents.get(id),status:"succeeded"};state.intents.set(id,p);return p;},
    cancel: async (id:string, _params:any, opts:any) => {record("cancel",opts);return {...state.intents.get(id),status:"canceled"};},
  },
  refunds: {create:async (_params:any,opts:any)=>{record("refund",opts);return {id:"re_offline"};}},
  webhooks: sdk.webhooks,
} as unknown as Stripe;
export function options() {
  const db=database();
  return {stripeClient:client,webhookSecret:secret,
    resolveCheckout:makePostgresCheckoutResolver(db),
    paymentIntentRegistry:makePostgresPaymentIntentRegistry(db),
    checkoutAttempts:makePostgresCheckoutAttemptCoordinator(db)};
}
export async function accept(raw:Buffer|string,signature:string) {
  return makeSignedPaymentIntentWebhookProcessor({db:database(),stripe:sdk,webhookSecret:secret,
    beforeCommit:async()=>{if(state.failCommit)throw new Error("NP_INJECTED_DB_FAILURE");}})(raw,signature);
}
export async function close() {if(db)await db.end();}
