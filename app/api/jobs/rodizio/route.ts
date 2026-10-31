import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Abertura do expediente (cron da Vercel, 8h05 de Teresina, segunda a sábado): distribui pelo
// rodízio os leads que chegaram fora do horário e ficaram sem dono.
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
  return NextResponse.json({ ok: true, distribuidos: data ?? 0 });
}

export const GET = handle;
export const POST = handle;
