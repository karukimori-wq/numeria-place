// Independent storage/queue experiment. Orchestrator callback is synthetic.
const {createRequire}=require('node:module');
const {dirname,join}=require('node:path');
const {fork}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const medusaRequire=createRequire(require.resolve('@medusajs/medusa/package.json'));
const entry=medusaRequire.resolve('@medusajs/workflow-engine-redis');
const req=createRequire(entry);
const Redis=req('ioredis');
const {RedisDistributedTransactionStorage}=require(join(dirname(entry),'utils/workflow-orchestrator-storage.js'));
const url=new URL(process.env.REDIS_URL);
if(process.env.NODE_ENV!=='test'||!['localhost','127.0.0.1'].includes(url.hostname))throw Error('NP_LOCAL_TEST_REDIS_REQUIRED');
url.pathname='/14'; // isolated test database; never FLUSHDB
const prefix=process.env.NP_REDIS_PREFIX||'np-retry-'+randomUUID();
const connection=()=>new Redis(url.toString(),{maxRetriesPerRequest:null});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const ackCase=process.env.NP_REDIS_ACK_CASE==='1';
async function child(){
 const redis=connection(),worker=connection();
 await Promise.all([redis,worker].map(c=>c.status==='ready'?Promise.resolve():new Promise((resolve,reject)=>{c.once('ready',resolve);c.once('error',reject); })));
 const storage=new RedisDistributedTransactionStorage({workflowExecutionService:{delete:async()=>{}},redisConnection:redis,redisWorkerConnection:worker,redisQueueName:'np-retry',redisJobQueueName:'np-schedule',redisMainQueueOptions:{prefix},redisMainWorkerOptions:{prefix,...(ackCase?{lockDuration:1000,stalledInterval:500,maxStalledCount:1}:{})},redisJobQueueOptions:{prefix},redisJobWorkerOptions:{prefix},redisCleanerQueueOptions:{prefix},redisCleanerWorkerOptions:{prefix},logger:{debug(){},info(){},warn(){},error(){throw Error('NP_ENGINE_ERROR');}},isWorkerMode:process.argv[2].startsWith('consume')});
 storage.setWorkflowOrchestratorService({run:async(id,options)=>{
   assert.equal(id,'np-synthetic-retry');assert.equal(options.transactionId,'np-synthetic-transaction');
   if(ackCase){
     // One Redis script commits both identity receipt and synthetic effect.
     // This only models an effect in this same Redis transaction boundary.
     await redis.eval(`redis.call('INCR',KEYS[1]); if redis.call('HSETNX',KEYS[2],ARGV[1],1)==1 then redis.call('INCR',KEYS[3]) end; return 1`,3,prefix+':callbacks',prefix+':receipts',prefix+':effects',id+':'+options.transactionId);
     if(process.argv[2]==='consume-crash')process.kill(process.pid,'SIGKILL');
   }else await redis.incr(prefix+':callbacks');
 }});
 if(process.argv[2]==='produce'){
   await storage.scheduleRetry({modelId:'np-synthetic-retry',transactionId:'np-synthetic-transaction',getFlow:()=>({metadata:{}})},{id:'np-step',attempts:0,isCompensating:()=>false},Date.now(),2);
   process.send('persisted');await new Promise(()=>{});
 }else{
   await storage.onApplicationStart();process.send('started');await new Promise(()=>{});
 }
}
async function parent(){
 const redis=connection();const children=[];
 const launch=mode=>{const c=fork(__filename,[mode],{env:{...process.env,NP_REDIS_PREFIX:prefix},stdio:['ignore','inherit','inherit','ipc']});children.push(c);return c;};
 const message=(c,expected)=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('NP_CHILD_TIMEOUT')),30000);c.once('message',m=>{clearTimeout(t);m===expected?resolve():reject(Error('NP_BAD_CHECKPOINT'));});c.once('exit',()=>{clearTimeout(t);reject(Error('NP_EARLY_EXIT'));});});
 try{
   const producer=launch('produce');await message(producer,'persisted');
   const killed=new Promise(resolve=>producer.once('exit',(code,signal)=>resolve(signal)));producer.kill('SIGKILL');assert.equal(await killed,'SIGKILL');
   assert.equal(await redis.zcard(prefix+':np-retry:delayed'),1);
   assert.equal(await redis.get(prefix+':callbacks'),null);
   if(ackCase){
     const crash=launch('consume-crash');
     const signal=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('NP_CRASH_TIMEOUT')),30000);crash.once('exit',(code,signal)=>{clearTimeout(t);resolve(signal);});});
     assert.equal(signal,'SIGKILL');
     assert.equal(await redis.get(prefix+':callbacks'),'1');
     assert.equal(await redis.get(prefix+':effects'),'1');
     assert.equal(await redis.llen(prefix+':np-retry:active'),1);
   }
   const consumer=launch('consume');await message(consumer,'started');
   const deadline=Date.now()+30000;while(Number(await redis.get(prefix+':callbacks'))<(ackCase?2:1)&&Date.now()<deadline)await delay(100);
   assert.equal(await redis.get(prefix+':callbacks'),ackCase?'2':'1');
   await delay(1500);assert.equal(await redis.get(prefix+':callbacks'),ackCase?'2':'1');
   if(ackCase){
     assert.equal(await redis.get(prefix+':effects'),'1');
     assert.equal(await redis.hlen(prefix+':receipts'),1);
     assert.equal(await redis.llen(prefix+':np-retry:active'),0);
     assert.equal(await redis.zcard(prefix+':np-retry:failed'),0);
     console.log('PASS Redis callback-before-ack SIGKILL: natural stalled recovery redelivered twice; atomic synthetic effect once');
   }
   if(!ackCase)console.log('PASS Redis storage SIGKILL: delayed retry persisted; fresh worker dispatched original synthetic identity once in observation window');
 }finally{
   await Promise.all(children.filter(c=>c.exitCode===null&&c.signalCode===null).map(c=>new Promise(resolve=>{c.once('exit',resolve);c.kill('SIGKILL');})));
   let cursor='0';do{const result=await redis.scan(cursor,'MATCH',prefix+':*','COUNT',100);cursor=result[0];if(result[1].length)await redis.del(...result[1]);}while(cursor!=='0');await redis.quit();
 }
}
if(process.argv[2])child().catch(e=>{console.error('FAIL Redis storage child',e.name, String(e.message).includes('Custom Id cannot contain')?'INVALID_JOB_ID':String(e.message).includes('is not a function')?'INVALID_PINNED_INTERFACE':String(e.message).includes('maxRetriesPerRequest')?'REDIS_RETRY_OPTIONS':'UNCLASSIFIED');process.exit(1);});
else parent().catch(()=>{console.error('FAIL Redis storage process experiment');process.exitCode=1;});
