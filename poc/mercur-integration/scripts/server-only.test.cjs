const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const assert=require('node:assert/strict');
for(const mode of [undefined,'server','worker','shared','','unexpected']){
  const env={...process.env};delete env.MEDUSA_WORKER_MODE;
  if(mode!==undefined)env.MEDUSA_WORKER_MODE=mode;
  const code="const mode=require("+JSON.stringify(join(__dirname,'server-only.cjs'))+")(process.env);if(mode!=='server')process.exit(2)";
  const result=spawnSync(process.execPath,['-e',code],{env,encoding:'utf8'});
  if(mode===undefined||mode==='server')assert.equal(result.status,0);
  else {assert.notEqual(result.status,0);assert.match(result.stderr,/NP_POC_SERVER_MODE_REQUIRED/);}
}
console.log('PASS server-only startup policy: 6 fresh-process cases');
