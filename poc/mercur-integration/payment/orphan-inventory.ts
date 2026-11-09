// Test-only observation queue, not repair or proof that an in-flight checkout
// is abandoned. Scope: this provider's sessions + collections in NP cart seals.
import {ContainerRegistrationKeys} from '@medusajs/framework/utils';
import {database} from './runtime';
import {providerId} from './checkout-binding';
export async function inspectOrphanInventory(scope:any,after='',limit=100){
  if(process.env.NODE_ENV!=='test')throw Error('NP_TEST_ONLY');
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('NP_INVENTORY_LIMIT');
  const pg=scope.resolve(ContainerRegistrationKeys.PG_CONNECTION),db=database();
  await db.query(`CREATE TABLE IF NOT EXISTS np_poc_orphan_resources(
    resource_key text PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('session','collection')),
    resource_id text NOT NULL,state text NOT NULL CHECK(state='review'),reason text NOT NULL CHECK(reason='unmatched_authority'))`);
  const page=(await pg.raw(`SELECT * FROM (
    SELECT 'session:'||id AS resource_key,'session' AS kind,id AS resource_id FROM payment_session WHERE provider_id=? AND deleted_at IS NULL
    UNION
    SELECT 'collection:'||(snapshot->>'collectionId') AS resource_key,'collection' AS kind,snapshot->>'collectionId' AS resource_id
      FROM np_poc_cart_seals WHERE snapshot->>'collectionId' IS NOT NULL
    ) r WHERE resource_key COLLATE "C">? ORDER BY resource_key COLLATE "C" LIMIT ?`,[providerId,after,limit])).rows;
  const refs=(await db.query(`SELECT medusa_session_id,payment_collection_id FROM np_poc_b305_checkout_authority
    WHERE medusa_session_id=ANY($1::text[]) OR payment_collection_id=ANY($1::text[])`,[page.map((r:any)=>r.resource_id)])).rows;
  const findings=[];
  for(const r of page){
    const field=r.kind==='session'?'medusa_session_id':'payment_collection_id';
    if(refs.some(a=>a[field]===r.resource_id))continue;
    await db.query(`INSERT INTO np_poc_orphan_resources VALUES($1,$2,$3,'review','unmatched_authority') ON CONFLICT DO NOTHING`,[r.resource_key,r.kind,r.resource_id]);
    findings.push({kind:r.kind,resourceId:r.resource_id,status:'review'});
  }
  return {findings,nextCursor:page.length===limit?page[page.length-1].resource_key:null};
}
