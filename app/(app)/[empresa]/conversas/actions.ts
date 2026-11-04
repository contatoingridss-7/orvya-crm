"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { photoUrl } from "@/lib/catalog/photos";
import { formatBRL } from "@/lib/format";
import { formatPhone, toE164 } from "@/lib/phone";
import { phoneCandidates } from "@/lib/whatsapp/payload";
import { markAsRead, sendMediaMessage, sendTextMessage } from "@/lib/whatsapp/graph";
import {
  deliverTemplate,
  recordOutboundMessage,
  resolveDestination,
  SEND_CONVERSATION_SELECT,
  sendErrorMessage,
  sendWithNinthDigitRetry,
  type SendConversation,
} from "@/lib/whatsapp/send";
import { cleanParam, countParams } from "@/lib/whatsapp/templates";
import { isWindowOpen } from "@/lib/whatsapp/window";
import { instagramErrorText } from "@/lib/instagram/graph";
import { sendInstagramText } from "@/lib/instagram/send";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function context(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company || company.role === "logistica") return null;
  return { viewer, company, manager: isManager(company.role), supabase: await createClient() };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>;

const NO_ACCESS = { ok: false as const, error: "Sem acesso a esta empresa." };

type ConvRow = SendConversation;

/** Carrega a conversa pelo cliente do usuário: se o RLS esconder, ele não tem acesso (docs/WHATSAPP.md, seção 4.1). */
async function loadConversation(ctx: Ctx, conversationId: string) {
  const { data } = await ctx.supabase
    .from("conversations")
    .select(SEND_CONVERSATION_SELECT)
    .eq("id", conversationId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<ConvRow>();
  return data;
}

type Prepared = { conv: ConvRow; phoneNumberId: string; token: string; to: string };

/** Confere permissão, número conectado, telefone e token antes de qualquer envio. */
async function prepareSend(ctx: Ctx, conversationId: string): Promise<{ ok: true; p: Prepared } | { ok: false; error: string }> {
  const conv = await loadConversation(ctx, conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada." };
  // Vendedor responde nas dele e nas da fila (e passa a ser o responsável); gestor/admin em todas.
  if (!ctx.manager && conv.assigned_to && conv.assigned_to !== ctx.viewer.id) {
    return { ok: false, error: "Esta conversa é de outro vendedor." };
  }
  const dest = await resolveDestination(conv);
  if (!dest.ok) return dest;
  return { ok: true, p: { conv, ...dest.d } };
}

/**
 * Registra a mensagem enviada e atualiza conversa e lead (docs/WHATSAPP.md, seção 4, passos 5 e 6).
 * Equipe respondeu: a IA pausa nesta conversa (CLAUDE.md, regra 8) e quem respondeu assume, se estava na fila.
 */
async function recordOutbound(
  ctx: Ctx,
  conv: ConvRow,
  msg: { wamid: string; body: string; msgType: "text" | "template" | "document" | "image"; templateName?: string },
): Promise<ActionResult> {
  const r = await recordOutboundMessage(conv, msg, ctx.viewer.id);
  return r.ok ? { ok: true } : r;
}

const sendSchema = z.object({
  conversationId: z.uuid(),
  text: z.string().trim().min(1, "Escreva a mensagem.").max(4096, "Mensagem longa demais (máximo de 4.096 caracteres)."),
});

/** Envio de texto pela equipe (docs/WHATSAPP.md, seção 4 e SPEC 5.3). */
export async function sendText(slug: string, input: z.input<typeof sendSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Mensagem inválida." };

  // Instagram Direct: mesmas regras de acesso, prazo do Instagram (24 h / 7 dias para a equipe).
  const igConv = await loadConversation(ctx, parsed.data.conversationId);
  if (igConv?.channel === "instagram") {
    if (!ctx.manager && igConv.assigned_to && igConv.assigned_to !== ctx.viewer.id) return { ok: false, error: "Esta conversa é de outro vendedor." };
    if (parsed.data.text.length > 1000) return { ok: false, error: "No Instagram, a mensagem pode ter até 1.000 caracteres." };
    let sent: Awaited<ReturnType<typeof sendInstagramText>>;
    try {
      sent = await sendInstagramText(igConv, parsed.data.text);
    } catch (e) {
      return { ok: false, error: instagramErrorText(e) };
    }
    if (!sent.ok) return sent;
    const r = await recordOutbound(ctx, igConv, { wamid: sent.mid, body: parsed.data.text, msgType: "text" });
    revalidatePath(`/${slug}/conversas`);
    return r;
  }

  const prep = await prepareSend(ctx, parsed.data.conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;
  // Janela de 24 h conferida no servidor, não só na tela (CLAUDE.md, regra 4).
  if (!isWindowOpen(conv.last_inbound_at)) {
    return { ok: false, error: "A janela de 24 horas está fechada. Fora dela, só modelos de mensagem aprovados." };
  }

  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) => sendTextMessage(phoneNumberId, token, dest, parsed.data.text));
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }

  const r = await recordOutbound(ctx, conv, { wamid, body: parsed.data.text, msgType: "text" });
  revalidatePath(`/${slug}/conversas`);
  return r;
}

