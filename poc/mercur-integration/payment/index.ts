import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import Service from "./service";
export default ModuleProvider(Modules.PAYMENT, { services: [Service] });
