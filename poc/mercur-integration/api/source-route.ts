import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http";
import {Modules} from "@medusajs/framework/utils";
import {prepareSourceCheckout} from "../../../providers/np-direct/source-checkout";
import {startBuyerCheckout} from "../../../providers/np-direct/checkout-binding";
export const POST=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  try {
    if(Object.keys(req.body??{}).length){res.status(400).json({code:"NP_SERVER_CONTROLLED_CHECKOUT"});return;}
    const actor=req.auth_context.actor_id;
    const order=await prepareSourceCheckout(actor,req.params.cart_id,req.scope);
    const session=await startBuyerCheckout(actor,order,req.scope.resolve(Modules.CART),req.scope.resolve(Modules.PAYMENT),req.scope);
    res.status(200).json({order_id:order,payment_session_id:session.id});
  }catch(error){res.status((error as Error).message==="NP_CHECKOUT_NOT_FOUND"?404:409).json({code:"NP_SOURCE_CHECKOUT_REJECTED"});}
};
