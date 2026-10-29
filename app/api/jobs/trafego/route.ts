import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncAllAdAccounts } from "@/lib/ads/sync";
import { createScheduledDrafts } from "@/lib/ads/traffic-report";
import { createAdminClient } from "@/lib/supabase/admin";

// Atualiza o tráfego pago (Meta e Google) de todas as contas: cron da Vercel de manhã e no início da tarde.
// Na rodada da manhã também cria os rascunhos dos relatórios (diário de ontem; semanal às segundas).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  const admin = createAdminClient();
  const resultados = await syncAllAdAccounts(admin);
  const tarde = request.nextUrl.searchParams.get("turno") === "tarde";
  const relatorios = tarde ? [] : await createScheduledDrafts(admin).catch(() => [{ empresa: "", tipo: "diario" as const, ok: false }]);
  return NextResponse.json({ ok: resultados.every((r) => r.ok) && relatorios.every((r) => r.ok), resultados, relatorios });
}

export const GET = handle;
export const POST = handle;
