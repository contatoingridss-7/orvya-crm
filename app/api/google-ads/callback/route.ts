import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, GOOGLE_STATE_COOKIE as STATE_COOKIE } from "@/lib/ads/google";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";

// Volta do login da Google: guarda o acesso (só no servidor) e leva para a escolha da conta no Tráfego.
export const dynamic = "force-dynamic";

function sameState(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const [savedState = "", slug = ""] = (request.cookies.get(STATE_COOKIE)?.value ?? "").split(".");
  const back = (google: string) => {
    const res = NextResponse.redirect(new URL(slug ? `/${slug}/trafego?google=${google}` : "/", request.url));
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/google-ads" });
    return res;
  };

  const viewer = await getViewer();
  if (!viewer?.active || !viewer.isAdmin || !slug || !viewer.companies.some((c) => c.slug === slug)) return back("erro");
  if (!savedState || !sameState(savedState, params.get("state") ?? "")) return back("erro");
  if (params.get("error")) return back("cancelado");
  const code = params.get("code");
  if (!code) return back("erro");

  try {
    const refreshToken = await exchangeCode(code, new URL("/api/google-ads/callback", request.url).toString());
    const admin = createAdminClient();
    // Um acesso pendente por pessoa: o anterior (se houver) é descartado.
    await admin.from("ad_oauth_grants").delete().eq("created_by", viewer.id);
    const { data, error } = await admin
      .from("ad_oauth_grants")
      .insert({ platform: "google", refresh_token: refreshToken, created_by: viewer.id })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) return back("erro");
    return back(data.id);
  } catch {
    return back("erro");
  }
}
