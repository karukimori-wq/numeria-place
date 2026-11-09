// Internal test-only boundary. Actor ID must come from trusted server identity;
// no public HTTP route, browser role flag, Clerk or production RBAC is provided.
import type {Pool} from "pg";
export async function installRequeueAudit(db:Pool){
  if(process.env.NODE_ENV!=="test")throw Error("NP_TEST_ONLY_DDL");
  await db.query(`CREATE TABLE IF NOT EXISTS np_poc_retry_operators(actor_id text PRIMARY KEY,enabled boolean NOT NULL);
    CREATE TABLE IF NOT EXISTS np_poc_retry_requeue_audit(request_id uuid PRIMARY KEY,actor_id text NOT NULL,order_id text NOT NULL,expected_attempts integer NOT NULL,budget integer NOT NULL,reason text NOT NULL CHECK(reason='binding_verified'),created_at timestamptz NOT NULL DEFAULT now());`);
}
type Request={requestId:string;actorId:string;orderId:string;expectedAttempts:number;budget:number;reason:"binding_verified"};
export async function requeueReviewedOrder(db:Pool,r:Request){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.requestId)||!Number.isInteger(r.expectedAttempts)||r.expectedAttempts<0||!Number.isInteger(r.budget)||r.budget<1||r.budget>5||r.expectedAttempts+r.budget>100||r.reason!=="binding_verified")throw Error("NP_REQUEUE_INVALID");
  const c=await db.connect();
  try{
    await c.query("BEGIN");
    const grant=await c.query("SELECT 1 FROM np_poc_retry_operators WHERE actor_id=$1 AND enabled FOR SHARE",[r.actorId]);
    if(!grant.rowCount)throw Error("NP_REQUEUE_FORBIDDEN");
    // Serialize request IDs even when two different orders reuse the same ID.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[r.requestId]);
    const old=(await c.query("SELECT * FROM np_poc_retry_requeue_audit WHERE request_id=$1",[r.requestId])).rows[0];
    if(old){if(old.actor_id!==r.actorId||old.order_id!==r.orderId||old.expected_attempts!==r.expectedAttempts||old.budget!==r.budget||old.reason!==r.reason)throw Error("NP_REQUEUE_REQUEST_CONFLICT");await c.query("COMMIT");return "duplicate";}
    const q=await c.query("SELECT * FROM np_poc_retry_queue WHERE order_id=$1 FOR UPDATE",[r.orderId]);const row=q.rows[0];
    if(!row||row.state!=="review"||row.stop_reason!=="attempt_limit"||row.attempts!==r.expectedAttempts||row.token||row.lease_until)throw Error("NP_REQUEUE_STATE_CONFLICT");
    await c.query("UPDATE np_poc_retry_queue SET state='retry',stop_reason=NULL,max_attempts=attempts+$2,next_at=now() WHERE order_id=$1",[r.orderId,r.budget]);
    await c.query("INSERT INTO np_poc_retry_requeue_audit(request_id,actor_id,order_id,expected_attempts,budget,reason) VALUES($1,$2,$3,$4,$5,$6)",[r.requestId,r.actorId,r.orderId,r.expectedAttempts,r.budget,r.reason]);
    await c.query("COMMIT");return "requeued";
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
