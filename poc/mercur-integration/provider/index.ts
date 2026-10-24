// B3-05a: Mercur's real moduleProviderLoader registration in an isolated test app.
// Never register upstream payout-stripe-connect together with this provider.
import { ModuleProvider } from "@medusajs/framework/utils";
import { MercurModules } from "@mercurjs/types";
import { NumeriaDirectNoTransferProvider } from "./service";

export default ModuleProvider(MercurModules.PAYOUT, {
  services: [NumeriaDirectNoTransferProvider],
});