const templateSchema = z.object({
  conversationId: z.uuid(),
  templateId: z.uuid("Escolha o modelo."),
  values: z.array(z.string().max(1024, "Campo longo demais.")).max(20),
});

type TemplateRow = { id: string; name: string; language: string; body: string; status: string; variables: string[] | null };

/**
 * Envio de modelo aprovado (docs/WHATSAPP.md, seções 4 e 5). Vale com a janela aberta ou fechada;
 * fora da janela é o único envio permitido. Só modelos aprovados da empresa (lidos pelo RLS).
 */
export async function sendTemplate(slug: string, input: z.input<typeof templateSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const { data: tpl } = await ctx.supabase
    .from("message_templates")
    .select("id, name, language, body, status, variables")
    .eq("id", parsed.data.templateId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<TemplateRow>();
  if (!tpl) return { ok: false, error: "Modelo não encontrado." };
  if (tpl.status !== "approved") return { ok: false, error: "Este modelo não está aprovado pela Meta." };

  const values = parsed.data.values.map(cleanParam);
  if (values.length !== countParams(tpl.body) || values.some((v) => !v)) {
    return { ok: false, error: "Preencha todos os campos do modelo." };
  }

  const prep = await prepareSend(ctx, parsed.data.conversationId);
  if (!prep.ok) return prep;

  let sent: { wamid: string; body: string };
  try {
    sent = await deliverTemplate(prep.p, tpl, values);
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }

  const r = await recordOutbound(ctx, prep.p.conv, { wamid: sent.wamid, body: sent.body, msgType: "template", templateName: tpl.name });
  revalidatePath(`/${slug}/conversas`);
  return r.ok ? { ok: true, message: "Modelo enviado. A conversa reabre quando o cliente responder." } : r;
}

/** Assumir a conversa: vira responsável pela conversa e pelo lead (se ninguém estava). */
export async function assumeConversation(slug: string, conversationId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const conv = await loadConversation(ctx, conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada." };
  if (conv.assigned_to && conv.assigned_to !== ctx.viewer.id && !ctx.manager) return { ok: false, error: "Esta conversa é de outro vendedor." };

  const admin = createAdminClient();
  await admin.from("conversations").update({ assigned_to: ctx.viewer.id, ai_enabled: false, needs_human: false }).eq("id", conv.id);
  if (conv.lead_id) await admin.from("leads").update({ owner_id: ctx.viewer.id }).eq("id", conv.lead_id).is("owner_id", null);

  revalidatePath(`/${slug}/conversas`);
  return { ok: true, message: "Você assumiu a conversa." };
}

/** Ao abrir a conversa: zera as não lidas e avisa a Meta (tiques azuis para o cliente). */
export async function markRead(slug: string, conversationId: string): Promise<void> {
  const ctx = await context(slug);
  if (!ctx) return;
  const conv = await loadConversation(ctx, conversationId);
  if (!conv) return;
  await ctx.supabase.rpc("mark_conversation_read", { p_conversation: conversationId });

  const number = conv.whatsapp_numbers;
  if (!number?.phone_number_id || number.status !== "connected") return;
  const admin = createAdminClient();
  const [{ data: last }, { data: cred }] = await Promise.all([
    admin
      .from("messages")
      .select("wa_message_id")
      .eq("conversation_id", conversationId)
      .eq("direction", "in")
      .eq("source", "orvya")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ wa_message_id: string | null }>(),
    admin.from("whatsapp_credentials").select("access_token").eq("number_id", conv.whatsapp_number_id!).maybeSingle<{ access_token: string }>(),
  ]);
  if (last?.wa_message_id && cred) {
    // Se a Meta recusar (token expirado, mensagem antiga), não atrapalha a tela.
    await markAsRead(number.phone_number_id, cred.access_token, last.wa_message_id).catch(() => undefined);
  }
}

const mediaSchema = z.object({ conversationId: z.uuid(), id: z.uuid() });

/** Confere permissão, número e janela de 24 h (documento e foto são mensagens livres). */
async function prepareMediaSend(ctx: Ctx, conversationId: string) {
  const prep = await prepareSend(ctx, conversationId);
  if (!prep.ok) return prep;
  if (!isWindowOpen(prep.p.conv.last_inbound_at)) {
    return { ok: false as const, error: "A janela de 24 horas está fechada. Fora dela, só modelos de mensagem aprovados." };
  }
  return prep;
}

/** Envia um material (catálogo em PDF, tabela, folheto) como documento do WhatsApp. */
export async function sendMaterial(slug: string, input: z.input<typeof mediaSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = mediaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const { data: material } = await ctx.supabase
    .from("sales_materials")
    .select("id, title, file_path, file_name, mime")
    .eq("id", parsed.data.id)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; title: string; file_path: string; file_name: string; mime: string }>();
  if (!material) return { ok: false, error: "Material não encontrado." };

  const prep = await prepareMediaSend(ctx, parsed.data.conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;

  // Link assinado curto: a Meta baixa o arquivo na hora do envio.
  const admin = createAdminClient();
  const { data: signed } = await admin.storage.from("sales-materials").createSignedUrl(material.file_path, 600);
  if (!signed) return { ok: false, error: "Arquivo indisponível. Envie de novo em Automações → Materiais." };
  const kind = material.mime.startsWith("image/") ? "image" : "document";

  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) =>
      sendMediaMessage(phoneNumberId, token, dest, { kind, link: signed.signedUrl, filename: material.file_name, caption: kind === "image" ? material.title : undefined }),
    );
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const { data: count } = await admin.from("sales_materials").select("uses").eq("id", material.id).maybeSingle<{ uses: number }>();
  await admin.from("sales_materials").update({ uses: (count?.uses ?? 0) + 1 }).eq("id", material.id);
  const r = await recordOutbound(ctx, conv, { wamid, body: `[${kind === "image" ? "Imagem" : "Documento"}] ${material.title}`, msgType: kind });
  revalidatePath(`/${slug}/conversas`);
  return r;
}

