// Separate Jest process; intentionally no integration runner that recreates DBs.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {ContainerRegistrationKeys,Modules} from '@medusajs/framework/utils';
import {database,close,state} from '../../src/providers/np-direct/runtime';
import {reconcilePaidOrder,reconcileDuePaidOrders} from '../../src/providers/np-direct/completion';
const loaders=require('@medusajs/medusa/loaders/index');
const express=createRequire(require.resolve('@medusajs/medusa/package.json'))('express');
jest.setTimeout(180000);
it('restarts Medusa on surviving DB and standard reconciliation stops partial completion',async()=>{
  const data=JSON.parse(readFileSync(process.env.NP_WORKFLOW_CHECKPOINT!,'utf8'));
  const target=new URL(process.env.DATABASE_URL!);
  if(process.env.NODE_ENV!=='test'||!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/'+data.dbName)throw Error('NP_RESTART_TEST_DB_REQUIRED');
  await loaders.initializeContainer(process.cwd(),{skipDbConnection:true});
  const {container,shutdown}=await loaders.default({directory:process.cwd(),expressApp:express(),skipLoadingEntryPoints:true});
  expect(container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).projectConfig.workerMode).toBe('server');
  const pg=container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const engine=container.resolve(Modules.WORKFLOW_ENGINE);
  const run=jest.spyOn(engine,'run');
  try{
    // Pinned internal inspection: project only type labels, never dump services,
    // connection options, stored workflow payloads or storage map contents.
    const orchestrator=(engine as any).workflowOrchestratorService_;
    const storage=orchestrator?.inMemoryDistributedTransactionStorage_;
    expect(storage?.constructor?.name).toBe('InMemoryDistributedTransactionStorage');
    expect(orchestrator?.redisDistributedTransactionStorage_).toBeUndefined();
    const configured=container.resolve(ContainerRegistrationKeys.CONFIG_MODULE).modules[Modules.WORKFLOW_ENGINE];
    expect(configured.resolve).toBe('@medusajs/medusa/workflow-engine-inmemory');
    console.log('NP engine identity',JSON.stringify({boundary:data.boundary,mode:'server',module:'@medusajs/medusa/workflow-engine-inmemory',storage:'InMemoryDistributedTransactionStorage'}));
    expect((await pg.raw('SELECT current_database() AS name')).rows[0].name).toBe(data.dbName);
    const snapshot=async()=>({
      groups:await pg('order_group').where({cart_id:data.cartId}).select('id'),
      orders:await pg('order').select('id').orderBy('id'),
      sessions:await pg('payment_session').select('id').orderBy('id'),
      collections:await pg('payment_collection').select('id').orderBy('id'),
      payments:(await container.resolve(ContainerRegistrationKeys.QUERY).graph({entity:'order',fields:['id','payment_collections.payments.id','payment_collections.payments.captures.id'],filters:{id:data.orderIds}})).data,
      links:(await container.resolve(ContainerRegistrationKeys.QUERY).graph({entity:'order_cart',fields:['order.id'],filters:{cart_id:data.cartId}})).data,
    });
    // Read only execution identity/state metadata; never execution/context JSON.
    const executionMetadata=()=>pg('workflow_execution').where({workflow_id:'complete-cart-with-split-orders'}).whereNull('deleted_at').select('workflow_id','transaction_id','run_id','state').orderBy('transaction_id').orderBy('run_id');
    const storedBefore=await executionMetadata();
    // Project only pinned checkpoint step state fields in SQL. Never retrieve
    // step responses, inputs, context or arbitrary JSON into the test output.
    const stepMetadata=async()=> (await pg.raw(`SELECT step.key AS step_id,step.value->'invoke'->>'state' AS invoke_state,step.value->'compensate'->>'state' AS compensate_state
      FROM workflow_execution w CROSS JOIN LATERAL jsonb_each(CASE
        WHEN jsonb_typeof(w.execution->'steps')='object' THEN w.execution->'steps'
        WHEN jsonb_typeof(w.execution->'flow'->'steps')='object' THEN w.execution->'flow'->'steps'
        ELSE '{}'::jsonb END) step
      WHERE w.workflow_id=? AND w.deleted_at IS NULL ORDER BY w.transaction_id,w.run_id,step.key`,['complete-cart-with-split-orders'])).rows;
    const stepsBefore=await stepMetadata();

    const before=await snapshot();expect(before.orders.map((o:any)=>o.id)).toEqual(data.orderIds);expect(before.groups).toHaveLength(1);
    if(data.boundary!=="group")expect(before.orders).toHaveLength(1);
    expect(before.links).toHaveLength(["link","ack"].includes(data.boundary)?1:0);
    const completed=(await container.resolve(Modules.CART).retrieveCart(data.cartId)).completed_at;
    expect(!!completed).toBe(data.boundary==="ack");
    const ledger=()=>pg('np_poc_completion').where({cart_id:data.cartId}).first();
    expect((await ledger()).state).toBe('pending');
    if(data.boundary==="ack"){
      // The restarted offline transport has no memory. Refuse to finalize until
      // an explicit synthetic remote-state fixture is restored, never trust NP
      // paid or completed_at alone. This is not a real Stripe API retrieval.
      await expect(reconcilePaidOrder(data.orderId,container,true)).rejects.toThrow('UNKNOWN_OFFLINE_INTENT');
      expect((await ledger()).state).toBe('pending');
      const p=data.offlineIntent;
      expect(p?.status).toBe('succeeded');expect(p?.metadata?.np_order_id).toBe(data.orderId);
      state.intents.set(p.id,p);state.calls.length=0;
      const result=await reconcilePaidOrder(data.orderId,container,true);
      expect(result?.orderId).toBe(data.orderIds[0]);
      expect((await ledger()).state).toBe('completed');
      expect((await ledger()).medusa_order_id).toBe(data.orderIds[0]);
      expect(await reconcileDuePaidOrders(container)).toEqual([{orderId:data.orderId,status:'completed'}]);
      expect(await reconcileDuePaidOrders(container)).toEqual([]);
      expect(state.calls.length).toBeGreaterThan(0);
      expect(state.calls.every(call=>call.method==='retrieve'&&call.account==='acct_Source123')).toBe(true);
    }else{
      await expect(reconcilePaidOrder(data.orderId,container,true)).rejects.toThrow('NP_PARTIAL_COMPLETION_MANUAL_REVIEW');
      expect(await reconcileDuePaidOrders(container)).toEqual([{orderId:data.orderId,status:'review'}]);
      expect(await reconcileDuePaidOrders(container)).toEqual([]);
    }
    expect(run).not.toHaveBeenCalled();expect(await snapshot()).toEqual(before);
    expect(await executionMetadata()).toEqual(storedBefore);expect(await stepMetadata()).toEqual(stepsBefore);
    expect((await database().query('SELECT state,stop_reason FROM np_poc_retry_queue WHERE order_id=$1',[data.orderId])).rows).toEqual([{state:data.boundary==='ack'?'completed':'review',stop_reason:data.boundary==='ack'?null:'partial_completion'}]);
    // Inspect engine persistence availability without assuming that SIGKILL
    // synchronously flushed every engine step or that a workflow can resume.
    const engineTables=(await pg.raw("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%workflow%' ORDER BY table_name")).rows;
    console.log('NP restart inspection counts',JSON.stringify({boundary:data.boundary,groups:before.groups.length,orders:before.orders.length,cartOrderLinks:before.links.length,engineTables:engineTables.map((r:any)=>r.table_name),storedStepCount:stepsBefore.length,storedStepInvokingCount:stepsBefore.filter((s:any)=>s.invoke_state==="invoking").length,storedStepDoneCount:stepsBefore.filter((s:any)=>s.invoke_state==="done").length,storedExecutionCount:storedBefore.length,storedExecutionStates:storedBefore.map((r:any)=>r.state)}));
  }finally{run.mockRestore();await close();await shutdown();}
});
