import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http";
import {database} from "../../../../../providers/np-direct/runtime";
import {requeueReviewedOrder} from "../../../../../providers/np-direct/reconciliation-requeue";
export const POST=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  const body=req.body as Record<string,unknown>|undefined;
  if(!body||Object.keys(body).sort().join(',')!=="budget,expectedAttempts,reason,requestId"||typeof body.requestId!=="string"||typeof body.expectedAttempts!=="number"||typeof body.budget!=="number"||body.reason!=="binding_verified"){
    res.status(400).json({code:"NP_REQUEUE_INVALID"});return;
  }
  try{
    const result=await requeueReviewedOrder(database(),{requestId:body.requestId,expectedAttempts:body.expectedAttempts,budget:body.budget,reason:body.reason,actorId:req.auth_context.actor_id,orderId:req.params.order_id});
    res.status(200).json({result});
  }catch(e){
    const message=(e as Error).message;
    res.status(message==="NP_REQUEUE_FORBIDDEN"?403:message==="NP_REQUEUE_INVALID"?400:message==="NP_REQUEUE_STATE_CONFLICT"||message==="NP_REQUEUE_REQUEST_CONFLICT"?409:503).json({code:message==="NP_REQUEUE_FORBIDDEN"?"NP_FORBIDDEN":"NP_REQUEUE_REJECTED"});
  }
};
