import { defineMiddlewares, authenticate } from "@medusajs/framework/http";
export default defineMiddlewares({routes:[{matcher:"/np-ops/retries/:order_id/requeue",method:["POST"],middlewares:[authenticate("user",["bearer"])]},{
  matcher:"/hooks/np-direct", method:["POST"],bodyParser:{preserveRawBody:true},middlewares:[]
},{matcher:"/np-checkout/:order_id",method:["POST"],middlewares:[authenticate("customer",["bearer","session"])]},{matcher:"/np-cart-checkout/:cart_id",method:["POST"],middlewares:[authenticate("customer",["bearer","session"])]}]});
