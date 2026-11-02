import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Telas abertas sem login. /redefinir-senha recebe o usuário vindo do link do e-mail (convite ou recuperação);
// /apresentacao é a página de venda do Orvya; /r/ é o relatório de tráfego liberado para o cliente (acesso pelo token do link).
const PUBLIC_PATHS = ["/login", "/recuperar-senha", "/redefinir-senha", "/privacidade", "/apresentacao", "/auth/", "/r/", "/site/"];

// ver7ice.com.br mostra a página de Serviços da VÉR7ICE e ver7ice.com.br/links, o link da bio (arquivos estáticos em public/site). As telas do
// sistema abertas por esse endereço vão para o endereço do Orvya; privacidade e relatórios de cliente
// continuam abrindo nele (links já enviados e cadastro na Meta).
const SITE_HOSTS = ["ver7ice.com.br", "www.ver7ice.com.br"];
const SITE_KEEP = ["/privacidade", "/r/", "/site/", "/links"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = (request.headers.get("host") ?? "").split(":")[0]!.toLowerCase();

  if (SITE_HOSTS.includes(host)) {
    if (pathname === "/") return NextResponse.rewrite(new URL("/site/ver7ice.html", request.url));
    if (pathname === "/links") return NextResponse.rewrite(new URL("/site/links.html", request.url));
    if (!SITE_KEEP.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p))) {
      const app = process.env.NEXT_PUBLIC_APP_URL;
      if (app && new URL(app).host !== host) return NextResponse.redirect(new URL(pathname + search, app), 308);
    }
  }

  const { response, user } = await updateSession(request);

  // Visitante sem login na raiz do Orvya vê a apresentação; quem tem login vai para o sistema.
  if (!user && pathname === "/") return withCookies(NextResponse.rewrite(new URL("/apresentacao", request.url)), response);

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return withCookies(NextResponse.redirect(url), response);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return withCookies(NextResponse.redirect(url), response);
  }

  return response;
}

/** Leva junto os cookies de sessão renovados, senão o usuário perde o login no redirecionamento. */
function withCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export const config = {
  // Webhooks, jobs (protegidos por CRON_SECRET), formulário público e arquivos estáticos ficam fora: não têm sessão de usuário.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/jobs|api/public|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm)$).*)"],
};
