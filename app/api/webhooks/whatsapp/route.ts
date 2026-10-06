import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appSecret, verifyToken } from "@/lib/whatsapp/config";
import { processWebhookEvent } from "@/lib/whatsapp/inbound";
import type { WaWebhookPayload } from "@/lib/whatsapp/payload";
import { isValidSignature } from "@/lib/whatsapp/signature";

// Precisa de node:crypto e não pode ser cacheada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificação do webhook pela Meta (docs/WHATSAPP.md, seção 3). */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const expected = verifyToken();
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Eventos da Meta: confere a assinatura, grava o corpo cru, responde 200 na hora
 * e processa em segundo plano (a Meta reenvia se a resposta demorar).
 */
export async function POST(request: NextRequest) {
  const secret = appSecret();
  if (!secret) return new NextResponse("Webhook não configurado", { status: 503 });

  const raw = await request.text();
  if (!isValidSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("Assinatura inválida", { status: 401 });
  }

  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(raw) as WaWebhookPayload;
  } catch {
    return new NextResponse("Corpo inválido", { status: 400 });
  }

  const admin = createAdminClient();
  const { data: event, error } = await admin.from("webhook_events").insert({ source: "whatsapp", payload }).select("id").single<{ id: number }>();
  // Sem gravar o evento, pedimos para a Meta reenviar depois.
  if (error || !event) return new NextResponse("Falha ao registrar", { status: 500 });

  after(async () => {
    try {
      await processWebhookEvent(admin, event.id, payload);
    } catch (e) {
      // Não registra conteúdo de mensagem em log (LGPD): só o id do evento e o erro.
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("webhook_events").update({ error: message.slice(0, 2000) }).eq("id", event.id);
    }
  });

  return new NextResponse("OK", { status: 200 });
}
