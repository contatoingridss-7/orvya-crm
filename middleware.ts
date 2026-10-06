import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Telas abertas sem login. /redefinir-senha recebe o usuário vindo do link do e-mail (convite ou recuperação).
const PUBLIC_PATHS = ["/login", "/recuperar-senha", "/redefinir-senha", "/auth/"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

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
  // Webhooks, formulário público e arquivos estáticos ficam fora: não têm sessão de usuário.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/public|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
