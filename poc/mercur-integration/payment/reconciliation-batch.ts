// Internal bounded worker primitive. Results never include exception messages,
// payment payloads or credentials. Scheduling and durable retry policy are separate.
export async function reconcileBatch(ids:string[],run:(id:string)=>Promise<unknown>) {
  if(ids.length>100)throw Error("NP_RECONCILIATION_BATCH_LIMIT");
  const results:{orderId:string;status:"completed"|"review"|"retry"}[]=[];
  for(const orderId of new Set(ids)) {
    try {await run(orderId);results.push({orderId,status:"completed"});}
    catch(error) {
      const message=error instanceof Error?error.message:"";
      results.push({orderId,status:message==="NP_PARTIAL_COMPLETION_MANUAL_REVIEW"?"review":"retry"});
    }
  }
  return results;
}
