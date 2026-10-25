import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInstagramEvent, type IgWebhookPayload } from "@/lib/instagram/inbound";
import { appSecrets, verifyToken } from "@/lib/whatsapp/config";
import { processWebhookEvent } from "@/lib/whatsapp/inbound";
import type { WaWebhookPayload } from "@/lib/whatsapp/payload";
import { isValidSignatureAny } from "@/lib/whatsapp/signature";

// Precisa de node:crypto e não pode ser cacheada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verificação do webhook pela Meta (docs/WHATSAPP.md, seção 3).
 * O mesmo endereço recebe WhatsApp (object = whatsapp_business_account) e Instagram (object = instagram).
 */
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
  const secrets = appSecrets();
  if (!secrets.length) return new NextResponse("Webhook não configurado", { status: 503 });

  const raw = await request.text();
  if (!isValidSignatureAny(raw, request.headers.get("x-hub-signature-256"), secrets)) {
    // Registra só que houve recusa e de qual objeto (sem o conteúdo, LGPD), para achar chave faltando.
    let object = "desconhecido";
    try {
      object = String((JSON.parse(raw) as { object?: unknown }).object ?? "desconhecido");
    } catch {}
    await createAdminClient()
      .from("webhook_events")
      .insert({ source: "recusado", payload: { object, motivo: "assinatura inválida" }, processed_at: new Date().toISOString() });
    return new NextResponse("Assinatura inválida", { status: 401 });
  }

  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(raw) as WaWebhookPayload;
  } catch {
    return new NextResponse("Corpo inválido", { status: 400 });
  }

  const instagram = (payload as { object?: string }).object === "instagram";
  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from("webhook_events")
    .insert({ source: instagram ? "instagram" : "whatsapp", payload })
    .select("id")
    .single<{ id: number }>();
  // Sem gravar o evento, pedimos para a Meta reenviar depois.
  if (error || !event) return new NextResponse("Falha ao registrar", { status: 500 });

  after(async () => {
    try {
      if (instagram) await processInstagramEvent(admin, event.id, payload as IgWebhookPayload);
      else await processWebhookEvent(admin, event.id, payload);
    } catch (e) {
      // Não registra conteúdo de mensagem em log (LGPD): só o id do evento e o erro.
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("webhook_events").update({ error: message.slice(0, 2000) }).eq("id", event.id);
    }
  });

  return new NextResponse("OK", { status: 200 });
}
