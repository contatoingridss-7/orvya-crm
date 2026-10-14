import "server-only";

// Fila de envio (reativação em lote, SPEC 4.6): agenda e processa modelos aprovados
// com 2 a 6 minutos entre as mensagens. Processamento só com service_role (rota de job).

import { createAdminClient } from "@/lib/supabase/admin";
import { deliverTemplate, recordOutboundMessage, resolveDestination, SEND_CONVERSATION_SELECT, sendErrorMessage, type SendConversation } from "./send";
import { countParams } from "./templates";

export type QueueStatus = "pendente" | "enviando" | "enviado" | "falhou" | "cancelado";

const MINUTE = 60_000;
export const MIN_GAP_MS = 2 * MINUTE;
export const MAX_GAP_MS = 6 * MINUTE;
const FIRST_DELAY_MS = MINUTE;
/** Item preso em "enviando" há mais que isso: a execução caiu no meio. */
const STUCK_MS = 10 * MINUTE;

function randomGap(): number {
  return MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS + 1));
}

/**
 * Horários dos envios: o primeiro em ~1 minuto (ou depois do último já agendado da empresa)
 * e os seguintes com intervalo aleatório de 2 a 6 minutos.
 */
export function spacedSchedule(count: number, lastScheduled: Date | null, now = Date.now()): Date[] {
  let t = Math.max(now + FIRST_DELAY_MS, lastScheduled ? lastScheduled.getTime() + randomGap() : 0);
  const out: Date[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) t += randomGap();
    out.push(new Date(t));
  }
  return out;
}

type QueueItem = {
  id: string;
  company_id: string;
  conversation_id: string;
  lead_id: string | null;
  template_id: string;
  params: string[];
  created_by: string | null;
  created_at: string;
};

type Outcome = { status: "enviado" | "falhou" | "cancelado"; error: string | null; messageId?: string | null };

type TemplateRow = { name: string; language: string; body: string; status: string; variables: string[] | null; company_id: string };

async function processItem(item: QueueItem): Promise<Outcome> {
  const admin = createAdminClient();

  const { data: conv } = await admin
    .from("conversations")
    .select(SEND_CONVERSATION_SELECT)
    .eq("id", item.conversation_id)
    .eq("company_id", item.company_id)
    .maybeSingle<SendConversation>();
  if (!conv) return { status: "falhou", error: "A conversa não existe mais." };

  // O cliente escreveu depois do agendamento: a equipe responde na conversa, sem modelo.
  if (conv.last_inbound_at && new Date(conv.last_inbound_at) > new Date(item.created_at)) {
    return { status: "cancelado", error: "O cliente já respondeu." };
  }
  if (item.lead_id) {
    const { data: lead } = await admin.from("leads").select("closed_at").eq("id", item.lead_id).maybeSingle<{ closed_at: string | null }>();
    if (!lead) return { status: "cancelado", error: "O lead foi excluído." };
    if (lead.closed_at) return { status: "cancelado", error: "O lead foi fechado." };
  }

  const { data: tpl } = await admin
    .from("message_templates")
    .select("name, language, body, status, variables, company_id")
    .eq("id", item.template_id)
    .maybeSingle<TemplateRow>();
  if (!tpl || tpl.company_id !== item.company_id) return { status: "falhou", error: "O modelo não foi encontrado." };
  if (tpl.status !== "approved") return { status: "falhou", error: "O modelo não está mais aprovado pela Meta." };
  if (item.params.length !== countParams(tpl.body) || item.params.some((v) => !v.trim())) {
    return { status: "falhou", error: "Os campos do modelo não estão completos." };
  }

  const dest = await resolveDestination(conv);
  if (!dest.ok) return { status: "falhou", error: dest.error };

  let sent: { wamid: string; body: string };
  try {
    sent = await deliverTemplate(dest.d, tpl, item.params);
  } catch (e) {
    return { status: "falhou", error: sendErrorMessage(e) };
  }

  const rec = await recordOutboundMessage(conv, { wamid: sent.wamid, body: sent.body, msgType: "template", templateName: tpl.name }, item.created_by, {
    preferLeadOwner: true,
  });
  if (!rec.ok) return { status: "enviado", error: "Enviada, mas não ficou registrada na conversa.", messageId: null };
  return { status: "enviado", error: null, messageId: rec.messageId };
}

export type QueueRunResult = { pegos: number; enviados: number; falhas: number; cancelados: number; interrompidos: number };

/** Processa até `limit` itens vencidos. Seguro para rodar em paralelo (claim atômico no banco). */
export async function processOutboundQueue(limit = 10): Promise<QueueRunResult> {
  const admin = createAdminClient();
  const result: QueueRunResult = { pegos: 0, enviados: 0, falhas: 0, cancelados: 0, interrompidos: 0 };

  // Execução anterior caiu no meio do envio: não reenvia às cegas (poderia duplicar a mensagem).
  const { data: stuck } = await admin
    .from("outbound_queue")
    .update({ status: "falhou", error: "O envio foi interrompido. Confira a conversa antes de tentar de novo." })
    .eq("status", "enviando")
    .lt("locked_at", new Date(Date.now() - STUCK_MS).toISOString())
    .select("id");
  result.interrompidos = stuck?.length ?? 0;

  const { data, error } = await admin.rpc("claim_outbound_queue", { p_limit: limit });
  if (error) throw new Error("Não foi possível ler a fila de envio.");
  const items = (Array.isArray(data) ? data : []) as QueueItem[];

  for (const item of items) {
    result.pegos++;
    let outcome: Outcome;
    try {
      outcome = await processItem(item);
    } catch {
      outcome = { status: "falhou", error: "Erro inesperado no envio." };
    }
    await admin
      .from("outbound_queue")
      .update({ status: outcome.status, error: outcome.error, sent_message_id: outcome.messageId ?? null })
      .eq("id", item.id)
      .eq("status", "enviando");
    if (outcome.status === "enviado") result.enviados++;
    else if (outcome.status === "falhou") result.falhas++;
    else result.cancelados++;
  }
  return result;
}
