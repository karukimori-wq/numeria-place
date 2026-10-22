// B3-05c-1: real authenticated HTTP + actual Medusa createPaymentSession.
// Authority rows are trusted fixture projections, not production ingestion.
import {medusaIntegrationTestRunner} from "@medusajs/test-utils";
import {Modules,ContainerRegistrationKeys,generateJwtToken} from "@medusajs/framework/utils";
import type {ICartModuleService,IPaymentModuleService} from "@medusajs/framework/types";

import {database,state,close} from "../../src/providers/np-direct/runtime";
import {readFileSync} from "node:fs";
import {join} from "node:path";
async function createCustomerUser(container:any,options:{email:string}) {
  const customer=await container.resolve(Modules.CUSTOMER).createCustomers({email:options.email});
  const identity=await container.resolve(Modules.AUTH).createAuthIdentities({
    provider_identities:[{provider:"emailpass",entity_id:options.email,provider_metadata:{}}],
    app_metadata:{customer_id:customer.id}
  });
  const config=container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig.http;
  const token=generateJwtToken({actor_id:customer.id,actor_type:"customer",auth_identity_id:identity.id},
    {secret:config.jwtSecret,expiresIn:"1d",jwtOptions:config.jwtOptions});
  return {customer,headers:{headers:{authorization:"Bearer "+token}}};
}
const tables="np_poc_b305_checkout_authority,np_poc_b3_paid_outbox,np_poc_b3_ns_intake,np_poc_b3_webhook_inbox,np_poc_b3_checkout_attempts,np_poc_b3_payment_intents,np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers";
jest.setTimeout(180000);
medusaIntegrationTestRunner({testSuite:({api,getContainer})=>{
  let buyer:any,other:any,cart:any,collection:any,payment:IPaymentModuleService,cartModule:ICartModuleService;
  const post=(who:any=buyer,body:any={})=>api.post("/np-checkout/orderA",body,{headers:who?.headers?.headers??{},validateStatus:()=>true});
  beforeEach(async()=>{
    const db=database();state.calls.length=0;state.intents.clear();state.failResponse=false;
    await db.query("DROP TABLE IF EXISTS "+tables+" CASCADE");
    for(const name of ["b3-checkout-schema.sql","b3-webhook-schema.sql"])
      await db.query(readFileSync(join(process.cwd(),"src/providers/np-direct/db",name),"utf8"));
    await db.query(readFileSync(join(process.cwd(),"src/providers/np-direct/checkout-binding-schema.sql"),"utf8"));
    const container=getContainer();
    buyer=await createCustomerUser(container,{email:"np-buyer@example.test"});
    other=await createCustomerUser(container,{email:"np-other@example.test"});
    cartModule=container.resolve(Modules.CART);payment=container.resolve(Modules.PAYMENT);
    cart=await cartModule.createCarts({currency_code:"jpy",customer_id:buyer.customer.id,email:"np-buyer@example.test",
      items:[{title:"Offline digital listing",quantity:1,unit_price:2800,requires_shipping:false,metadata:{np_listing_id:"listingA"}}]});
    collection=await payment.createPaymentCollections({amount:2800,currency_code:"jpy"});
    await db.query("INSERT INTO np_poc_b3_sellers VALUES('sellerA','active','verified')");
    await db.query("INSERT INTO np_poc_b3_connect_accounts VALUES('sellerA','acct_A123456',true,'active')");
    await db.query("INSERT INTO np_poc_b3_listings VALUES('listingA','sellerA','published')");
    await db.query("INSERT INTO np_poc_b3_orders VALUES('orderA','sellerA','listingA','acct_A123456',2800,280,'jpy','pending')");
    await db.query("INSERT INTO np_poc_b3_payment_sessions VALUES('ps_A123','orderA','2099-01-01')");
    await db.query("INSERT INTO np_poc_b305_checkout_authority(order_id,buyer_id,cart_id,payment_collection_id) VALUES('orderA',$1,$2,$3)",[buyer.customer.id,cart.id,collection.id]);
  });
  afterAll(async()=>{await database().query("DROP TABLE IF EXISTS "+tables+" CASCADE");await close();});
  it("rejects anonymous, forged bearer and other buyer without Stripe calls",async()=>{
    expect((await post(null)).status).toBe(401);
    expect((await api.post("/np-checkout/orderA",{},{headers:{authorization:"Bearer forged"},validateStatus:()=>true})).status).toBe(401);
    expect((await post(other)).status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
  it("rejects browser account, amount, fee or order override instead of trusting it",async()=>{
    expect((await post(buyer,{accountId:"acct_OTHER",amount:1,fee:0,orderId:"other"})).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
  it("authenticated HTTP creates real Medusa payses_ and binds trusted NP ps_ once",async()=>{
    const r=await post();expect(r.status).toBe(200);expect(r.data.payment_session_id).toMatch(/^payses_/);
    const session=await payment.retrievePaymentSession(r.data.payment_session_id);
    expect(session.payment_collection_id).toBe(collection.id);
    expect(session.data.session_id).toBe("ps_A123");
    expect(session.data.np_medusa_session_id).toBe(session.id);
    expect(session.context).toEqual({});
    const row=(await database().query("SELECT * FROM np_poc_b305_checkout_authority")).rows[0];
    expect(row.medusa_session_id).toBe(session.id);
    expect(row.proof_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r.data)).not.toContain(row.proof_hash);
    expect(state.calls.filter(x=>x.method==="create")).toEqual([{method:"create",account:"acct_A123456"}]);
    expect((await post()).data.payment_session_id).toBe(session.id);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
  });
  it("standard PaymentModule invocation without server proof fails before Stripe",async()=>{
    await expect(payment.createPaymentSession(collection.id,{provider_id:"pp_numeria-direct_np-direct",amount:2800,currency_code:"jpy",data:{session_id:"ps_A123"}})).rejects.toThrow("NP_AUTHENTICATED_CHECKOUT_REQUIRED");
    expect(state.calls).toHaveLength(0);
  });
  it("changed cart owner or line price cannot authorize checkout",async()=>{
    await cartModule.updateCarts(cart.id,{customer_id:other.customer.id});
    expect((await cartModule.retrieveCart(cart.id)).customer_id).toBe(other.customer.id);
    expect((await post()).status).toBe(409);
    await cartModule.updateCarts(cart.id,{customer_id:buyer.customer.id});
    const current=await cartModule.retrieveCart(cart.id,{relations:["items"]});
    if(!current.items?.length)throw Error("NP_FIXTURE_LINE_MISSING");
    await cartModule.updateLineItems(current.items[0].id,{unit_price:1});
    expect((await post()).status).toBe(409);
    expect(state.calls).toHaveLength(0);
  });
  it("multiple cart items or mismatched payment collection total are denied",async()=>{
    await payment.updatePaymentCollections(collection.id,{amount:1});
    expect(Number((await payment.retrievePaymentCollection(collection.id)).amount)).toBe(1);
    expect((await post()).status).toBe(409);
    await payment.updatePaymentCollections(collection.id,{amount:2800});
    await cartModule.addLineItems({cart_id:cart.id,title:"second listing",quantity:1,unit_price:1});
    expect((await post()).status).toBe(409);
    expect(state.calls).toHaveLength(0);
  });
  it("8 authenticated concurrent attempts create one intent and one Medusa binding",async()=>{
    const results=await Promise.all(Array.from({length:8},()=>post()));
    expect(results.some(r=>r.status===200)).toBe(true);
    expect(results.every(r=>[200,409].includes(r.status))).toBe(true);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
    const sessions=await payment.listPaymentSessions({payment_collection_id:collection.id});
    expect(sessions).toHaveLength(1);
  });
  it("lost response after persistence returns same real session on retry",async()=>{
    state.failResponse=true;expect((await post()).status).toBe(409);state.failResponse=false;
    const r=await post();expect(r.status).toBe(200);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
    expect((await payment.listPaymentSessions({payment_collection_id:collection.id}))).toHaveLength(1);
  });
  it("dangling binding stops for reconciliation instead of issuing another intent",async()=>{
    await database().query("UPDATE np_poc_b305_checkout_authority SET medusa_session_id='payses_missing'");
    expect((await post()).status).toBe(409);expect(state.calls).toHaveLength(0);
  });
}});
