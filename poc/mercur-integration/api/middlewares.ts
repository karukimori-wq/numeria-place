import { defineMiddlewares } from "@medusajs/framework/http";
export default defineMiddlewares({routes:[{
  matcher:"/hooks/np-direct", method:["POST"],bodyParser:{preserveRawBody:true},middlewares:[]
}]});
