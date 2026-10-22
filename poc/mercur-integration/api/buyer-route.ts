import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http";
import {Modules} from "@medusajs/framework/utils";
import {startBuyerCheckout} from "../../../providers/np-direct/checkout-binding";
import {state} from "../../../providers/np-direct/runtime";
export const POST=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  try {
    if(Object.keys(req.body??{}).length){res.status(400).json({code:"NP_SERVER_CONTROLLED_CHECKOUT"});return;}
    const s=await startBuyerCheckout(req.auth_context?.actor_id,req.params.order_id,
      req.scope.resolve(Modules.CART),req.scope.resolve(Modules.PAYMENT));
    if(state.failResponse)throw Error("NP_INJECTED_RESPONSE_LOSS");
    res.status(200).json({payment_session_id:s.id,status:s.status});
  }catch(error){
    const message=(error as Error).message;
    res.status(message==="NP_CHECKOUT_NOT_FOUND"?404:409).json({code:message==="NP_CHECKOUT_NOT_FOUND"?"NP_NOT_FOUND":"NP_CHECKOUT_RETRY_OR_RECONCILE"});
  }
};
