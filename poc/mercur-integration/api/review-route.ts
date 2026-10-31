import type {MedusaRequest,MedusaResponse} from "@medusajs/framework/http";
import {readFileSync} from "node:fs";
import {join} from "node:path";
export const GET=async(_req:MedusaRequest,res:MedusaResponse)=>{
  res.setHeader("Cache-Control","no-store");
  if(process.env.NODE_ENV!=="test"){res.status(404).end();return;}
  res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.type("html").send(readFileSync(join(process.cwd(),"src/api/np-ops/review/screen.html"),"utf8"));
};
