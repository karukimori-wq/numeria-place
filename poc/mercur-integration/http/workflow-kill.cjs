// Runs the actual registered workflow in a disposable Medusa test process.
const {spawn}=require('node:child_process');
const {mkdtempSync,readFileSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,dirname}=require('node:path');
const {Pool}=require('pg');
const {completionDisposition}=require('../../src/providers/np-direct/completion-state.ts');
const {installRetryQueue,runDueReconciliation}=require('../../src/providers/np-direct/reconciliation-retry.ts');
const dir=mkdtempSync(join(tmpdir(),'np-workflow-kill-'));
const checkpoint=join(dir,'checkpoint.json');
(async()=>{
  if(process.env.NODE_ENV!=='test')throw Error('NP_TEST_ONLY');
  const jest=join(dirname(require.resolve('jest/package.json')),'bin/jest.js');
  const child=spawn(process.execPath,['--experimental-vm-modules','--max-old-space-size=6144',jest,'--runInBand','--forceExit','--runTestsByPath','http/np/np-source-checkout.spec.ts','--testNamePattern','real workflow SIGKILL checkpoint after group commit'],{stdio:'inherit',env:{...process.env,TEST_TYPE:'integration:http',NP_WORKFLOW_KILL:'1',NP_WORKFLOW_CHECKPOINT:checkpoint}});
  const timer=setTimeout(()=>child.kill('SIGKILL'),180000);
  const exit=await new Promise(resolve=>{child.once('error',e=>resolve({error:e}));child.once('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
  if(exit.signal!=='SIGKILL')throw Error('NP_EXPECTED_SIGKILL');
  const data=JSON.parse(readFileSync(checkpoint,'utf8'));
  if(!/^medusa-[a-z0-9-]+$/i.test(data.dbName))throw Error('NP_UNEXPECTED_TEST_DATABASE');
  const url=new URL(process.env.NP_POC_DATABASE_URL);
  if(!['localhost','127.0.0.1'].includes(url.hostname))throw Error('NP_LOCAL_ONLY');
  url.pathname='/'+data.dbName;
  const medusa=new Pool({connectionString:url.toString()});
  const np=new Pool({connectionString:process.env.NP_POC_DATABASE_URL});
  try{
    const groups=await medusa.query('SELECT id FROM order_group WHERE cart_id=$1',[data.cartId]);
    if(groups.rowCount!==1)throw Error('NP_COMMITTED_GROUP_MISSING');
    const cart=await medusa.query('SELECT completed_at FROM cart WHERE id=$1',[data.cartId]);
    // At least a persisted group exists. Even if concurrent order creation committed,
    // an unfinished cart must conservatively stop before another creation workflow.
    if(cart.rowCount!==1||cart.rows[0].completed_at)throw Error('NP_EXPECTED_INCOMPLETE_CART');
    if(completionDisposition(groups.rowCount,0,false)!=='review')throw Error('NP_PARTIAL_NOT_REVIEWED');
    const paid=await np.query('SELECT state FROM np_poc_b3_orders WHERE order_id=$1',[data.orderId]);
    if(paid.rows[0]?.state!=='paid')throw Error('NP_PAID_COMMIT_LOST');
    data.orderIds=(await medusa.query('SELECT id FROM "order" ORDER BY id')).rows.map(r=>r.id);
    writeFileSync(checkpoint,JSON.stringify(data),{mode:0o600});
    const recovery=spawn(process.execPath,['--experimental-vm-modules','--max-old-space-size=6144',jest,'--runInBand','--forceExit','--runTestsByPath','http/np/workflow-restart.spec.ts'],{stdio:'inherit',env:{...process.env,TEST_TYPE:'integration:http',MEDUSA_WORKER_MODE:'server',DATABASE_URL:url.toString(),NP_WORKFLOW_CHECKPOINT:checkpoint}});
    const recoveryTimer=setTimeout(()=>recovery.kill('SIGKILL'),180000);
    const recoveryCode=await new Promise(resolve=>{recovery.once('error',()=>resolve(-1));recovery.once('exit',code=>resolve(code));});clearTimeout(recoveryTimer);
    if(recoveryCode!==0)throw Error('NP_RESTART_RECONCILIATION_FAILED');
    console.log('PASS real workflow SIGKILL: committed group, incomplete cart, NP paid survives; restarted Medusa standard reconciliation enters review without new workflow.');
  }finally{await medusa.end();await np.end();}
})().catch(()=>{console.error('FAIL real workflow SIGKILL verification (details intentionally omitted)');process.exitCode=1;}).finally(()=>rmSync(dir,{recursive:true,force:true}));
