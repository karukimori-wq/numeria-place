// B3-05c-2a: read real Mercur graph; freeze a narrow digital JPY cart.
import {createHash} from "node:crypto";
import {ContainerRegistrationKeys,Modules} from "@medusajs/framework/utils";
import {database,state} from "./runtime";
import {installCartSeal} from "./cart-seal";
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function sourceSnapshot(actor:string,cartId:string,scope:any,requireCollection=true) {
  const {data}=await scope.resolve(ContainerRegistrationKeys.QUERY).graph({entity:"cart",filters:{id:cartId},fields:[
    "id","customer_id","currency_code","completed_at","items.*","items.tax_lines.*","items.adjustments.*","shipping_methods.*",
    "items.offer.id","items.offer.variant_id","items.offer.product_id","items.offer.seller_id",
    "items.offer.product.status","items.offer.seller.id","items.offer.seller.status",
    "items.offer.seller.payout_account.status","items.offer.seller.payout_account.data",
    "items.offer.prices.*","items.offer.prices.price_rules.*","payment_collection.id","payment_collection.amount","payment_collection.currency_code"
  ]});
  const cart=data[0];if(!cart||cart.customer_id!==actor)throw Error("NP_CHECKOUT_NOT_FOUND");
  const item=cart.items?.[0],offer=item?.offer,seller=offer?.seller;
  if(cart.completed_at || cart.currency_code!=="jpy" || cart.items?.length!==1 || Number(item.quantity)!==1 ||
    cart.shipping_methods?.length || item.tax_lines?.length || item.adjustments?.length ||
    !offer || item.variant_id!==offer.variant_id || item.product_id!==offer.product_id ||
    offer.product?.status!=="published" || seller?.id!==offer.seller_id || seller?.status!=="open" ||
    seller.payout_account?.status!=="active")throw Error("NP_SOURCE_INELIGIBLE");
  const prices=(offer.prices??[]).filter((p:any)=>p.currency_code==="jpy");
  if(prices.length!==1 || (prices[0].price_rules??[]).some((r:any)=>r.attribute!=="offer_id"||r.value!==offer.id) || prices[0].price_list_id || prices[0].min_quantity || prices[0].max_quantity ||
    !Number.isSafeInteger(Number(prices[0].amount)) || Number(prices[0].amount)<=0 ||
    Number(item.unit_price)!==Number(prices[0].amount))throw Error("NP_SOURCE_PRICE_MISMATCH");
  const account=seller.payout_account.data?.id;
  const registry=await database().query(`SELECT 1 FROM np_poc_b3_connect_accounts a JOIN np_poc_b3_sellers s USING(seller_id)
    WHERE a.seller_id=$1 AND a.account_id=$2 AND a.charges_enabled AND a.account_status='active' AND s.status='active' AND s.kyc_status='verified'`,[seller.id,account]);
  if(registry.rowCount!==1)throw Error("NP_CONNECT_REGISTRY_MISMATCH");
  const collection=cart.payment_collection;
  if(requireCollection && (!collection || Number(collection.amount)!==Number(item.unit_price)||collection.currency_code!=="jpy"))throw Error("NP_SOURCE_COLLECTION_MISMATCH");
  const snap={buyerId:actor,cartId,itemId:item.id,offerId:offer.id,variantId:offer.variant_id,productId:offer.product_id,
    sellerId:seller.id,accountId:account,priceId:prices[0].id,amount:Number(prices[0].amount),currency:"jpy",collectionId:collection?.id??null};
  return {snapshot:snap,hash:digest(snap)};
}
export async function prepareSourceCheckout(actor:string,cartId:string,scope:any) {
  const pg=scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  await installCartSeal(pg);
  const saved=await pg("np_poc_cart_seals").where({cart_id:cartId}).first();
  let sealed:any;
  if(saved){
    const now=await sourceSnapshot(actor,cartId,scope);
    if(now.hash!==saved.snapshot_hash)throw Error("NP_SOURCE_VERSION_CHANGED");
    sealed=now;
  }else{
    // All preparation attempts for a cart serialize. No Stripe request here.
    sealed=await pg.transaction(async(trx:any)=>{
      await trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))",["np:prepare:"+cartId]);
      const prior=await trx("np_poc_cart_seals").where({cart_id:cartId}).first();
      if(prior){if(prior.snapshot.buyerId!==actor)throw Error("NP_CHECKOUT_NOT_FOUND");return {snapshot:prior.snapshot,hash:prior.snapshot_hash};}
      const initial=await sourceSnapshot(actor,cartId,scope,false);
      const payment=scope.resolve(Modules.PAYMENT),link=scope.resolve(ContainerRegistrationKeys.LINK);
      if(!initial.snapshot.collectionId){
        const c=await payment.createPaymentCollections({amount:initial.snapshot.amount,currency_code:"jpy"});
        await link.create({[Modules.CART]:{cart_id:cartId},[Modules.PAYMENT]:{payment_collection_id:c.id}});
      }
      // Child/link triggers take this same parent row lock. Re-read after lock;
      // freeze only if the entire current graph still validates.
      await trx("cart").where({id:cartId}).forUpdate().first();
      const current=await sourceSnapshot(actor,cartId,scope);
      await trx("np_poc_cart_seals").insert({cart_id:cartId,snapshot:current.snapshot,snapshot_hash:current.hash});
      return current;
    });
  }
  if(state.failProjection)throw Error("NP_INJECTED_PROJECTION_FAILURE");
  if(sealed.snapshot.buyerId!==actor || sealed.snapshot.cartId!==cartId)throw Error("NP_CHECKOUT_NOT_FOUND");
  const s=sealed.snapshot,key=digest(cartId).slice(0,32),order="order_"+key,session="ps_"+key;
  await database().query(`CREATE OR REPLACE FUNCTION np_poc_guard_financial_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS(SELECT 1 FROM np_poc_b305_checkout_authority WHERE order_id=OLD.order_id AND snapshot_hash IS NOT NULL) AND
       (OLD.order_id,OLD.seller_id,OLD.listing_id,OLD.account_id,OLD.amount_minor,OLD.fee_minor,OLD.currency)
       IS DISTINCT FROM (NEW.order_id,NEW.seller_id,NEW.listing_id,NEW.account_id,NEW.amount_minor,NEW.fee_minor,NEW.currency)
      THEN RAISE EXCEPTION 'NP_ORDER_SNAPSHOT_IMMUTABLE'; END IF; RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS np_poc_freeze_order ON np_poc_b3_orders;
    CREATE TRIGGER np_poc_freeze_order BEFORE UPDATE ON np_poc_b3_orders FOR EACH ROW EXECUTE FUNCTION np_poc_guard_financial_snapshot();`);
  const db=await database().connect();
  try {
    await db.query("BEGIN");
    await db.query("INSERT INTO np_poc_b3_listings VALUES($1,$2,'published') ON CONFLICT(listing_id) DO NOTHING",[s.offerId,s.sellerId]);
    await db.query("INSERT INTO np_poc_b3_orders VALUES($1,$2,$3,$4,$5,0,'jpy','pending') ON CONFLICT(order_id) DO NOTHING",[order,s.sellerId,s.offerId,s.accountId,s.amount]);
    const existing=(await db.query("SELECT * FROM np_poc_b3_orders WHERE order_id=$1 FOR UPDATE",[order])).rows[0];
    if(existing.seller_id!==s.sellerId||existing.listing_id!==s.offerId||existing.account_id!==s.accountId||Number(existing.amount_minor)!==s.amount||Number(existing.fee_minor)!==0||existing.currency!==s.currency)throw Error("NP_PROJECTION_CONFLICT");
    await db.query("INSERT INTO np_poc_b3_payment_sessions VALUES($1,$2,now()+interval '1 hour') ON CONFLICT(order_id) DO NOTHING",[session,order]);
    await db.query(`INSERT INTO np_poc_b305_checkout_authority(order_id,buyer_id,cart_id,payment_collection_id,snapshot_hash)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(order_id) DO NOTHING`,[order,actor,cartId,s.collectionId,sealed.hash]);
    const a=(await db.query("SELECT * FROM np_poc_b305_checkout_authority WHERE order_id=$1",[order])).rows[0];
    if(a.buyer_id!==actor||a.cart_id!==cartId||a.payment_collection_id!==s.collectionId||a.snapshot_hash!==sealed.hash)throw Error("NP_AUTHORITY_CONFLICT");
    await db.query("COMMIT");return order;
  }catch(e){await db.query("ROLLBACK");throw e;}finally{db.release();}
}
export async function assertSourceVersion(actor:string,a:any,scope:any) {
  if(!scope)throw Error("NP_SOURCE_SCOPE_REQUIRED");
  const now=await sourceSnapshot(actor,a.cart_id,scope);
  const pg=scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const sealed=await pg("np_poc_cart_seals").where({cart_id:a.cart_id}).first();
  if(!sealed || now.hash!==a.snapshot_hash || sealed.snapshot_hash!==a.snapshot_hash)throw Error("NP_SOURCE_VERSION_CHANGED");
}
