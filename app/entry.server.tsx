import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";
export default async function handleRequest(request: Request, status: number, headers: Headers, context: EntryContext) {
  const stream = await renderToReadableStream(<ServerRouter context={context} url={request.url}/>, {signal:request.signal});
  headers.set("Content-Type","text/html; charset=utf-8");
  headers.set("Cache-Control","no-store");
  return new Response(stream,{status,headers});
}
