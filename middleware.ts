import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Fase 1: redirecionar para /login quando não houver usuário nas rotas do app.
  const { response } = await updateSession(request);
  return response;
}

export const config = {
  // Webhooks e arquivos estáticos ficam fora: não têm sessão de usuário.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
