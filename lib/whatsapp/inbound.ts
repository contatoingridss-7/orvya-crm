import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fillAfterHours, isOpen, parseHours } from "./after-hours";
import { sendTextMessage } from "./graph";
import { storeInboundMedia } from "./media";
import { mapMetaStatus } from "./templates";
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

type NumberRow = { id: string; company_id: string; default_pipeline_id: string | null; phone_number_id: string };
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
        // Eventos de modelo vêm da conta (WABA), sem metadata.phone_number_id: tratar antes de loadNumber.
        if (change.field === "message_template_status_update" || change.field === "template_category_update") {
          await handleTemplateUpdate(admin, entry.id ?? null, change.field, value);
          continue;
        }
        if (change.field === "account_update") {
          await handleAccountUpdate(admin, entry.id ?? null, value);
          continue;
        }
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
          case "smb_app_state_sync":
            for (const s of value.state_sync ?? []) await safe(errors, () => handleContactSync(ctx, s));
            break;
          default:
            // Outros campos: guardados em webhook_events, sem ação.
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

// ---------------------------------------------------------------------
// Modelos de mensagem (status e categoria decididos pela Meta)
// ---------------------------------------------------------------------
async function handleTemplateUpdate(admin: SupabaseClient, wabaId: string | null, field: string, value: WaChangeValue): Promise<void> {
  const metaId = value.message_template_id != null ? String(value.message_template_id) : null;
  let patch: Record<string, unknown>;
  if (field === "template_category_update") {
    const category = (["MARKETING", "UTILITY", "AUTHENTICATION"] as const).find((c) => c === value.new_category?.toUpperCase());
    if (!category) return;
    patch = { category };
  } else {
    const status = mapMetaStatus(value.event);
    if (!status) return; // FLAGGED, LIMIT_EXCEEDED etc.: sem mudança de status no Orvya
    const reason = value.reason && value.reason !== "NONE" ? value.reason : null;
    patch = { status, rejected_reason: status === "rejected" ? reason : null };
  }

  if (metaId) {
    const { data } = await admin.from("message_templates").update(patch).eq("meta_template_id", metaId).select("id");
    if (data?.length) return;
  }
  // Modelo criado direto na Meta (ou id não gravado): procura pelo nome nas empresas dessa conta.
  if (!wabaId || !value.message_template_name) return;
  const { data: numbers } = await admin.from("whatsapp_numbers").select("company_id").eq("waba_id", wabaId).returns<{ company_id: string }[]>();
  const companies = [...new Set((numbers ?? []).map((n) => n.company_id))];
  if (!companies.length) return;
  await admin
    .from("message_templates")
    .update({ ...patch, ...(metaId ? { meta_template_id: metaId } : {}) })
    .in("company_id", companies)
    .eq("name", value.message_template_name)
    .eq("language", value.message_template_language ?? "pt_BR");
}

async function loadNumber(admin: SupabaseClient, value: WaChangeValue): Promise<Ctx | null> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return null;
  const { data: number } = await admin
    .from("whatsapp_numbers")
    .select("id, company_id, default_pipeline_id, phone_number_id")
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
  const { error: rpcError } = await ctx.admin.rpc("conversation_inbound", { p_conversation: conversation.id, p_at: sentAt, p_preview: body });
  // Banco ainda sem a migration 0007 (função de 2 parâmetros).
  if (rpcError) await ctx.admin.rpc("conversation_inbound", { p_conversation: conversation.id, p_at: sentAt });

  await saveMedia(ctx, mediaId, conversation.id, messageId);
  // Falha na resposta automática não pode impedir o registro da mensagem do cliente.
  await afterHoursReply(ctx, conversation.id, m.from, sentAt).catch(() => undefined);
  // Fase 4: aqui o agente de IA é acionado, se estiver ligado para a empresa e para a conversa.
}

