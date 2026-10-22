import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { accept } from "../../../providers/np-direct/runtime";
export const POST = async (req:MedusaRequest,res:MedusaResponse) => {
  const sig=req.headers["stripe-signature"];
  if(typeof sig!=="string" || !req.rawBody) {res.status(400).json({code:"NP_SIGNATURE_REQUIRED"});return;}
  try {
    await accept(req.rawBody,sig);
    res.status(200).json({received:true});
  } catch(error) {
    // No payload, account, secret or internal DB error in the HTTP response.
    const name=(error as {type?:string}).type;
    const signature=name==="StripeSignatureVerificationError";
    res.status(signature?400:503).json({code:signature?"NP_INVALID_SIGNATURE":"NP_RETRY_OR_RECONCILE"});
  }
};
