// A real Node 24 child with its own pg pool. No Medusa/Stripe transport in this harness.
const {Pool}=require('pg');
const {runDueReconciliation}=require('../../src/providers/np-direct/reconciliation-retry.ts');
const url=process.env.NP_POC_DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('NP_DISPOSABLE_LOCAL_TEST_DB_REQUIRED');
const db=new Pool({connectionString:url,max:2});
(async()=>{
  const result=await runDueReconciliation(db,async()=>{
    // This message is emitted only after the queue claim has committed.
    await new Promise(resolve=>{process.once('message',resolve);process.send({phase:'claimed'});});
  },1);
  process.send({phase:'finished',result});
  await db.end();process.disconnect();
})().catch(async()=>{process.send?.({phase:'failed'});await db.end();process.exitCode=1;process.disconnect();});
