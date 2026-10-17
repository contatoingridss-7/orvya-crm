import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Automações "parado na etapa". O pg_cron do Supabase roda de hora em hora (migration 0010);
// este endpoint é a rede de segurança diária do cron da Vercel (vercel.json).
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
  const { data, error } = await createAdminClient().rpc("run_stale_automations");
  if (error) return NextResponse.json({ ok: false, erro: "Falha ao rodar as automações." }, { status: 500 });
  return NextResponse.json({ ok: true, tarefasCriadas: data });
}

export const GET = handle;
export const POST = handle;
