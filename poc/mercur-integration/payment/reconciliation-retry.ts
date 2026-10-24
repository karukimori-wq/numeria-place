// Disposable local test DB only. No scheduler or production migration.
import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
export async function installRetryQueue(db:Pool) {
  if(process.env.NODE_ENV!=="test")throw Error("NP_TEST_ONLY_DDL");
  await db.query(`CREATE TABLE IF NOT EXISTS np_poc_retry_queue(
    order_id text PRIMARY KEY,state text NOT NULL DEFAULT 'retry' CHECK(state IN ('retry','running','review','completed')),
    attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,token uuid);
    ALTER TABLE np_poc_retry_queue ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 100);
    ALTER TABLE np_poc_retry_queue ADD COLUMN IF NOT EXISTS stop_reason text CHECK(stop_reason IS NULL OR stop_reason IN ('attempt_limit','partial_completion'));
    CREATE TABLE IF NOT EXISTS np_poc_retry_history(order_id text NOT NULL,attempt integer NOT NULL,status text NOT NULL CHECK(status IN ('completed','review','retry')),finished_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(order_id,attempt));`);
}
export async function runDueReconciliation(db:Pool,run:(id:string)=>Promise<unknown>,limit=100) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error("NP_RETRY_BATCH_LIMIT");
  // Exhausted crashed claims must stop without invoking the callback again.
  await db.query(`UPDATE np_poc_retry_queue SET state='review',stop_reason='attempt_limit',token=NULL,lease_until=NULL
    WHERE attempts>=max_attempts AND (state='retry' OR (state='running' AND lease_until<=now()))`);
  const results:{orderId:string;status:string}[]=[];
  for(let i=0;i<limit;i++){
    const token=randomUUID();
    const q=await db.query(`UPDATE np_poc_retry_queue q SET state='running',stop_reason=NULL,attempts=q.attempts+1,token=$1,lease_until=now()+interval '90 seconds'
      WHERE order_id=(SELECT order_id FROM np_poc_retry_queue WHERE attempts<max_attempts AND ((state='retry' AND next_at<=now()) OR (state='running' AND lease_until<=now())) ORDER BY next_at,order_id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING order_id,attempts,max_attempts`,[token]);
    if(!q.rowCount)break;
    const row=q.rows[0];let status="completed";
    try{await run(row.order_id);}catch(e){status=e instanceof Error&&e.message==="NP_PARTIAL_COMPLETION_MANUAL_REVIEW"?"review":"retry";}
    const reason=status==="review"?"partial_completion":status==="retry"&&row.attempts>=row.max_attempts?"attempt_limit":null;
    if(reason)status="review";
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const done=await client.query(`UPDATE np_poc_retry_queue SET state=$3,stop_reason=$4,token=NULL,lease_until=NULL,
        next_at=now()+make_interval(secs=>LEAST(3600,60*power(2,LEAST(attempts-1,6)))::integer)
        WHERE order_id=$1 AND token=$2 AND lease_until>now() RETURNING order_id`,[row.order_id,token,status,reason]);
      if(done.rowCount){await client.query("INSERT INTO np_poc_retry_history(order_id,attempt,status) VALUES($1,$2,$3)",[row.order_id,row.attempts,status]);results.push({orderId:row.order_id,status});}
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }
  return results;
}
