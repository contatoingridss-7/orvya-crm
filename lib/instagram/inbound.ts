import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchIgProfile, sendDirectText, sendPrivateReply } from "./graph";
import { fillLinkReply, menuChoice, menuQuickReplies, whatsappLink } from "./menu";

// Eventos do Instagram (object = "instagram") já gravados em webhook_events.
// Idempotente: cada mensagem entra uma vez (messages.wa_message_id guarda o "mid").

type Attachment = { type?: string; payload?: { url?: string } };
type IgMessage = {
  mid?: string;
  text?: string;
  attachments?: Attachment[];
  is_echo?: boolean;
  is_deleted?: boolean;
  is_unsupported?: boolean;
  referral?: IgReferral;
  quick_reply?: { payload?: string };
};
type IgReferral = { ad_id?: string; source?: string; type?: string; ref?: string; ads_context_data?: Record<string, unknown> };
type IgMessaging = { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: IgMessage; referral?: IgReferral };
type IgComment = { id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string } };
export type IgWebhookPayload = {
  object?: string;
  entry?: { id?: string; time?: number; messaging?: IgMessaging[]; changes?: { field?: string; value?: IgComment }[] }[];
};

type Account = { id: string; company_id: string; ig_user_id: string; page_id: string; default_pipeline_id: string | null };
type Ctx = { admin: SupabaseClient; account: Account; token: string };
type Rule = { id: string; trigger: "welcome" | "dm_keyword" | "comment_keyword"; keywords: string[]; reply: string };
/** Menu de boas-vindas pronto para usar (só existe se ligado e com número de WhatsApp conectado). */
type Menu = { intro: string; options: string[]; linkReply: string; phone: string };

const MEDIA_LABEL: Record<string, string> = {
  image: "[Foto]",
  video: "[Vídeo]",
  audio: "[Áudio]",
  file: "[Arquivo]",
  share: "[Publicação compartilhada]",
  story_mention: "[Menção nos stories]",
  ig_reel: "[Reels]",
  reel: "[Reels]",
  ephemeral: "[Mídia temporária]",
};

/** Sem acento e em minúsculas, para comparar palavras-chave. */
export const normalizeText = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function matchRule(rules: Rule[], trigger: Rule["trigger"], text: string): Rule | undefined {
  const t = normalizeText(text);
  return rules.find((r) => r.trigger === trigger && (r.keywords.includes("*") || r.keywords.some((k) => k && t.includes(normalizeText(k)))));
}

