// Separate Jest process; intentionally no integration runner that recreates DBs.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {ContainerRegistrationKeys,Modules} from '@medusajs/framework/utils';
import {database,close} from '../../src/providers/np-direct/runtime';
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
  const pg=container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const engine=container.resolve(Modules.WORKFLOW_ENGINE);
  const run=jest.spyOn(engine,'run');
  try{
    expect((await pg.raw('SELECT current_database() AS name')).rows[0].name).toBe(data.dbName);
    const snapshot=async()=>({
      groups:await pg('order_group').where({cart_id:data.cartId}).select('id'),
      orders:await pg('order').select('id').orderBy('id'),
      links:(await container.resolve(ContainerRegistrationKeys.QUERY).graph({entity:'order_cart',fields:['order.id'],filters:{cart_id:data.cartId}})).data,
    });
    const before=await snapshot();expect(before.orders.map((o:any)=>o.id)).toEqual(data.orderIds);expect(before.groups).toHaveLength(1);
    expect((await container.resolve(Modules.CART).retrieveCart(data.cartId)).completed_at).toBeNull();
    await expect(reconcilePaidOrder(data.orderId,container,true)).rejects.toThrow('NP_PARTIAL_COMPLETION_MANUAL_REVIEW');
    expect(await reconcileDuePaidOrders(container)).toEqual([{orderId:data.orderId,status:'review'}]);
    expect(await reconcileDuePaidOrders(container)).toEqual([]);
    expect(run).not.toHaveBeenCalled();expect(await snapshot()).toEqual(before);
    expect((await database().query('SELECT state,stop_reason FROM np_poc_retry_queue WHERE order_id=$1',[data.orderId])).rows).toEqual([{state:'review',stop_reason:'partial_completion'}]);
    // Inspect engine persistence availability without assuming that SIGKILL
    // synchronously flushed every engine step or that a workflow can resume.
    const engineTables=(await pg.raw("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%workflow%' ORDER BY table_name")).rows;
    console.log('NP restart inspection counts',JSON.stringify({groups:before.groups.length,orders:before.orders.length,cartOrderLinks:before.links.length,engineTables:engineTables.map((r:any)=>r.table_name)}));
  }finally{run.mockRestore();await close();await shutdown();}
});
