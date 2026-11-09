// CI-only overlay into pinned Mercur integration-tests.
// Fail closed if pinned upstream structure or config changes.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from "node:fs";
import {join,resolve} from "node:path";
const root=resolve(process.argv[2]||"mercur");
const np=resolve(process.argv[3]||"np");
const config=join(root,"integration-tests/medusa-config.ts");
let s=readFileSync(config,"utf8");
const anchor="  modules: [";
if(!s.includes(anchor)||!s.includes("module.exports = withMercur("))
  throw new Error("UPSTREAM_CONFIG_SHAPE_CHANGED");
const entry=`  modules: [
    {
      resolve: '@mercurjs/core/modules/payout',
      options: {
        providers: [{
          resolve: './src/providers/np-no-transfer',
          id: 'np-no-transfer',
          options: {
            apiKey: 'sk_test_OFFLINE_NOT_A_KEY',
            webhookSecret: 'whsec_OFFLINE_NOT_A_SECRET',
          },
        }],
      },
    },`;
if(s.includes("np-no-transfer"))throw new Error("DUPLICATE_PROVIDER_OVERLAY");
s=s.replace(anchor,entry);
writeFileSync(config,s);
const dest=join(root,"integration-tests/src/providers/np-no-transfer");
mkdirSync(dest,{recursive:true});
copyFileSync(join(np,"poc/mercur-integration/provider/index.ts"),join(dest,"index.ts"));
copyFileSync(join(np,"poc/mercur-direct/src/numeria-direct-no-transfer-provider.ts"),join(dest,"service.ts"));
const tests=join(root,"integration-tests/http/np");
mkdirSync(tests,{recursive:true});
copyFileSync(join(np,"poc/mercur-integration/http/np-no-transfer-payout.spec.ts"),join(tests,"np-no-transfer-payout.spec.ts"));
console.log("B3-05a: installed NP payout provider into pinned Mercur test config only");