export async function processInstagramEvent(admin: SupabaseClient, eventId: number, payload: IgWebhookPayload): Promise<void> {
  const errors: string[] = [];
  for (const entry of payload.entry ?? []) {
    try {
      const ctx = await loadAccount(admin, entry.id ?? "");
      if (!ctx) {
        errors.push(`Conta do Instagram não cadastrada no Orvya: ${entry.id ?? "?"}`);
        continue;
      }
      const [rules, menu] = await Promise.all([loadRules(ctx), loadMenu(ctx)]);
      for (const m of entry.messaging ?? []) await safe(errors, () => handleMessaging(ctx, rules, menu, m));
      for (const ch of entry.changes ?? []) {
        if (ch.field === "comments" && ch.value) await safe(errors, () => handleComment(ctx, rules, ch.value!));
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
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

async function loadAccount(admin: SupabaseClient, igUserId: string): Promise<Ctx | null> {
  if (!igUserId) return null;
  const { data: account } = await admin
    .from("instagram_accounts")
    .select("id, company_id, ig_user_id, page_id, default_pipeline_id")
    .or(`ig_user_id.eq.${igUserId},page_id.eq.${igUserId}`)
    .eq("status", "connected")
    .maybeSingle<Account>();
  if (!account) return null;
  const { data: cred } = await admin.from("instagram_credentials").select("page_access_token").eq("account_id", account.id).maybeSingle<{ page_access_token: string }>();
  if (!cred) return null;
  return { admin, account, token: cred.page_access_token };
}

async function loadRules(ctx: Ctx): Promise<Rule[]> {
  const { data } = await ctx.admin
    .from("ig_auto_replies")
    .select("id, trigger, keywords, reply")
    .eq("company_id", ctx.account.company_id)
    .eq("active", true)
    .order("position")
    .returns<Rule[]>();
  return data ?? [];
}

type MenuRow = { enabled: boolean; intro: string; options: string[]; link_reply: string; whatsapp_number_id: string | null };
type NumberRow = { id: string; display_phone: string | null; status: string; slot: number };

/** Menu ligado + número de WhatsApp do link: o escolhido ou o primeiro número brasileiro conectado. */
async function loadMenu(ctx: Ctx): Promise<Menu | null> {
  const [{ data: menu }, { data: numbers }] = await Promise.all([
    ctx.admin
      .from("ig_welcome_menu")
      .select("enabled, intro, options, link_reply, whatsapp_number_id")
      .eq("company_id", ctx.account.company_id)
      .maybeSingle<MenuRow>(),
    ctx.admin.from("whatsapp_numbers").select("id, display_phone, status, slot").eq("company_id", ctx.account.company_id).order("slot").returns<NumberRow[]>(),
  ]);
  if (!menu?.enabled) return null;
  const connected = (numbers ?? []).filter((n) => n.status === "connected" && n.display_phone);
  const number = connected.find((n) => n.id === menu.whatsapp_number_id) ?? connected.find((n) => n.display_phone!.replace(/\D/g, "").startsWith("55"));
  if (!number?.display_phone) return null;
  return { intro: menu.intro, options: menu.options, linkReply: menu.link_reply, phone: number.display_phone };
}

// ---------------------------------------------------------------------
// Contato, conversa e lead
// ---------------------------------------------------------------------
async function findOrCreateContact(ctx: Ctx, igsid: string): Promise<{ id: string; created: boolean }> {
  const find = () =>
    ctx.admin.from("contacts").select("id").eq("company_id", ctx.account.company_id).eq("instagram_id", igsid).maybeSingle<{ id: string }>();
  const { data: found } = await find();
  if (found) return { id: found.id, created: false };

  const profile = await fetchIgProfile(igsid, ctx.token);
  const { data } = await ctx.admin
    .from("contacts")
    .insert({
      company_id: ctx.account.company_id,
      name: profile.name || (profile.username ? `@${profile.username}` : "Contato do Instagram"),
      instagram_id: igsid,
      instagram_username: profile.username,
    })
    .select("id")
    .single<{ id: string }>();
  if (data) return { id: data.id, created: true };
  const { data: again } = await find();
  if (again) return { id: again.id, created: false };
  throw new Error("Não foi possível criar o contato do Instagram.");
}

async function findOrCreateConversation(ctx: Ctx, contactId: string): Promise<{ id: string; lead_id: string | null; created: boolean }> {
  const query = () =>
    ctx.admin
      .from("conversations")
      .select("id, lead_id")
      .eq("company_id", ctx.account.company_id)
      .eq("contact_id", contactId)
      .eq("channel", "instagram")
      .maybeSingle<{ id: string; lead_id: string | null }>();
  const { data: found } = await query();
  if (found) return { ...found, created: false };
  const { data } = await ctx.admin
    .from("conversations")
    .insert({ company_id: ctx.account.company_id, contact_id: contactId, channel: "instagram", instagram_account_id: ctx.account.id })
    .select("id, lead_id")
    .single<{ id: string; lead_id: string | null }>();
  if (data) return { ...data, created: true };
  const { data: again } = await query();
  if (again) return { ...again, created: false };
  throw new Error("Não foi possível criar a conversa do Instagram.");
}

async function ensureOpenLead(ctx: Ctx, contactId: string, referral: IgReferral | undefined): Promise<string | null> {
  const { data: open } = await ctx.admin
    .from("leads")
    .select("id")
    .eq("company_id", ctx.account.company_id)
    .eq("contact_id", contactId)
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (open) return open.id;

  let pipelineId = ctx.account.default_pipeline_id;
  if (!pipelineId) {
    const { data: p } = await ctx.admin.from("pipelines").select("id").eq("company_id", ctx.account.company_id).order("position").limit(1).maybeSingle<{ id: string }>();
    pipelineId = p?.id ?? null;
  }
  if (!pipelineId) return null;
  const { data: stage } = await ctx.admin.from("stages").select("id").eq("pipeline_id", pipelineId).eq("kind", "open").order("position").limit(1).maybeSingle<{ id: string }>();
  if (!stage) return null;

  // Anúncio de clique para o Direct traz o anúncio de origem: entra como Meta Ads e conta no Tráfego.
  const fromAd = !!referral?.ad_id;
  const { data: source } = await ctx.admin
    .from("lead_sources")
    .select("id")
    .eq("company_id", ctx.account.company_id)
    .eq("name", fromAd ? "Meta Ads" : "Instagram Direct")
    .maybeSingle<{ id: string }>();

  const { data: lead, error } = await ctx.admin
    .from("leads")
    .insert({
      company_id: ctx.account.company_id,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stage.id,
      owner_id: null,
      source_id: source?.id ?? null,
      // Mesmo formato do WhatsApp (source_id = anúncio), para o Tráfego ligar o lead à campanha.
      ad_referral: fromAd ? { ...referral, source_type: "ad", source_id: referral!.ad_id, channel: "instagram" } : null,
      last_contact_at: new Date().toISOString(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`Não foi possível criar o lead: ${error.message}`);
  return lead.id;
}

async function insertMessage(ctx: Ctx, row: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await ctx.admin
    .from("messages")
    .upsert({ company_id: ctx.account.company_id, ...row }, { onConflict: "wa_message_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Não foi possível gravar a mensagem: ${error.message}`);
  return (data as { id: string }[] | null)?.[0]?.id ?? null;
}

/** Baixa a mídia na hora (o link do Instagram expira) e guarda no bucket privado. */
async function saveMedia(ctx: Ctx, url: string | undefined, conversationId: string, messageId: string) {
  if (!url) return;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao baixar mídia do Instagram (${res.status})`);
  const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
  const ext = mime.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${ctx.account.company_id}/${conversationId}/${messageId}.${ext}`;
  const { error } = await ctx.admin.storage.from("whatsapp-media").upload(path, await res.arrayBuffer(), { contentType: mime, upsert: true });
  if (error) throw new Error(`Falha ao guardar mídia: ${error.message}`);
  await ctx.admin.from("messages").update({ media_path: path, media_mime: mime }).eq("id", messageId);
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
async function handleMessaging(ctx: Ctx, rules: Rule[], menu: Menu | null, ev: IgMessaging) {
  const m = ev.message;
  if (!m?.mid || m.is_deleted) return;
  const at = new Date(ev.timestamp ?? Date.now()).toISOString();
  const attachment = m.attachments?.[0];
  const body = m.text ?? (attachment?.type ? (MEDIA_LABEL[attachment.type] ?? "[Mídia]") : m.is_unsupported ? "[Mensagem não suportada]" : "");

  // Eco: mensagem enviada pela empresa. Se foi pelo Orvya, já está gravada (mesmo mid);
  // se foi pelo app do Instagram no celular, registra como enviada pela equipe.
  if (m.is_echo) {
    const igsid = ev.recipient?.id;
    if (!igsid) return;
    const contact = await findOrCreateContact(ctx, igsid);
    const conv = await findOrCreateConversation(ctx, contact.id);
    const id = await insertMessage(ctx, {
      conversation_id: conv.id,
      direction: "out",
      sender: "user",
      msg_type: attachment?.type ?? "text",
      body,
      wa_message_id: m.mid,
      status: "sent",
      source: "celular",
      sent_at: at,
    });
    if (id) await ctx.admin.from("conversations").update({ last_message_at: at, last_preview: body.slice(0, 160), last_direction: "out" }).eq("id", conv.id);
    return;
  }

  const igsid = ev.sender?.id;
  if (!igsid || igsid === ctx.account.ig_user_id) return;
  const contact = await findOrCreateContact(ctx, igsid);
  const conv = await findOrCreateConversation(ctx, contact.id);
  const messageId = await insertMessage(ctx, {
    conversation_id: conv.id,
    direction: "in",
    sender: "contact",
    msg_type: attachment?.type ?? "text",
    body,
    wa_message_id: m.mid,
    status: "received",
    source: "orvya",
    sent_at: at,
  });
  if (!messageId) return; // evento repetido

  const leadId = await ensureOpenLead(ctx, contact.id, m.referral ?? ev.referral);
  if (leadId) {
    await ctx.admin.from("leads").update({ last_contact_at: at }).eq("id", leadId);
    if (conv.lead_id !== leadId) await ctx.admin.from("conversations").update({ lead_id: leadId }).eq("id", conv.id);
  }
  await ctx.admin.rpc("conversation_inbound", { p_conversation: conv.id, p_at: at, p_preview: body });
  if (attachment?.payload?.url) await saveMedia(ctx, attachment.payload.url, conv.id, messageId);

  // Botão do menu tocado: responde com o link do WhatsApp (o assunto vai escrito na mensagem).
  const choice = menu ? menuChoice(menu.options, m.quick_reply?.payload) : null;
  if (menu && choice) {
    await autoReply(ctx, conv.id, igsid, fillLinkReply(menu.linkReply, whatsappLink(menu.phone, choice)));
    return;
  }
  // Palavra-chave primeiro; na primeira conversa, o menu de boas-vindas (ou a boas-vindas simples).
  const rule = m.text ? matchRule(rules, "dm_keyword", m.text) : undefined;
  if (rule) await autoReply(ctx, conv.id, igsid, rule.reply);
  else if (conv.created && menu) await autoReply(ctx, conv.id, igsid, menu.intro, menuQuickReplies(menu.options));
  else if (conv.created) {
    const welcome = rules.find((r) => r.trigger === "welcome");
    if (welcome) await autoReply(ctx, conv.id, igsid, welcome.reply);
  }
}

/** Envia a resposta automática e registra como mensagem do sistema (não pausa a equipe nem assume a conversa). */
async function autoReply(ctx: Ctx, conversationId: string, igsid: string, text: string, quickReplies?: { title: string; payload: string }[]) {
  // Na conversa, as opções aparecem como texto (no Instagram são botões).
  const body = quickReplies?.length ? `${text}\nOpções: ${quickReplies.map((q) => q.title).join(" · ")}` : text;
  // Evita repetir a mesma resposta na mesma conversa em menos de 12 horas.
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { count } = await ctx.admin
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("sender", "system")
    .eq("body", body)
    .gte("sent_at", since);
  if (count) return;

  const mid = await sendDirectText(ctx.account.page_id, ctx.token, igsid, text, false, quickReplies);
  const now = new Date().toISOString();
  await insertMessage(ctx, {
    conversation_id: conversationId,
    direction: "out",
    sender: "system",
    msg_type: "text",
    body,
    wa_message_id: mid,
    status: "sent",
    source: "orvya",
    sent_at: now,
  });
  await ctx.admin.from("conversations").update({ last_message_at: now, last_preview: body.slice(0, 160), last_direction: "out" }).eq("id", conversationId);
}

/** Comentário com palavra-chave: uma mensagem privada para quem comentou (até 7 dias depois do comentário). */
async function handleComment(ctx: Ctx, rules: Rule[], c: IgComment) {
  if (!c.id || !c.text || c.from?.id === ctx.account.ig_user_id) return;
  const rule = matchRule(rules, "comment_keyword", c.text);
  if (!rule) return;
  // Reserva o comentário antes de enviar: a Meta só aceita uma resposta privada por comentário.
  const { error: claim } = await ctx.admin
    .from("ig_comment_replies")
    .insert({ comment_id: c.id, company_id: ctx.account.company_id, rule_id: rule.id, username: c.from?.username ?? null, comment: c.text.slice(0, 500) });
  if (claim) return; // já respondido (ou outro processamento pegou)
  try {
    await sendPrivateReply(ctx.account.page_id, ctx.token, c.id, rule.reply);
  } catch (e) {
    await ctx.admin.from("ig_comment_replies").update({ error: e instanceof Error ? e.message.slice(0, 300) : "erro" }).eq("comment_id", c.id);
    throw e;
  }
}
