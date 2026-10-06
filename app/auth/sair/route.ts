import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const motivo = request.nextUrl.searchParams.get("motivo");
  const target = motivo === "desativado" ? "/login?erro=desativado" : "/login";
  // 303: depois de um POST, o navegador segue com GET.
  return NextResponse.redirect(new URL(target, request.nextUrl.origin), { status: 303 });
}

// POST: botão "Sair". GET: usado pelo servidor quando a conta foi desativada.
export const POST = signOut;
export const GET = signOut;
