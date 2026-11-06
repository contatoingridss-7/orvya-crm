import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// A cada minuto no horário de atendimento (cron da Vercel, 8h às 18h de Teresina, segunda a sábado):
// distribui pelo rodízio os leads que ficaram sem dono (chegaram fora do horário ou com todos no almoço)
// e repassa o lead que o vendedor não respondeu no prazo dele (migration 0028).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const { data, error } = await createAdminClient().rpc("distribute_pending_leads");
  if (error) return NextResponse.json({ ok: false, erro: "Falha ao distribuir. A migration 0020 já foi rodada?" }, { status: 500 });
  const repasse = await createAdminClient().rpc("reassign_unanswered");
  return NextResponse.json({ ok: true, distribuidos: data ?? 0, repassados: repasse.error ? "migration 0028 pendente" : (repasse.data ?? 0) });
}

export const GET = handle;
export const POST = handle;