type ProductPick = { id: string; code: string | null; name: string; sale_price: number | string | null; rent_price_month: number | string | null; photo_path: string | null };

/** Busca no catálogo da empresa para enviar na conversa (nome ou código). */
export async function searchProducts(slug: string, term: string): Promise<{ id: string; label: string; price: string | null; hasPhoto: boolean }[]> {
  const ctx = await context(slug);
  const q = term.trim().replace(/[%_,()]/g, " ").slice(0, 60);
  if (!ctx || q.length < 2) return [];
  const { data } = await ctx.supabase
    .from("products")
    .select("id, code, name, sale_price, rent_price_month, photo_path")
    .eq("company_id", ctx.company.id)
    .eq("active", true)
    .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
    .order("name")
    .limit(12)
    .returns<ProductPick[]>();
  return (data ?? []).map((p) => ({
    id: p.id,
    label: `${p.code ? `${p.code} · ` : ""}${p.name}`,
    price: productPrice(p),
    hasPhoto: !!p.photo_path,
  }));
}

function productPrice(p: ProductPick): string | null {
  const parts: string[] = [];
  if (p.sale_price !== null) parts.push(formatBRL(Number(p.sale_price)));
  if (p.rent_price_month !== null) parts.push(`aluguel ${formatBRL(Number(p.rent_price_month))}/mês`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Envia um produto do catálogo: foto com nome e preço na legenda (ou só o texto, se não houver foto).
 * Preço sempre do catálogo; produto sem preço vai sem valor (o vendedor completa).
 */
export async function sendProduct(slug: string, input: z.input<typeof mediaSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = mediaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const { data: product } = await ctx.supabase
    .from("products")
    .select("id, code, name, sale_price, rent_price_month, photo_path")
    .eq("id", parsed.data.id)
    .eq("company_id", ctx.company.id)
    .maybeSingle<ProductPick>();
  if (!product) return { ok: false, error: "Produto não encontrado." };

  const prep = await prepareMediaSend(ctx, parsed.data.conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;

  const price = productPrice(product);
  const caption = [`*${product.name}*`, product.code ? `Código ${product.code}` : null, price].filter(Boolean).join("\n");
  const link = photoUrl(product.photo_path);
  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) =>
      link ? sendMediaMessage(phoneNumberId, token, dest, { kind: "image", link, caption }) : sendTextMessage(phoneNumberId, token, dest, caption),
    );
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const r = await recordOutbound(ctx, conv, { wamid, body: link ? `[Imagem] ${caption}` : caption, msgType: link ? "image" : "text" });
  revalidatePath(`/${slug}/conversas`);
  return r;
}

/** Soma um uso na resposta rápida (as mais usadas sobem na lista do "/"). */
export async function quickReplyUsed(slug: string, id: string): Promise<void> {
  const ctx = await context(slug);
  if (!ctx || !z.uuid().safeParse(id).success) return;
  await ctx.supabase.rpc("quick_reply_used", { p_id: id });
}

const startSchema = z.object({
  name: z.string().trim().max(120),
  phone: z.string().trim().min(8, "Informe o telefone com DDD."),
  numberId: z.uuid("Escolha o número de envio."),
  pipelineId: z.uuid("Escolha o funil."),
  templateId: z.uuid("Escolha o modelo."),
  values: z.array(z.string().max(1024, "Campo longo demais.")).max(20),
});

/**
 * Nova conversa iniciada pela equipe. Pela regra da Meta, a primeira mensagem para quem ainda não
 * escreveu é um modelo aprovado; a conversa abre para texto livre quando o cliente responder.
 * Cria (ou reaproveita) o contato, o lead (no funil escolhido, com quem iniciou como responsável)
 * e a conversa, e envia o modelo.
 */
export async function startConversation(slug: string, input: z.input<typeof startSchema>): Promise<ActionResult & { conversationId?: string }> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const e164 = toE164(d.phone);
  if (!e164) return { ok: false, error: "Telefone inválido. Use DDD + número, ex.: (86) 99999-0000." };

  // Modelo aprovado da empresa, com todos os campos preenchidos.
  const { data: tpl } = await ctx.supabase
    .from("message_templates")
    .select("id, name, language, body, status, variables")
    .eq("id", d.templateId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<TemplateRow>();
  if (!tpl || tpl.status !== "approved") return { ok: false, error: "Escolha um modelo aprovado pela Meta." };
  const values = d.values.map(cleanParam);
  if (values.length !== countParams(tpl.body) || values.some((v) => !v)) return { ok: false, error: "Preencha todos os campos do modelo." };

  // Funil da empresa, e liberado para o vendedor (Equipe → funis).
  const { data: pipeline } = await ctx.supabase.from("pipelines").select("id").eq("id", d.pipelineId).eq("company_id", ctx.company.id).maybeSingle<{ id: string }>();
  if (!pipeline) return { ok: false, error: "Funil não encontrado." };
  if (!ctx.manager) {
    const { data: me } = await ctx.supabase
      .from("memberships")
      .select("pipeline_ids")
      .eq("company_id", ctx.company.id)
      .eq("user_id", ctx.viewer.id)
      .maybeSingle<{ pipeline_ids: string[] | null }>();
    if (me?.pipeline_ids?.length && !me.pipeline_ids.includes(pipeline.id)) return { ok: false, error: "Você não trabalha neste funil." };
  }

  const admin = createAdminClient();
  const { data: number } = await admin
    .from("whatsapp_numbers")
    .select("id, status")
    .eq("id", d.numberId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; status: string }>();
  if (!number || number.status !== "connected") return { ok: false, error: "Este número não está conectado." };

  // Contato: o mesmo telefone com ou sem o nono dígito é a mesma pessoa.
  const candidates = phoneCandidates(e164);
  let { data: contact } = await admin
    .from("contacts")
    .select("id, name")
    .eq("company_id", ctx.company.id)
    .in("phone_e164", candidates)
    .limit(1)
    .maybeSingle<{ id: string; name: string }>();
  if (!contact) {
    const { data: created, error } = await admin
      .from("contacts")
      .insert({ company_id: ctx.company.id, name: d.name || formatPhone(e164), phone_e164: e164 })
      .select("id, name")
      .single<{ id: string; name: string }>();
    if (error || !created) return { ok: false, error: "Não foi possível criar o contato." };
    contact = created;
  }

  // Conversa existente deste contato neste número: vendedor só segue se for dele ou da fila.
  const { data: existing } = await admin
    .from("conversations")
    .select("id, assigned_to, lead_id")
    .eq("company_id", ctx.company.id)
    .eq("contact_id", contact.id)
    .eq("channel", "whatsapp")
    .eq("whatsapp_number_id", number.id)
    .maybeSingle<{ id: string; assigned_to: string | null; lead_id: string | null }>();
  if (existing?.assigned_to && existing.assigned_to !== ctx.viewer.id && !ctx.manager) {
    return { ok: false, error: "Este contato já está com outro vendedor. Peça ao gestor para transferir." };
  }

  // Lead aberto do contato; se não houver, nasce no funil escolhido com quem iniciou como responsável.
  let { data: lead } = await admin
    .from("leads")
    .select("id")
    .eq("company_id", ctx.company.id)
    .eq("contact_id", contact.id)
    .is("closed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!lead) {
    const { data: stage } = await admin.from("stages").select("id").eq("pipeline_id", pipeline.id).eq("kind", "open").order("position").limit(1).maybeSingle<{ id: string }>();
    if (!stage) return { ok: false, error: "O funil não tem etapa aberta." };
    const { data: created, error } = await admin
      .from("leads")
      .insert({ company_id: ctx.company.id, contact_id: contact.id, pipeline_id: pipeline.id, stage_id: stage.id, owner_id: ctx.viewer.id, last_contact_at: new Date().toISOString() })
      .select("id")
      .single<{ id: string }>();
    if (error || !created) return { ok: false, error: "Não foi possível criar o lead." };
    lead = created;
  }

  let conversationId = existing?.id;
  if (!conversationId) {
    const { data: created, error } = await admin
      .from("conversations")
      .insert({ company_id: ctx.company.id, contact_id: contact.id, channel: "whatsapp", whatsapp_number_id: number.id, lead_id: lead.id, assigned_to: ctx.viewer.id, ai_enabled: false })
      .select("id")
      .single<{ id: string }>();
    if (error || !created) return { ok: false, error: "Não foi possível abrir a conversa." };
    conversationId = created.id;
  } else if (!existing?.lead_id) {
    await admin.from("conversations").update({ lead_id: lead.id }).eq("id", conversationId);
  }

  const { data: conv } = await admin.from("conversations").select(SEND_CONVERSATION_SELECT).eq("id", conversationId).single<ConvRow>();
  if (!conv) return { ok: false, error: "Conversa não encontrada." };
  const dest = await resolveDestination(conv);
  if (!dest.ok) return dest;

  let sent: { wamid: string; body: string };
  try {
    sent = await deliverTemplate(dest.d, tpl, values);
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const r = await recordOutbound(ctx, conv, { wamid: sent.wamid, body: sent.body, msgType: "template", templateName: tpl.name });
  revalidatePath(`/${slug}/conversas`);
  return r.ok ? { ok: true, message: "Conversa iniciada. Quando o cliente responder, a conversa abre para texto livre.", conversationId } : r;
}
