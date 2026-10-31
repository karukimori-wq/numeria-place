import type {AuthenticatedMedusaRequest,MedusaResponse} from "@medusajs/framework/http";
import {database} from "../../../../providers/np-direct/runtime";
export const GET=async(req:AuthenticatedMedusaRequest,res:MedusaResponse)=>{
  res.setHeader("Cache-Control","no-store");
  const c=await database().connect();
  try{
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const grant=await c.query("SELECT 1 FROM np_poc_retry_operators WHERE actor_id=$1 AND enabled FOR SHARE",[req.auth_context.actor_id]);
    if(!grant.rowCount){await c.query("ROLLBACK");res.status(403).json({code:"NP_FORBIDDEN"});return;}
    const order=req.params.order_id;
    const q=await c.query("SELECT order_id,state,attempts,max_attempts,next_at,stop_reason FROM np_poc_retry_queue WHERE order_id=$1",[order]);
    if(!q.rowCount){await c.query("COMMIT");res.status(404).json({code:"NP_NOT_FOUND"});return;}
    const history=await c.query("SELECT attempt,status,finished_at FROM np_poc_retry_history WHERE order_id=$1 ORDER BY attempt DESC LIMIT 51",[order]);
    const audit=await c.query("SELECT request_id,actor_id,expected_attempts,budget,reason,created_at FROM np_poc_retry_requeue_audit WHERE order_id=$1 ORDER BY created_at DESC,request_id DESC LIMIT 51",[order]);
    await c.query("COMMIT");
    res.status(200).json({queue:q.rows[0],history:history.rows.slice(0,50),audit:audit.rows.slice(0,50),history_has_more:history.rows.length>50,audit_has_more:audit.rows.length>50});
  }catch{await c.query("ROLLBACK");res.status(503).json({code:"NP_INSPECTION_UNAVAILABLE"});}finally{c.release();}
};
