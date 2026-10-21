import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import cssUrl from "./styles.css?url";
export const links = () => [{ rel: "stylesheet", href: cssUrl }];
export function Layout({children}:{children:ReactNode}) { return <html lang="ja"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow"/><Meta/><Links/></head><body>{children}<ScrollRestoration/><Scripts/></body></html>; }
export default function Root(){return <Outlet/>;}
export function ErrorBoundary(){return <main className="container"><h1>ページを表示できません</h1><p>架空データの画面デモです。</p><a href="/">トップへ戻る</a></main>;}
