import { createRequestHandler, RouterContextProvider } from "react-router";
interface Env {}
const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);
export default {
  fetch(request: Request, _env: Env, _ctx: ExecutionContext) {
    // P1-A has no private bindings. Future typed service context must be added after its contract is approved.
    return requestHandler(request, new RouterContextProvider());
  },
} satisfies ExportedHandler<Env>;
