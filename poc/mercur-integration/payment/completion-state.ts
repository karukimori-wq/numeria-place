// A partial persisted result must never start a fresh order-creation workflow.
export function completionDisposition(groupCount:number,orderCount:number,completed:boolean) {
  if(groupCount===0 && orderCount===0 && !completed)return "start";
  if(groupCount===1 && orderCount===1 && completed)return "verify";
  return "review";
}
