// P1-A FIXTURE ONLY — no real identity, payments or document data.
export const sellers = [
 {id:"sel-star",name:"星のしおり",mode:"NP_MANUAL",business:false,connect:"ENABLED",slug:"star-notes-demo",headline:"数字に隠れた、あなたらしさを読み解く",about:"日々の選択に寄り添う数秘術の鑑定書をお届けします。"},
 {id:"sel-moon",name:"月灯のアトリエ",mode:"NS_BUSINESS_LINKED",business:true,connect:"ENABLED",slug:"moonlight-demo",headline:"こころに、静かな光を。",about:"タロットの象徴から、今のあなたに必要な言葉を丁寧に紡ぎます。"}
];
export const listings = [
 {id:"lst-number",sellerId:"sel-star",slug:"first-step-demo",name:"数秘術・はじめの鑑定",price:2400,policy:"PREPAY",days:3,mode:"HUMAN",category:"数秘術",theme:"自己理解",pr:false,tag:"はじめの一歩"},
 {id:"lst-tarot",sellerId:"sel-moon",slug:"tarot-preview-demo",name:"タロット・一部確認後払い",price:3600,policy:"PREVIEW_POSTPAY",days:5,mode:"AI_ASSISTED_HUMAN",category:"タロット",theme:"恋愛・人間関係",pr:true,tag:"気持ちを整理"},
 {id:"lst-deep",sellerId:"sel-moon",slug:"deep-reading-demo",name:"深掘り鑑定・完全後払い",price:4800,policy:"FULL_POSTPAY",days:7,mode:"HUMAN",category:"タロット",theme:"仕事・未来",pr:false,tag:"じっくり考える"}
];
export const orders = [
 {id:"ord-pre-wait",buyer:"demo-buyer-a",listingId:"lst-number",policy:"PREPAY",payment:"UNPAID",fulfillment:"NOT_STARTED",publication:"NOT_PUBLISHED",pdfReady:false},
 {id:"ord-pre-work",buyer:"demo-buyer-a",listingId:"lst-number",policy:"PREPAY",payment:"PAID",fulfillment:"IN_PROGRESS",publication:"NOT_PUBLISHED",pdfReady:false},
 {id:"ord-preview",buyer:"demo-buyer-a",listingId:"lst-tarot",policy:"PREVIEW_POSTPAY",payment:"UNPAID",fulfillment:"READY",publication:"PREVIEW_PUBLISHED",pdfReady:true},
 {id:"ord-full-unpaid",buyer:"demo-buyer-a",listingId:"lst-deep",policy:"FULL_POSTPAY",payment:"UNPAID",fulfillment:"READY",publication:"FULL_PUBLISHED",pdfReady:true},
 {id:"ord-full-paid",buyer:"demo-buyer-a",listingId:"lst-deep",policy:"FULL_POSTPAY",payment:"PAID",fulfillment:"COMPLETED",publication:"FULL_PUBLISHED",pdfReady:true},
 {id:"ord-overdue",buyer:"demo-buyer-a",listingId:"lst-deep",policy:"FULL_POSTPAY",payment:"OVERDUE",fulfillment:"READY",publication:"FULL_PUBLISHED",pdfReady:true},
 {id:"ord-other-buyer",buyer:"demo-buyer-b",listingId:"lst-tarot",policy:"PREVIEW_POSTPAY",payment:"PAID",fulfillment:"COMPLETED",publication:"FULL_PUBLISHED",pdfReady:true}
];
export const policyLabels = {PREPAY:"先払い",PREVIEW_POSTPAY:"一部確認後払い",FULL_POSTPAY:"完全後払い"};
export const sellerFor = (listing) => sellers.find(s=>s.id===listing.sellerId);
export const listingFor = (order) => listings.find(l=>l.id===order.listingId);
export const money = amount => new Intl.NumberFormat("ja-JP",{style:"currency",currency:"JPY"}).format(amount);
export function entitlement(order) {
 if (!order || order.publication==="NOT_PUBLISHED") return {web:"NONE",pdf:false};
 const paid = order.payment==="PAID";
 if(order.policy==="FULL_POSTPAY"&&order.publication==="FULL_PUBLISHED")return {web:"FULL",pdf:paid&&order.pdfReady};
 if(order.policy==="PREVIEW_POSTPAY"&&!paid)return {web:order.publication==="PREVIEW_PUBLISHED"?"PREVIEW":"NONE",pdf:false};
 return {web:paid&&order.publication==="FULL_PUBLISHED"?"FULL":"NONE",pdf:paid&&order.pdfReady&&order.publication==="FULL_PUBLISHED"};
}
export const fixtureGateway = {
 listListings:()=>listings,
 getListingBySlug:slug=>listings.find(l=>l.slug===slug),
 getOrder:id=>orders.find(o=>o.id===id),
 listOrdersForBuyer:buyer=>orders.filter(o=>o.buyer===buyer),
 getSeller:id=>sellers.find(s=>s.id===id)
};
export const fixtureAuth = {currentBuyerId:"demo-buyer-a",note:"デモ用の架空ユーザーであり実認証ではありません"};
