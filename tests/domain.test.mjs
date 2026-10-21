import test from "node:test";import assert from "node:assert/strict";
import {entitlement,orders,listingFor,sellers,sellerFor,listings,fixtureGateway} from "../app/data.mjs";
test("three policies retain separate web/PDF permissions",()=>{
 for(const [id,web,pdf] of [["ord-pre-wait","NONE",false],["ord-pre-work","NONE",false],["ord-preview","PREVIEW",false],["ord-full-unpaid","FULL",false],["ord-full-paid","FULL",true],["ord-overdue","FULL",false]]){const order=orders.find(o=>o.id===id);assert.deepEqual(entitlement(order),{web,pdf});}
});
test("an order references exactly one listing and the same seller on every channel",()=>{
 for(const order of orders){const listing=listingFor(order);assert.ok(listing);assert.ok(sellerFor(listing));assert.ok(sellers.some(s=>s.id===listing.sellerId));}
 assert.equal(new Set(listings.map(x=>x.id)).size,listings.length);
});
test("fixture ownership filtering is explicit and demos are separate",()=>{
 assert.ok(fixtureGateway.listOrdersForBuyer("demo-buyer-a").every(x=>x.buyer==="demo-buyer-a"));
 assert.ok(!fixtureGateway.listOrdersForBuyer("demo-buyer-a").some(x=>x.id==="ord-other-buyer"));
});
test("Business is optional for manual sellers",()=>{
 assert.ok(sellers.some(s=>s.mode==="NP_MANUAL"&&!s.business));
 assert.ok(sellers.some(s=>s.mode==="NS_BUSINESS_LINKED"&&s.business));
});
