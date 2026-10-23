// Real Mercur modules/links, real DB seals; Stripe transport and Connect registry are offline fixtures.
import {medusaIntegrationTestRunner} from "@medusajs/test-utils";
import {Modules,ContainerRegistrationKeys,generateJwtToken} from "@medusajs/framework/utils";
import type {ICartModuleService,IPaymentModuleService} from "@medusajs/framework/types";
import {MercurModules,SellerStatus,PayoutAccountStatus} from "@mercurjs/types";
import {database,state,secret,close} from "../../src/providers/np-direct/runtime";
import {reconcilePaidOrder,reconcilePaidOrders} from "../../src/providers/np-direct/completion";
import {removeCartSeal} from "../../src/providers/np-direct/cart-seal";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import Stripe from "stripe";
const tables="np_poc_b305_checkout_authority,np_poc_b3_paid_outbox,np_poc_b3_ns_intake,np_poc_b3_webhook_inbox,np_poc_b3_checkout_attempts,np_poc_b3_payment_intents,np_poc_b3_payment_sessions,np_poc_b3_orders,np_poc_b3_listings,np_poc_b3_connect_accounts,np_poc_b3_sellers";
jest.setTimeout(180000);
medusaIntegrationTestRunner({testSuite:({api,getContainer})=>{describe("Mercur source-backed frozen checkout",()=>{
  let c:any,pg:any,cart:any,buyer:any,other:any,seller:any,offer:any,price:any,item:any,product:any,link:any;
  let cartModule:ICartModuleService,payment:IPaymentModuleService;
  async function customer(email:string){
    const customer=await c.resolve(Modules.CUSTOMER).createCustomers({email});
    const identity=await c.resolve(Modules.AUTH).createAuthIdentities({provider_identities:[{provider:"emailpass",entity_id:email,provider_metadata:{}}],app_metadata:{customer_id:customer.id}});
    const config=c.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig.http;
    const token=generateJwtToken({actor_id:customer.id,actor_type:"customer",auth_identity_id:identity.id},{secret:config.jwtSecret,expiresIn:"1d",jwtOptions:config.jwtOptions});
    return {customer,headers:{authorization:"Bearer "+token}};
  }
  const post=(who:any=buyer,body:any={})=>api.post("/np-cart-checkout/"+cart.id,body,{headers:who?.headers??{},validateStatus:()=>true});
  beforeEach(async()=>{
    c=getContainer();pg=c.resolve(ContainerRegistrationKeys.PG_CONNECTION);link=c.resolve(ContainerRegistrationKeys.LINK);
    cartModule=c.resolve(Modules.CART);payment=c.resolve(Modules.PAYMENT);
    state.calls.length=0;state.intents.clear();state.failProjection=false;state.failCompletion=false;state.failCompletionAck=false;
    await database().query("DROP TABLE IF EXISTS "+tables+" CASCADE");
    for(const name of ["b3-checkout-schema.sql","b3-webhook-schema.sql"])
      await database().query(readFileSync(join(process.cwd(),"src/providers/np-direct/db",name),"utf8"));
    await database().query(readFileSync(join(process.cwd(),"src/providers/np-direct/checkout-binding-schema.sql"),"utf8"));
    buyer=await customer("source-buyer@example.test");other=await customer("source-other@example.test");
    [seller]=await c.resolve(MercurModules.SELLER).createSellers([{name:"Source seller",handle:"np-source",email:"source-seller@example.test",currency_code:"jpy",status:SellerStatus.OPEN}]);
    const account=await c.resolve(MercurModules.PAYOUT).createPayoutAccounts({status:PayoutAccountStatus.ACTIVE,data:{id:"acct_Source123"}});
    await link.create({[MercurModules.SELLER]:{seller_id:seller.id},[MercurModules.PAYOUT]:{payout_account_id:account.id}});
    [product]=await c.resolve(Modules.PRODUCT).createProducts([{title:"Source digital product",status:"published",variants:[{title:"Default",sku:"NP-SOURCE-VARIANT"}]}]);
    const profile=await c.resolve(Modules.FULFILLMENT).createShippingProfiles({name:"Digital fixture",type:"default"});
    [offer]=await c.resolve(MercurModules.OFFER).createOffers([{seller_id:seller.id,product_id:product.id,variant_id:product.variants[0].id,shipping_profile_id:profile.id,sku:"NP-SOURCE-OFFER",created_by:"fixture_server",manage_inventory:false,allow_backorder:true}]);
    const priceSet=await c.resolve(Modules.PRICING).createPriceSets({prices:[{amount:2800,currency_code:"jpy"}]});price=priceSet.prices[0];
    await link.create({[MercurModules.OFFER]:{offer_id:offer.id},[Modules.PRICING]:{price_id:price.id}});
    cart=await cartModule.createCarts({currency_code:"jpy",customer_id:buyer.customer.id,items:[{title:"Actual variant",quantity:1,unit_price:2800,variant_id:product.variants[0].id,product_id:product.id,requires_shipping:false,metadata:{np_listing_id:"untrusted_ignore_me",seller_id:"untrusted_ignore_me"}}]});
    const loaded=await cartModule.retrieveCart(cart.id,{relations:["items"]});if(!loaded.items?.length)throw Error("NP_FIXTURE_MISSING_ITEM");item=loaded.items[0];
    await link.create({[Modules.CART]:{line_item_id:item.id},[MercurModules.OFFER]:{offer_id:offer.id}});
    // Test-only onboarding registry remains the source of verified Connect scope.
    await database().query("INSERT INTO np_poc_b3_sellers VALUES($1,'active','verified')",[seller.id]);
    await database().query("INSERT INTO np_poc_b3_connect_accounts VALUES($1,'acct_Source123',true,'active')",[seller.id]);
  });
  afterEach(async()=>{await removeCartSeal(pg);});
  afterAll(async()=>{await database().query("DROP TABLE IF EXISTS "+tables+" CASCADE");await close();});
  it("creates NP authority/order/session from real offer, seller, price and cart links",async()=>{
    expect((await database().query("SELECT count(*)::int n FROM np_poc_b3_orders")).rows[0].n).toBe(0);
    const r=await post();expect(r.status).toBe(200);
    const row=(await database().query("SELECT * FROM np_poc_b3_orders")).rows[0];
    expect(row.order_id).toBe(r.data.order_id);expect(row.seller_id).toBe(seller.id);expect(row.listing_id).toBe(offer.id);expect(row.account_id).toBe("acct_Source123");expect(Number(row.amount_minor)).toBe(2800);
    const s=await payment.retrievePaymentSession(r.data.payment_session_id);expect(s.id).toMatch(/^payses_/);
    expect((await pg("np_poc_cart_seals").first()).snapshot.offerId).toBe(offer.id);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
  });
  it("anonymous/other buyer and financial browser overrides do not create an intent",async()=>{
    expect((await post(null)).status).toBe(401);expect((await post(other)).status).toBe(404);
    expect((await post(buyer,{amount:1,account_id:"acct_Evil"})).status).toBe(400);expect(state.calls).toHaveLength(0);
  });
  it("rejects catalog/cart price mismatch before sealing or Stripe",async()=>{
    await cartModule.updateLineItems(item.id,{unit_price:1});expect((await post()).status).toBe(409);expect(state.calls).toHaveLength(0);
    expect(await pg("np_poc_cart_seals").select()).toHaveLength(0);
  });
  it("requires real offer link and verified Connect registry",async()=>{
    await database().query("UPDATE np_poc_b3_connect_accounts SET charges_enabled=false");expect((await post()).status).toBe(409);
    await database().query("UPDATE np_poc_b3_connect_accounts SET charges_enabled=true");
    await link.dismiss({[Modules.CART]:{line_item_id:item.id},[MercurModules.OFFER]:{offer_id:offer.id}});
    expect((await post()).status).toBe(409);expect(state.calls).toHaveLength(0);
  });
  it("blocks ordinary module and direct SQL mutations after checkout seal",async()=>{
    expect((await post()).status).toBe(200);
    await expect(cartModule.updateLineItems(item.id,{quantity:2})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    await expect(cartModule.updateCarts(cart.id,{customer_id:other.customer.id})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    await expect(pg("cart_line_item").where({id:item.id}).update({unit_price:1})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    const s=await pg("np_poc_cart_seals").first();
    await expect(payment.updatePaymentCollections(s.snapshot.collectionId,{amount:1})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    await expect(pg("payment_collection").where({id:s.snapshot.collectionId}).update({id:"paycol_changed"})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    await expect(pg("payment_collection").where({id:s.snapshot.collectionId}).update({raw_amount:JSON.stringify({value:"1",precision:20})})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    await expect(pg("cart_line_item_adjustment").insert({id:"adj_np_denied",item_id:item.id,amount:1,code:"denied"})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    await expect(database().query("UPDATE np_poc_b3_orders SET amount_minor=1")).rejects.toThrow("NP_ORDER_SNAPSHOT_IMMUTABLE");
  });
  it("blocks remote offer/cart-payment link removal after seal",async()=>{
    expect((await post()).status).toBe(200);
    await expect(link.dismiss({[Modules.CART]:{line_item_id:item.id},[MercurModules.OFFER]:{offer_id:offer.id}})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    const s=await pg("np_poc_cart_seals").first();
    await expect(link.dismiss({[Modules.CART]:{cart_id:cart.id},[Modules.PAYMENT]:{payment_collection_id:s.snapshot.collectionId}})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
  });
  it("rebuilds lost NP projection from durable seal without another intent",async()=>{
    state.failProjection=true;
    try{expect((await post()).status).toBe(409);}finally{state.failProjection=false;}
    expect(await pg("np_poc_cart_seals").select()).toHaveLength(1);
    expect(state.calls).toHaveLength(0);
    expect((await database().query("SELECT count(*)::int n FROM np_poc_b3_orders")).rows[0].n).toBe(0);
    const first=await post();expect(first.status).toBe(200);
    const next=await post();expect(next.data).toEqual(first.data);
    expect((await database().query("SELECT count(*)::int n FROM np_poc_b3_orders")).rows[0].n).toBe(1);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
  });
  it("changed live catalog price rejects reuse rather than repricing a sealed order",async()=>{
    expect((await post()).status).toBe(200);
    await pg("price").where({id:price.id}).update({amount:2900,raw_amount:JSON.stringify({value:"2900",precision:20})});
    expect((await post()).status).toBe(409);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
    expect(Number((await database().query("SELECT amount_minor FROM np_poc_b3_orders")).rows[0].amount_minor)).toBe(2800);
  });
  it("8 concurrent preparations produce one source order, collection and intent",async()=>{
    const results=await Promise.all(Array.from({length:8},()=>post()));
    expect(results.some(r=>r.status===200)).toBe(true);
    expect(results.every(r=>[200,409].includes(r.status))).toBe(true);
    expect((await database().query("SELECT count(*)::int n FROM np_poc_b3_orders")).rows[0].n).toBe(1);
    expect((await pg("np_poc_cart_seals").select())).toHaveLength(1);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
    const {data}=await c.resolve(ContainerRegistrationKeys.QUERY).graph({entity:"cart_payment_collection",fields:["payment_collection_id"],filters:{cart_id:cart.id}});
    expect(data).toHaveLength(1);
  });
  async function signedPaid(eventId:string){
    const r=await post();expect(r.status).toBe(200);
    const s=await payment.retrievePaymentSession(r.data.payment_session_id);const pi=state.intents.get(s.data.id as string);
    state.intents.set(pi.id,{...pi,status:"succeeded"});
    const payload=JSON.stringify({id:eventId,type:"payment_intent.succeeded",account:"acct_Source123",data:{object:{...pi,status:"succeeded"}}});
    const sdk=new Stripe("sk_test_OFFLINE");const signature=await sdk.webhooks.generateTestHeaderStringAsync({payload,secret});
    return {orderId:r.data.order_id,send:()=>api.post("/hooks/np-direct",payload,{headers:{"content-type":"application/json","stripe-signature":signature},validateStatus:()=>true})};
  }
  it("unpaid source order cannot authorize standard completion",async()=>{
    const r=await post();expect(r.status).toBe(200);
    await expect(reconcilePaidOrder(r.data.order_id,c)).rejects.toThrow("NP_COMPLETION_REQUIRES_PAID");
    await expect(cartModule.updateCarts(cart.id,{completed_at:new Date()})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    expect(await pg("np_poc_completion").select()).toHaveLength(0);
  });
  it("replays durable paid state after failure before Mercur completion",async()=>{
    const event=await signedPaid("evt_before_completion");state.failCompletion=true;
    try{expect((await event.send()).status).toBe(503);}finally{state.failCompletion=false;}
    expect((await database().query("SELECT state FROM np_poc_b3_orders")).rows[0].state).toBe("paid");
    expect((await cartModule.retrieveCart(cart.id)).completed_at).toBeNull();
    await reconcilePaidOrders(c);
    expect((await pg("np_poc_completion").first()).state).toBe("completed");
    expect((await event.send()).status).toBe(200);
    expect((await database().query("SELECT count(*)::int n FROM np_poc_b3_ns_intake")).rows[0].n).toBe(1);
    expect(state.calls.filter(x=>x.method==="create")).toHaveLength(1);
  });
  it("lost acknowledgement after standard completion retries without another order",async()=>{
    const event=await signedPaid("evt_after_completion");state.failCompletionAck=true;
    try{expect((await event.send()).status).toBe(503);}finally{state.failCompletionAck=false;}
    expect((await cartModule.retrieveCart(cart.id)).completed_at).toBeTruthy();
    expect((await event.send()).status).toBe(200);
    const completed=await pg("np_poc_completion").first();expect(completed.state).toBe("completed");
    const q=await c.resolve(ContainerRegistrationKeys.QUERY).graph({entity:"order_cart",fields:["order.id"],filters:{cart_id:cart.id}});
    expect(q.data).toHaveLength(1);expect(q.data[0].order.id).toBe(completed.medusa_order_id);
    await expect(cartModule.updateLineItems(item.id,{quantity:2})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    await expect(cartModule.updateCarts(cart.id,{customer_id:other.customer.id})).rejects.toThrow("NP_SEALED_CART_IMMUTABLE");
    expect(state.calls.every(x=>x.account==="acct_Source123")).toBe(true);
    expect(state.calls.some(x=>x.method==="capture")).toBe(false);
  });
  it("source-backed real session and signed HTTP confirm NP paid/Intake/Outbox once",async()=>{
    const r=await post();expect(r.status).toBe(200);
    const s=await payment.retrievePaymentSession(r.data.payment_session_id);const pi=state.intents.get(s.data.id as string);
    state.intents.set(pi.id,{...pi,status:"succeeded"});
    const payload=JSON.stringify({id:"evt_source_success",type:"payment_intent.succeeded",account:"acct_Source123",data:{object:{...pi,status:"succeeded"}}});
    const sdk=new Stripe("sk_test_OFFLINE");const sig=await sdk.webhooks.generateTestHeaderStringAsync({payload,secret});
    for(let i=0;i<2;i++)expect((await api.post("/hooks/np-direct",payload,{headers:{"content-type":"application/json","stripe-signature":sig},validateStatus:()=>true})).status).toBe(200);
    expect((await database().query("SELECT state FROM np_poc_b3_orders")).rows[0].state).toBe("paid");
    expect((await cartModule.retrieveCart(cart.id)).completed_at).toBeTruthy();
    expect((await pg("np_poc_completion").first()).state).toBe("completed");
    expect((await database().query("SELECT count(*)::int n FROM np_poc_b3_ns_intake")).rows[0].n).toBe(1);
    expect((await database().query("SELECT count(*)::int n FROM np_poc_b3_paid_outbox")).rows[0].n).toBe(1);
  });
});}});
