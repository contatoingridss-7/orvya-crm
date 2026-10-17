import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { emailConfigured } from "@/lib/email/send";
import { sendWeeklyReports } from "@/lib/reports/weekly";
import { createAdminClient } from "@/lib/supabase/admin";

// Relatório de tarefas por e-mail para gestores e administradores.
// Disparado pelo cron da Vercel todo sábado às 8h de Teresina (11h UTC, vercel.json).
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
  if (!emailConfigured()) return NextResponse.json({ erro: "E-mail não configurado (RESEND_API_KEY e EMAIL_FROM)." }, { status: 503 });
  try {
    const resultados = await sendWeeklyReports(createAdminClient());
    return NextResponse.json({ ok: resultados.every((r) => r.enviado), resultados });
  } catch {
    return NextResponse.json({ ok: false, erro: "Falha ao enviar os relatórios." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
