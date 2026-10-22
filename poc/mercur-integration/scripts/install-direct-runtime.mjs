// Applies only to a disposable, exact-SHA upstream checkout.
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync,mkdirSync,cpSync} from "node:fs";
import {resolve,join} from "node:path";
const root=resolve(process.argv[2]), np=resolve(process.argv[3]);
if(execFileSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).trim()!=="9fe557067193e0ad4dd3b7fd37e212f0b352ab3c")throw Error("UNPINNED_MERCUR");
execFileSync(process.execPath,[join(np,"poc/mercur-integration/scripts/install-overlay.mjs"),root,np],{stdio:"inherit"});
execFileSync(process.execPath,[join(np,"poc/mercur-direct/scripts/apply-mercur-no-transfer-guard.mjs"),root],{stdio:"inherit"});
const dest=join(root,"integration-tests/src/providers/np-direct");
mkdirSync(dest,{recursive:true});
cpSync(join(np,"poc/mercur-integration/payment"),dest,{recursive:true});
cpSync(join(np,"poc/mercur-direct/src"),join(dest,"core"),{recursive:true});
cpSync(join(np,"poc/mercur-direct/db"),join(dest,"db"),{recursive:true});
const api=join(root,"integration-tests/src/api/hooks/np-direct");mkdirSync(api,{recursive:true});
cpSync(join(np,"poc/mercur-integration/api/route.ts"),join(api,"route.ts"));
cpSync(join(np,"poc/mercur-integration/api/middlewares.ts"),join(root,"integration-tests/src/api/middlewares.ts"));
cpSync(join(np,"poc/mercur-integration/http/np-direct-runtime.spec.ts"),join(root,"integration-tests/http/np/np-direct-runtime.spec.ts"));
const config=join(root,"integration-tests/medusa-config.ts");let s=readFileSync(config,"utf8");
s=s.replace("  modules: [",`  modules: [
    { resolve: '@medusajs/medusa/payment', options: {providers:[{
      resolve:'./src/providers/np-direct',id:'np-direct',options:{}
    }]}},`);writeFileSync(config,s);
const route=join(root,"packages/core/src/api/hooks/payment/[provider]/route.ts");
s=readFileSync(route,"utf8");
const anchor="    const { provider } = req.params";
if(!s.includes(anchor))throw Error("LEGACY_WEBHOOK_ANCHOR_CHANGED");
s=s.replace(anchor,anchor+`
    // NP dedicated synchronous endpoint owns the DB Inbox/Outbox transaction.
    if (provider === 'pp_numeria-direct_np-direct' || provider === 'numeria-direct_np-direct') {
      res.status(409).json({ code: 'NP_USE_DEDICATED_WEBHOOK' })
      return
    }
`);writeFileSync(route,s);
// Typecheck only NP integration surface against installed pinned Medusa/Mercur.
writeFileSync(join(root,"integration-tests/tsconfig.np.json"),JSON.stringify({compilerOptions:{
  target:"ES2022",module:"commonjs",moduleResolution:"node",esModuleInterop:true,
  skipLibCheck:true,strict:true,noEmit:true,types:["node","jest"]
},include:["src/providers/np-direct/**/*.ts","src/api/hooks/np-direct/route.ts","src/api/middlewares.ts"]},null,2));
console.log("Installed pinned Direct Payment provider, dedicated HTTP endpoint, legacy webhook exclusion and pre-write payout guard (test app only).");
