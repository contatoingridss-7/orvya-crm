import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncAllAdAccounts } from "@/lib/ads/sync";
import { createAdminClient } from "@/lib/supabase/admin";

// Atualiza o tráfego pago (Meta) de todas as contas: cron da Vercel de manhã e no início da tarde.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const a = Buffer.from(header ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ erro: "CRON_SECRET não configurado." }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ erro: "Não autorizado." }, { status: 401 });
  }
  const resultados = await syncAllAdAccounts(createAdminClient());
  return NextResponse.json({ ok: resultados.every((r) => r.ok), resultados });
}

export const GET = handle;
export const POST = handle;
