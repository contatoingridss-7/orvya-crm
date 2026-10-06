import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { storeInboundMedia } from "./media";
import {
  describeMessage,
  extractTrackingCode,
  phoneCandidates,
  waTime,
  type TrackingCode,
  type WaChangeValue,
  type WaMessage,
  type WaStatus,
  type WaWebhookPayload,
} from "./payload";

type NumberRow = { id: string; company_id: string; default_pipeline_id: string | null };
type Ctx = { admin: SupabaseClient; number: NumberRow; token: string | null };

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Processa um evento já gravado em webhook_events (SPEC 5.1 e docs/WHATSAPP.md, seção 3).
 * Idempotente: a Meta pode reenviar o mesmo evento; cada mensagem entra uma vez (wa_message_id).
 */
export async function processWebhookEvent(admin: SupabaseClient, eventId: number, payload: WaWebhookPayload): Promise<void> {
  const errors: string[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      try {
        const ctx = await loadNumber(admin, value);
        if (!ctx) {
          errors.push(`Número não cadastrado no Orvya: ${value.metadata?.phone_number_id ?? "?"}`);
          continue;
        }
        switch (change.field) {
          case "messages":
            for (const m of value.messages ?? []) await safe(errors, () => handleInbound(ctx, value, m));
            for (const s of value.statuses ?? []) await safe(errors, () => handleStatus(ctx, s));
            break;
          case "smb_message_echoes":
            for (const m of value.message_echoes ?? []) await safe(errors, () => handleEcho(ctx, m));
            break;
          case "history":
            for (const chunk of value.history ?? [])
              for (const thread of chunk.threads ?? [])
                for (const m of thread.messages ?? []) await safe(errors, () => handleHistory(ctx, thread.id ?? "", m));
            break;
          default:
            // smb_app_state_sync e outros campos: guardados em webhook_events, sem ação por enquanto.
            break;
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  await admin
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString(), error: errors.length ? errors.join(" | ").slice(0, 2000) : null })
    .eq("id", eventId);
}

async function safe(errors: string[], fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
}

async function loadNumber(admin: SupabaseClient, value: WaChangeValue): Promise<Ctx | null> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return null;
  const { data: number } = await admin
    .from("whatsapp_numbers")
    .select("id, company_id, default_pipeline_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle<NumberRow>();
  if (!number) return null;
  const { data: cred } = await admin.from("whatsapp_credentials").select("access_token").eq("number_id", number.id).maybeSingle<{ access_token: string }>();
  return { admin, number, token: cred?.access_token ?? null };
}

// ---------------------------------------------------------------------
// Contato, conversa e lead
// ---------------------------------------------------------------------
async function findOrCreateContact(ctx: Ctx, waId: string, profileName: string | undefined): Promise<string> {
  const candidates = phoneCandidates(waId);
  const { data: found } = await ctx.admin
    .from("contacts")
    .select("id, name")
    .eq("company_id", ctx.number.company_id)
    .in("phone_e164", candidates)
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
  if (found) return found.id;

  const { data, error } = await ctx.admin
    .from("contacts")
    .insert({ company_id: ctx.number.company_id, name: profileName?.trim() || candidates[0]!, phone_e164: candidates[0] })
    .select("id")
    .single<{ id: string }>();
  if (data) return data.id;
  // Corrida com outro evento do mesmo contato: lê de novo.
  const { data: again } = await ctx.admin.from("contacts").select("id").eq("company_id", ctx.number.company_id).in("phone_e164", candidates).limit(1).maybeSingle<{ id: string }>();
  if (again) return again.id;
  throw new Error(`Não foi possível criar o contato: ${error?.message}`);
}

async function findOrCreateConversation(ctx: Ctx, contactId: string): Promise<{ id: string; lead_id: string | null; ai_enabled: boolean }> {
  const select = "id, lead_id, ai_enabled";
  const query = () =>
    ctx.admin
      .from("conversations")
      .select(select)
      .eq("company_id", ctx.number.company_id)
      .eq("contact_id", contactId)
      .eq("channel", "whatsapp")
      .eq("whatsapp_number_id", ctx.number.id)
      .maybeSingle<{ id: string; lead_id: string | null; ai_enabled: boolean }>();

  const { data: found } = await query();
  if (found) return found;
  const { data } = await ctx.admin
    .from("conversations")
    .insert({ company_id: ctx.number.company_id, contact_id: contactId, channel: "whatsapp", whatsapp_number_id: ctx.number.id })
    .select(select)
    .single<{ id: string; lead_id: string | null; ai_enabled: boolean }>();
  if (data) return data;
  const { data: again } = await query();
  if (again) return again;
  throw new Error("Não foi possível criar a conversa.");
}

/** Lead aberto do contato; se não houver, cria na primeira etapa do funil padrão do número, sem responsável. */
async function ensureOpenLead(
  ctx: Ctx,
  contactId: string,
  referral: Record<string, unknown> | undefined,
  tracking: TrackingCode | null,
): Promise<string | null> {
  const { data: open } = await ctx.admin
    .from("leads")
    .select("id")
    .eq("company_id", ctx.number.company_id)
    .eq("contact_id", contactId)
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (open) return open.id;

  let pipelineId = ctx.number.default_pipeline_id;
  if (!pipelineId) {
    const { data: p } = await ctx.admin.from("pipelines").select("id").eq("company_id", ctx.number.company_id).order("position").limit(1).maybeSingle<{ id: string }>();
    pipelineId = p?.id ?? null;
  }
  if (!pipelineId) return null;

  const { data: stage } = await ctx.admin
    .from("stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .eq("kind", "open")
    .order("position")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!stage) return null;

  // Anúncio de clique para o WhatsApp traz "referral" na primeira mensagem;
  // Google Ads e site são reconhecidos pelo código da mensagem pronta ([G1], [S1]).
  const sourceName = referral ? "Meta Ads" : (tracking?.source ?? "WhatsApp direto");
  const { data: source } = await ctx.admin
    .from("lead_sources")
    .select("id")
    .eq("company_id", ctx.number.company_id)
    .eq("name", sourceName)
    .maybeSingle<{ id: string }>();

  const { data: lead, error } = await ctx.admin
    .from("leads")
    .insert({
      company_id: ctx.number.company_id,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stage.id,
      owner_id: null,
      source_id: source?.id ?? null,
      ad_referral: referral ?? null,
      utm: tracking ? { codigo: tracking.code } : {},
      last_contact_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`Não foi possível criar o lead: ${error.message}`);
  return lead.id;
}

/** Grava a mensagem uma única vez (wa_message_id). Devolve o id se for nova, null se já existia. */
async function insertMessage(ctx: Ctx, row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("messages")
    .upsert({ company_id: ctx.number.company_id, ...row }, { onConflict: "wa_message_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Não foi possível gravar a mensagem: ${error.message}`);
  return (data as { id: string }[] | null)?.[0]?.id ?? null;
}

async function saveMedia(ctx: Ctx, mediaId: string | null, conversationId: string, messageId: string) {
  if (!mediaId || !ctx.token) return;
  await storeInboundMedia(ctx.admin, { mediaId, token: ctx.token, companyId: ctx.number.company_id, conversationId, messageId });
}

// ---------------------------------------------------------------------
// Tipos de evento
// ---------------------------------------------------------------------

/** Mensagem do cliente (SPEC 5.1). */
async function handleInbound(ctx: Ctx, value: WaChangeValue, m: WaMessage) {
  if (!m.id || !m.from) return;
  const profile = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
  const contactId = await findOrCreateContact(ctx, m.from, profile);
  const conversation = await findOrCreateConversation(ctx, contactId);
  const sentAt = waTime(m.timestamp);
  const described = describeMessage(m);
  const { mediaId } = described;
  const { clean: body, tracking } = m.type === "text" ? extractTrackingCode(described.body) : { clean: described.body, tracking: null };

  const messageId = await insertMessage(ctx, {
    conversation_id: conversation.id,
    direction: "in",
    sender: "contact",
    msg_type: m.type ?? "unknown",
    body,
    wa_message_id: m.id,
    status: "received",
    source: "orvya",
    sent_at: sentAt,
    reply_to_wa_id: m.context?.id ?? null,
  });
  if (!messageId) return; // evento repetido

  const leadId = await ensureOpenLead(ctx, contactId, m.referral, tracking);
  if (leadId) {
    await ctx.admin.from("leads").update({ last_contact_at: sentAt }).eq("id", leadId);
    if (conversation.lead_id !== leadId) await ctx.admin.from("conversations").update({ lead_id: leadId }).eq("id", conversation.id);
  }
  await ctx.admin.rpc("conversation_inbound", { p_conversation: conversation.id, p_at: sentAt });

  await saveMedia(ctx, mediaId, conversation.id, messageId);
  // Fase 4: aqui o agente de IA é acionado, se estiver ligado para a empresa e para a conversa.
}

/** Status de entrega das mensagens enviadas. Nunca regride (lido não volta para entregue). */
async function handleStatus(ctx: Ctx, s: WaStatus) {
  if (!s.id || !s.status) return;
  const { data: msg } = await ctx.admin.from("messages").select("id, status").eq("wa_message_id", s.id).maybeSingle<{ id: string; status: string }>();
  if (!msg) return;

  if (s.status === "failed") {
    await ctx.admin.from("messages").update({ status: "failed", error: s.errors ?? null }).eq("id", msg.id);
    return;
  }
  const next = STATUS_RANK[s.status];
  if (next === undefined || next <= (STATUS_RANK[msg.status] ?? -1)) return;
  await ctx.admin
    .from("messages")
    .update({ status: s.status, ...(s.pricing ? { pricing: s.pricing } : {}) })
    .eq("id", msg.id);
}

/**
 * Coexistência: mensagem que a equipe enviou pelo app WhatsApp Business no celular.
 * Conta como resposta humana: a IA pausa nessa conversa (CLAUDE.md, regra 8).
 */
async function handleEcho(ctx: Ctx, m: WaMessage) {
  if (!m.id || !m.to) return;
  const contactId = await findOrCreateContact(ctx, m.to, undefined);
  const conversation = await findOrCreateConversation(ctx, contactId);
  const sentAt = waTime(m.timestamp);
  const { body, mediaId } = describeMessage(m);

  const messageId = await insertMessage(ctx, {
    conversation_id: conversation.id,
    direction: "out",
    sender: "user",
    msg_type: m.type ?? "unknown",
    body,
    wa_message_id: m.id,
    status: "sent",
    source: "celular",
    sent_at: sentAt,
  });
  if (!messageId) return;

  await ctx.admin
    .from("conversations")
    .update({ ai_enabled: false, needs_human: false, last_message_at: sentAt })
    .eq("id", conversation.id);
  await saveMedia(ctx, mediaId, conversation.id, messageId);
}

/**
 * Coexistência: histórico do app importado na conexão (até 180 dias).
 * Cria contato e conversa, mas não cria lead: conversas antigas não devem lotar o funil.
 */
async function handleHistory(ctx: Ctx, threadWaId: string, m: WaMessage) {
  if (!m.id || !threadWaId) return;
  const contactId = await findOrCreateContact(ctx, threadWaId, undefined);
  const conversation = await findOrCreateConversation(ctx, contactId);
  const fromCustomer = m.from?.replace(/\D/g, "") === threadWaId.replace(/\D/g, "");
  const { body } = describeMessage(m);

  await insertMessage(ctx, {
    conversation_id: conversation.id,
    direction: fromCustomer ? "in" : "out",
    sender: fromCustomer ? "contact" : "user",
    msg_type: m.type ?? "unknown",
    body,
    wa_message_id: m.id,
    status: fromCustomer ? "received" : "read",
    source: "historico",
    sent_at: waTime(m.timestamp),
  });
  // Mídia do histórico não é baixada (a Meta só guarda 14 dias e o volume pode ser grande).
}