/**
 * Fora do horário de atendimento: responde uma vez com o horário e quando a equipe volta.
 * Vai dentro da janela de 24 h (sem custo, sem modelo). Não muda a última direção da conversa:
 * ela continua em "Precisa de mim" para a equipe responder quando abrir.
 */
async function afterHoursReply(ctx: Ctx, conversationId: string, to: string, sentAt: string) {
  if (!ctx.token) return;
  const at = new Date(sentAt);
  // Evento atrasado ou reenviado pela Meta: não responde mensagem antiga.
  if (Date.now() - at.getTime() > 30 * 60_000) return;
  const { data: cfg } = await ctx.admin
    .from("whatsapp_after_hours")
    .select("enabled, hours, message")
    .eq("company_id", ctx.number.company_id)
    .maybeSingle<{ enabled: boolean; hours: unknown; message: string }>();
  if (!cfg?.enabled) return;
  const hours = parseHours(cfg.hours);
  if (isOpen(hours, at)) return;

  // Uma vez a cada 12 horas por conversa, e nunca se alguém da equipe respondeu na última hora (está atendendo).
  const [{ count: replied }, { count: teamActive }] = await Promise.all([
    ctx.admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("sender", "system")
      .eq("msg_type", "after_hours")
      .gte("sent_at", new Date(Date.now() - 12 * 3600_000).toISOString()),
    ctx.admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("direction", "out")
      .eq("sender", "user")
      .gte("sent_at", new Date(Date.now() - 3600_000).toISOString()),
  ]);
  if (replied || teamActive) return;

  const body = fillAfterHours(cfg.message, hours, at);
  const wamid = await sendTextMessage(ctx.number.phone_number_id, ctx.token, to, body);
  await insertMessage(ctx, {
    conversation_id: conversationId,
    direction: "out",
    sender: "system",
    msg_type: "after_hours",
    body,
    wa_message_id: wamid,
    status: "sent",
    source: "orvya",
    sent_at: new Date().toISOString(),
  });
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
 * Coexistência: contatos do app WhatsApp Business (sincronização inicial e mudanças depois).
 * Só cria quem ainda não existe; não apaga nem renomeia contatos do Orvya.
 */
async function handleContactSync(ctx: Ctx, s: NonNullable<WaChangeValue["state_sync"]>[number]) {
  const phone = s.contact?.phone_number?.replace(/\D/g, "");
  if (s.type !== "contact" || s.action !== "add" || !phone) return;
  await findOrCreateContact(ctx, phone, s.contact?.full_name || s.contact?.first_name);
}

/**
 * Coexistência: a empresa desconectou o Orvya pelo app (ou a Meta desligou a conta).
 * O número fica "Com erro" em Canais até ser conectado de novo; a reconexão volta a "Conectado".
 */
async function handleAccountUpdate(admin: SupabaseClient, wabaId: string | null, value: WaChangeValue): Promise<void> {
  const off = value.event === "PARTNER_REMOVED" || value.event === "ACCOUNT_OFFBOARDED";
  const back = value.event === "ACCOUNT_RECONNECTED";
  if (!wabaId || (!off && !back)) return;
  const { data } = await admin
    .from("whatsapp_numbers")
    .select("id, display_phone")
    .eq("waba_id", wabaId)
    .returns<{ id: string; display_phone: string | null }[]>();
  const digits = value.phone_number?.replace(/\D/g, "");
  const ids = (data ?? []).filter((n) => !digits || n.display_phone?.replace(/\D/g, "") === digits).map((n) => n.id);
  if (ids.length) await admin.from("whatsapp_numbers").update({ status: off ? "error" : "connected" }).in("id", ids);
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

  const { error: convError } = await ctx.admin
    .from("conversations")
    .update({ ai_enabled: false, needs_human: false, last_message_at: sentAt, last_preview: body.slice(0, 160), last_direction: "out" })
    .eq("id", conversation.id);
  if (convError) {
    await ctx.admin.from("conversations").update({ ai_enabled: false, needs_human: false, last_message_at: sentAt }).eq("id", conversation.id);
  }
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
