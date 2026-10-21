import { createRequestHandler } from "react-router";
interface Env {}
const requestHandler = createRequestHandler(() => import("virtual:react-router/server-build"),import.meta.env.MODE);
export default {fetch(request:Request,env:Env,ctx:ExecutionContext){return requestHandler(request,{cloudflare:{env,ctx}});}} satisfies ExportedHandler<Env>;
