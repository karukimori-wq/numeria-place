// Only trusted NP authority references. A missing reference requires review;
// transport/storage errors remain retryable and must not be called corruption.
import {Modules} from '@medusajs/framework/utils';
export async function completionReferences(a:any,scope:any){
  if(!a.medusa_session_id||!a.payment_collection_id)throw Error('NP_ORPHAN_COMPLETION_MANUAL_REVIEW');
  const payment=scope.resolve(Modules.PAYMENT);
  try{
    const session=await payment.retrievePaymentSession(a.medusa_session_id);
    await payment.retrievePaymentCollection(a.payment_collection_id);
    return {payment,session};
  }catch(error){
    if((error as {type?:string})?.type==='not_found')throw Error('NP_ORPHAN_COMPLETION_MANUAL_REVIEW');
    throw error;
  }
}
