import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { processOutboundQueue } from "@/lib/whatsapp/queue";

// Fila de envio (reativação em lote). Chamada a cada minuto pelo pg_cron do Supabase
// (supabase/exemplos/agendar_fila_envio.sql) e uma vez por dia pelo cron da Vercel (vercel.json).
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
  try {
    const r = await processOutboundQueue(10);
    return NextResponse.json({ ok: true, ...r });
  } catch {
    return NextResponse.json({ ok: false, erro: "Falha ao processar a fila de envio." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
