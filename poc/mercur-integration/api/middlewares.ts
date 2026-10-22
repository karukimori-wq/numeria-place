import { defineMiddlewares, authenticate } from "@medusajs/framework/http";
export default defineMiddlewares({routes:[{
  matcher:"/hooks/np-direct", method:["POST"],bodyParser:{preserveRawBody:true},middlewares:[]
},{matcher:"/np-checkout/:order_id",method:["POST"],middlewares:[authenticate("customer",["bearer","session"])]}]});
