import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { GOOGLE_STATE_COOKIE as STATE_COOKIE, googleAuthUrl, googleConfigured } from "@/lib/ads/google";
import { getViewer } from "@/lib/auth/viewer";

// Início do login da Google para ler o Google Ads (só a administradora da plataforma).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("empresa") ?? "";
  const viewer = await getViewer();
  if (!viewer?.active || !viewer.isAdmin || !viewer.companies.some((c) => c.slug === slug)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL(`/${slug}/trafego?google=sem-config`, request.url));
  }

  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL("/api/google-ads/callback", request.url).toString();
  const res = NextResponse.redirect(googleAuthUrl(redirectUri, state));
  res.cookies.set(STATE_COOKIE, `${state}.${slug}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google-ads", maxAge: 600 });
  return res;
}
