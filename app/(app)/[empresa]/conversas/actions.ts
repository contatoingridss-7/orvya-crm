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
import { budgetBlock, loadPaidBudget } from "@/lib/whatsapp/budget";
import { phoneCandidates } from "@/lib/whatsapp/payload";
import { markAsRead, sendButtonsMessage, sendLocationMessage, sendLocationRequest, sendMediaMessage, sendTextMessage, uploadMedia, VOICE_MIME } from "@/lib/whatsapp/graph";
import { isGoogleMapsHost, locationBody, mapsUrl, parseCoordinates, parseLocationBody, placeLabel, type Coordinates } from "@/lib/location";
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
  msg: Parameters<typeof recordOutboundMessage>[1],
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
  if (igConv?.channel === "instagram" || igConv?.channel === "messenger") {
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
  const block = budgetBlock(await loadPaidBudget(ctx.supabase, ctx.company.id), ctx.manager);
  if (block) return { ok: false, error: block.replace("Use o link grátis ou peça", "Peça") };

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

/**
 * Guarda uma cópia do arquivo enviado (material ou foto do catálogo) junto da conversa, para a
 * equipe ver a imagem/o documento no Orvya, como nas fotos enviadas pelo Anexar. A Meta baixa do
 * arquivo original, que não muda; se a cópia falhar, a mensagem só fica sem a prévia.
 */
async function keepCopy(fromBucket: string, fromPath: string, companyId: string, conversationId: string, messageId: string, mime: string) {
  try {
    const admin = createAdminClient();
    const { data: file } = await admin.storage.from(fromBucket).download(fromPath);
    if (!file) return;
    const ext = fromPath.split(".").pop()?.toLowerCase() || "bin";
    const path = `${companyId}/${conversationId}/${messageId}.${ext}`;
    const { error } = await admin.storage.from("whatsapp-media").upload(path, await file.arrayBuffer(), { contentType: mime, upsert: true });
    if (!error) await admin.from("messages").update({ media_path: path, media_mime: mime }).eq("id", messageId);
  } catch {
    // Sem prévia; o envio ao cliente já aconteceu.
  }
}

/** Envia um material (catálogo em PDF, tabela, folheto) como documento do WhatsApp. */
const materialSendSchema = mediaSchema.extend({ caption: z.string().trim().max(1024, "Legenda de no máximo 1.024 caracteres.").optional() });

export async function sendMaterial(slug: string, input: z.input<typeof materialSendSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = materialSendSchema.safeParse(input);
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
  const { data: signed } = await admin.storage.from("sales-materials").createSignedUrl(material.file_path, 3600);
  if (!signed) return { ok: false, error: "Arquivo indisponível. Envie de novo em Automações → Materiais." };
  const kind = material.mime.startsWith("image/") ? "image" : material.mime.startsWith("audio/") ? "audio" : "document";

  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) =>
      sendMediaMessage(phoneNumberId, token, dest, {
        kind,
        link: signed.signedUrl,
        filename: material.file_name,
        // Resposta rápida com uma imagem: o texto da resposta vai como legenda.
        caption: kind === "audio" ? undefined : parsed.data.caption || (kind === "image" ? material.title : undefined),
      }),
    );
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const { data: count } = await admin.from("sales_materials").select("uses").eq("id", material.id).maybeSingle<{ uses: number }>();
  await admin.from("sales_materials").update({ uses: (count?.uses ?? 0) + 1 }).eq("id", material.id);
  const rec = await recordOutboundMessage(
    conv,
    { wamid, body: `[${kind === "image" ? "Imagem" : kind === "audio" ? "Áudio" : "Documento"}] ${parsed.data.caption || material.title}`, msgType: kind },
    ctx.viewer.id,
  );
  if (rec.ok) await keepCopy("sales-materials", material.file_path, ctx.company.id, conv.id, rec.messageId, material.mime);
  revalidatePath(`/${slug}/conversas`);
  return rec.ok ? { ok: true } : rec;
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
  const rec = await recordOutboundMessage(conv, { wamid, body: link ? `[Imagem] ${caption}` : caption, msgType: link ? "image" : "text" }, ctx.viewer.id);
  if (rec.ok && link && product.photo_path) {
    const ext = product.photo_path.split(".").pop()?.toLowerCase();
    await keepCopy("product-photos", product.photo_path, ctx.company.id, conv.id, rec.messageId, ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  }
  revalidatePath(`/${slug}/conversas`);
  return rec.ok ? { ok: true } : rec;
}

/** Soma um uso na resposta rápida (as mais usadas sobem na lista do "/"). */
export async function quickReplyUsed(slug: string, id: string): Promise<void> {
  const ctx = await context(slug);
  if (!ctx || !z.uuid().safeParse(id).success) return;
  await ctx.supabase.rpc("quick_reply_used", { p_id: id });
}

const threadSchema = z.object({
  name: z.string().trim().max(120),
  phone: z.string().trim().min(8, "Informe o telefone com DDD."),
  numberId: z.uuid("Escolha o número de envio."),
  pipelineId: z.uuid("Escolha o funil."),
});
const startSchema = threadSchema.extend({
  templateId: z.uuid("Escolha o modelo."),
  values: z.array(z.string().max(1024, "Campo longo demais.")).max(20),
});

type Thread = { conversationId: string; created: boolean; displayPhone: string | null };

/**
 * Contato, lead e conversa de uma nova conversa iniciada pela equipe. Reaproveita o que já existe
 * (o mesmo telefone com ou sem o nono dígito é a mesma pessoa); o lead novo nasce no funil escolhido
 * com quem iniciou como responsável, e a conversa fica com ele, sem IA. Quando o cliente escrever,
 * o webhook encontra esse contato e essa conversa, e a mensagem cai direto com o vendedor.
 */
async function openThread(ctx: Ctx, d: z.output<typeof threadSchema>): Promise<{ ok: true; t: Thread } | { ok: false; error: string }> {
  const e164 = toE164(d.phone);
  if (!e164) return { ok: false, error: "Telefone inválido. Use DDD + número, ex.: (86) 99999-0000." };

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
    .select("id, status, display_phone")
    .eq("id", d.numberId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; status: string; display_phone: string | null }>();
  if (!number || number.status !== "connected") return { ok: false, error: "Este número não está conectado." };

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

  if (existing) {
    if (!existing.lead_id) await admin.from("conversations").update({ lead_id: lead.id }).eq("id", existing.id);
    return { ok: true, t: { conversationId: existing.id, created: false, displayPhone: number.display_phone } };
  }
  const { data: created, error } = await admin
    .from("conversations")
    .insert({ company_id: ctx.company.id, contact_id: contact.id, channel: "whatsapp", whatsapp_number_id: number.id, lead_id: lead.id, assigned_to: ctx.viewer.id, ai_enabled: false })
    .select("id")
    .single<{ id: string }>();
  if (error || !created) return { ok: false, error: "Não foi possível abrir a conversa." };
  return { ok: true, t: { conversationId: created.id, created: true, displayPhone: number.display_phone } };
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";

/**
 * Nova conversa SEM custo: o Orvya prepara contato, lead e conversa e devolve um link do WhatsApp
 * da empresa com a mensagem do cliente já escrita. O vendedor manda o link por SMS, Instagram ou
 * na ligação; quando o cliente toca e envia, a conversa começa por ele (grátis pela Meta) e cai
 * direto com o vendedor.
 */
export async function startByLink(
  slug: string,
  input: z.input<typeof threadSchema>,
): Promise<ActionResult & { conversationId?: string; link?: string; text?: string }> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = threadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const r = await openThread(ctx, d);
  if (!r.ok) return r;
  const companyPhone = r.t.displayPhone ? toE164(r.t.displayPhone) : null;
  if (!companyPhone) return { ok: false, error: "O número da empresa está sem telefone cadastrado. Peça ao administrador para conferir em Canais." };

  if (r.t.created) {
    await createAdminClient()
      .from("conversations")
      .update({ last_preview: "Link enviado. Aguardando o cliente chamar.", last_message_at: new Date().toISOString() })
      .eq("id", r.t.conversationId);
  }

  const seller = ctx.viewer.fullName.trim();
  const client = firstName(d.name);
  const clientText = `Olá, ${firstName(seller) || ctx.company.name}! Quero atendimento.`;
  const link = `https://wa.me/${companyPhone.slice(1)}?text=${encodeURIComponent(clientText)}`;
  const text = `Olá${client ? `, ${client}` : ""}! Aqui é ${seller || "a equipe"}, da ${ctx.company.name}. Tudo bem? Para falar comigo pelo nosso WhatsApp, é só tocar no link: ${link}`;

  revalidatePath(`/${slug}/conversas`);
  return { ok: true, conversationId: r.t.conversationId, link, text };
}

/**
 * Nova conversa por modelo aprovado (pago): pela regra da Meta, a primeira mensagem para quem ainda
 * não escreveu é um modelo; a conversa abre para texto livre quando o cliente responder.
 * Respeita o limite mensal de mensagens pagas da empresa (vendedor; gestor/admin seguem).
 */
export async function startConversation(slug: string, input: z.input<typeof startSchema>): Promise<ActionResult & { conversationId?: string }> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

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
  const block = budgetBlock(await loadPaidBudget(ctx.supabase, ctx.company.id), ctx.manager);
  if (block) return { ok: false, error: block };

  const r = await openThread(ctx, d);
  if (!r.ok) return r;
  const conversationId = r.t.conversationId;

  const { data: conv } = await createAdminClient().from("conversations").select(SEND_CONVERSATION_SELECT).eq("id", conversationId).single<ConvRow>();
  if (!conv) return { ok: false, error: "Conversa não encontrada." };
  const dest = await resolveDestination(conv);
  if (!dest.ok) return dest;

  let sent: { wamid: string; body: string };
  try {
    sent = await deliverTemplate(dest.d, tpl, values);
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const rec = await recordOutbound(ctx, conv, { wamid: sent.wamid, body: sent.body, msgType: "template", templateName: tpl.name });
  revalidatePath(`/${slug}/conversas`);
  return rec.ok ? { ok: true, message: "Conversa iniciada. Quando o cliente responder, a conversa abre para texto livre.", conversationId } : rec;
}

/**
 * Tira do Orvya um contato que não é cliente em atendimento (dono, equipe, parceiro, teste):
 * a conversa e os leads abertos sem produto são excluídos. No Instagram, o contato passa a ser
 * ignorado pela triagem (as próximas mensagens ficam só no app). No WhatsApp não dá para ignorar
 * (o número oficial só existe no Orvya): se escrever de novo, volta como contato novo. Só gestor e admin.
 */
export async function removeFromCrm(slug: string, conversationId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  if (!ctx.manager) return { ok: false, error: "Só gestor ou administrador tira um contato do Orvya." };
  if (!z.uuid().safeParse(conversationId).success) return { ok: false, error: "Conversa inválida." };
  const { data: conv } = await ctx.supabase
    .from("conversations")
    .select("id, contact_id, channel")
    .eq("id", conversationId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; contact_id: string; channel: string }>();
  if (!conv) return { ok: false, error: "Conversa não encontrada." };
  const admin = createAdminClient();
  if (conv.channel === "instagram" || conv.channel === "messenger") {
    const { error } = await admin.from("contacts").update({ crm_ignored: true }).eq("id", conv.contact_id).eq("company_id", ctx.company.id);
    if (error) return { ok: false, error: "Não foi possível salvar. Confira se a migration 0027 foi rodada." };
  }
  const { data: leads } = await admin
    .from("leads")
    .select("id, lead_products(id)")
    .eq("company_id", ctx.company.id)
    .eq("contact_id", conv.contact_id)
    .is("closed_at", null)
    .returns<{ id: string; lead_products: { id: string }[] }[]>();
  const empty = (leads ?? []).filter((l) => !l.lead_products?.length).map((l) => l.id);
  await admin.from("conversations").delete().eq("id", conv.id);
  if (empty.length) await admin.from("leads").delete().in("id", empty);

  revalidatePath(`/${slug}/conversas`);
  revalidatePath(`/${slug}/funil`);
  return {
    ok: true,
    message: conv.channel !== "whatsapp" ? "Contato tirado do Orvya. As próximas mensagens dele ficam só no app da Meta." : "Conversa e lead excluídos do Orvya.",
  };
}

const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

/**
 * Foto do aparelho (celular ou computador) enviada na conversa do WhatsApp, com legenda opcional.
 * A tela já reduz a foto; aqui guarda no bucket privado, manda o link assinado para a Meta e registra.
 */
export async function sendPhoto(slug: string, form: FormData): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const conversationId = String(form.get("conversationId") ?? "");
  const caption = String(form.get("caption") ?? "").trim().slice(0, 1000);
  const file = form.get("file");
  if (!z.uuid().safeParse(conversationId).success || !(file instanceof File)) return { ok: false, error: "Dados inválidos." };
  const ext = PHOTO_TYPES[file.type];
  if (!ext) return { ok: false, error: "Envie uma foto em JPG ou PNG." };
  if (file.size > 3.5 * 1024 * 1024) return { ok: false, error: "Foto grande demais (máximo de 3,5 MB)." };

  const prep = await prepareMediaSend(ctx, conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;

  const admin = createAdminClient();
  const bucket = admin.storage.from("whatsapp-media");
  const tmp = `${ctx.company.id}/${conv.id}/envio-${crypto.randomUUID()}.${ext}`;
  const { error: up } = await bucket.upload(tmp, await file.arrayBuffer(), { contentType: file.type });
  if (up) return { ok: false, error: "Não foi possível guardar a foto. Tente de novo." };
  const { data: signed } = await bucket.createSignedUrl(tmp, 3600);
  if (!signed) return { ok: false, error: "Não foi possível preparar a foto. Tente de novo." };

  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) => sendMediaMessage(phoneNumberId, token, dest, { kind: "image", link: signed.signedUrl, caption: caption || undefined }));
  } catch (e) {
    await bucket.remove([tmp]);
    return { ok: false, error: sendErrorMessage(e) };
  }
  const rec = await recordOutboundMessage(conv, { wamid, body: caption ? `[Imagem] ${caption}` : "[Imagem]", msgType: "image" }, ctx.viewer.id);
  // O arquivo NÃO muda de lugar: a Meta baixa pelo link segundos depois de aceitar o envio,
  // e mover o arquivo antes disso faz a mensagem falhar ("Media upload error", 131053).
  if (rec.ok) await admin.from("messages").update({ media_path: tmp, media_mime: file.type }).eq("id", rec.messageId);
  revalidatePath(`/${slug}/conversas`);
  return rec.ok ? { ok: true } : rec;
}

/** Vídeo aceito pelo WhatsApp: MP4/3GP até 16 MB (o .mov do iPhone vai como MP4). */
const VIDEO_TYPES = ["video/mp4", "video/3gpp", "video/quicktime"];
const VIDEO_MAX = 16 * 1024 * 1024;
const videoUploadSchema = z.object({ conversationId: z.uuid(), mime: z.string(), size: z.number().int().positive() });

/**
 * Vídeo é grande demais para passar pelo servidor: a tela pede aqui um link de envio de uso único
 * para o bucket privado (só depois de conferir acesso e janela) e manda o arquivo direto.
 */
export async function prepareVideoUpload(
  slug: string,
  input: z.input<typeof videoUploadSchema>,
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = videoUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  if (!VIDEO_TYPES.includes(parsed.data.mime)) return { ok: false, error: "Envie o vídeo em MP4 (o formato da câmera do celular)." };
  if (parsed.data.size > VIDEO_MAX) return { ok: false, error: "Vídeo grande demais: o WhatsApp aceita até 16 MB. Grave mais curto ou envie pelo celular." };
  const prep = await prepareMediaSend(ctx, parsed.data.conversationId);
  if (!prep.ok) return prep;
  const path = `${ctx.company.id}/${prep.p.conv.id}/envio-${crypto.randomUUID()}.mp4`;
  const { data, error } = await createAdminClient().storage.from("whatsapp-media").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Não foi possível preparar o envio. Tente de novo." };
  return { ok: true, path: data.path, token: data.token };
}

const videoSendSchema = z.object({ conversationId: z.uuid(), path: z.string().max(300), caption: z.string().max(1000) });

/** Envia o vídeo já guardado (prepareVideoUpload) e registra na conversa. */
export async function sendUploadedVideo(slug: string, input: z.input<typeof videoSendSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = videoSendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const d = parsed.data;
  const prep = await prepareMediaSend(ctx, d.conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;
  // Só aceita o arquivo que esta conversa acabou de receber.
  if (!new RegExp(`^${ctx.company.id}/${conv.id}/envio-[0-9a-f-]{36}\.mp4$`).test(d.path)) return { ok: false, error: "Arquivo inválido." };

  const bucket = createAdminClient().storage.from("whatsapp-media");
  const { data: signed } = await bucket.createSignedUrl(d.path, 3600);
  if (!signed) return { ok: false, error: "O vídeo não chegou. Tente enviar de novo." };
  const caption = d.caption.trim();
  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) => sendMediaMessage(phoneNumberId, token, dest, { kind: "video", link: signed.signedUrl, caption: caption || undefined }));
  } catch (e) {
    await bucket.remove([d.path]);
    return { ok: false, error: sendErrorMessage(e) };
  }
  const rec = await recordOutboundMessage(conv, { wamid, body: caption ? `[Vídeo] ${caption}` : "[Vídeo]", msgType: "video" }, ctx.viewer.id);
  // O arquivo fica onde está: a Meta baixa pelo link depois de aceitar o envio (ver sendPhoto).
  if (rec.ok) await createAdminClient().from("messages").update({ media_path: d.path, media_mime: "video/mp4" }).eq("id", rec.messageId);
  revalidatePath(`/${slug}/conversas`);
  return rec.ok ? { ok: true } : rec;
}

type FailedRow = { id: string; conversation_id: string; direction: string; sender: string; msg_type: string; body: string | null; media_path: string | null; status: string };

/**
 * Reenvia uma mensagem da equipe que não foi entregue à Meta ("não enviada"): texto, foto ou vídeo.
 * A mesma mensagem passa a valer com o novo envio (sem duplicar na conversa). Modelos não entram
 * aqui: os campos não ficam guardados, então o modelo é enviado de novo pelo seletor.
 */
export async function resendMessage(slug: string, messageId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  if (!z.uuid().safeParse(messageId).success) return { ok: false, error: "Mensagem inválida." };
  const { data: msg } = await ctx.supabase
    .from("messages")
    .select("id, conversation_id, direction, sender, msg_type, body, media_path, status")
    .eq("id", messageId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<FailedRow>();
  if (!msg || msg.direction !== "out" || msg.status !== "failed") return { ok: false, error: "Esta mensagem não está como não enviada." };
  if (msg.msg_type === "template") return { ok: false, error: "Para modelos, envie de novo pelo seletor de modelos (os campos precisam ser preenchidos)." };
  const text = (msg.body ?? "").replace(/^\[(Imagem|Vídeo|Áudio)\]\s*/, "").trim();

  const admin = createAdminClient();
  const done = async (newId: string) => {
    await admin.from("messages").update({ wa_message_id: newId, status: "sent", error: null, sent_at: new Date().toISOString() }).eq("id", msg.id);
    revalidatePath(`/${slug}/conversas`);
    return { ok: true as const, message: "Mensagem reenviada." };
  };

  const conv = await loadConversation(ctx, msg.conversation_id);
  if (conv?.channel === "instagram" || conv?.channel === "messenger") {
    if (msg.msg_type !== "text" || !text) return { ok: false, error: "No Instagram e no Messenger, só texto pode ser reenviado." };
    if (!ctx.manager && conv.assigned_to && conv.assigned_to !== ctx.viewer.id) return { ok: false, error: "Esta conversa é de outro vendedor." };
    try {
      const sent = await sendInstagramText(conv, text);
      if (!sent.ok) return sent;
      return done(sent.mid);
    } catch (e) {
      return { ok: false, error: instagramErrorText(e) };
    }
  }

  const prep = await prepareMediaSend(ctx, msg.conversation_id);
  if (!prep.ok) return prep;
  const { phoneNumberId, token, to } = prep.p;
  try {
    if (msg.msg_type === "text") {
      if (!text) return { ok: false, error: "Mensagem vazia." };
      return done(await sendWithNinthDigitRetry(to, (dest) => sendTextMessage(phoneNumberId, token, dest, text)));
    }
    const place = msg.msg_type === "location" ? parseLocationBody(msg.body) : null;
    if (place) {
      // O nome e o endereço ficam juntos no texto guardado: no reenvio vão como nome do local.
      return done(await sendWithNinthDigitRetry(to, (dest) => sendLocationMessage(phoneNumberId, token, dest, { ...place, name: place.label || null })));
    }
    if ((msg.msg_type === "image" || msg.msg_type === "video" || msg.msg_type === "audio") && msg.media_path) {
      const { data: signed } = await admin.storage.from("whatsapp-media").createSignedUrl(msg.media_path, 3600);
      if (!signed) return { ok: false, error: "O arquivo não está mais disponível. Envie de novo pelo Anexar." };
      const kind = msg.msg_type;
      return done(await sendWithNinthDigitRetry(to, (dest) => sendMediaMessage(phoneNumberId, token, dest, { kind, link: signed.signedUrl, caption: text || undefined })));
    }
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  return { ok: false, error: "Este tipo de mensagem não pode ser reenviado. Envie de novo pelo Anexar." };
}

/**
 * Mensagem de voz: a tela grava (ou escolhe um arquivo), converte em /api/audio/voz para OGG/Opus
 * e manda aqui. Guarda no bucket privado, envia por link assinado e registra na conversa.
 */
export async function sendAudio(slug: string, form: FormData): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const conversationId = String(form.get("conversationId") ?? "");
  const file = form.get("file");
  if (!z.uuid().safeParse(conversationId).success || !(file instanceof File)) return { ok: false, error: "Dados inválidos." };
  if (file.size > 3.5 * 1024 * 1024) return { ok: false, error: "Áudio grande demais." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "OggS") return { ok: false, error: "Formato de áudio inválido. Grave de novo." };

  const prep = await prepareMediaSend(ctx, conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;
  const admin = createAdminClient();
  const bucket = admin.storage.from("whatsapp-media");
  const tmp = `${ctx.company.id}/${conv.id}/envio-${crypto.randomUUID()}.ogg`;
  // A cópia guardada serve para a equipe ouvir no Orvya e como reserva do envio.
  const { error: up } = await bucket.upload(tmp, bytes, { contentType: VOICE_MIME });
  if (up) return { ok: false, error: "Não foi possível guardar o áudio. Tente de novo." };
  const { data: signed } = await bucket.createSignedUrl(tmp, 3600);
  if (!signed) return { ok: false, error: "Não foi possível preparar o áudio. Tente de novo." };

  // Mensagem de voz: o arquivo sobe direto para a Meta com o tipo exato (OGG/Opus) e vai marcado
  // como voz, para tocar no celular do cliente como áudio gravado (inclusive no iPhone).
  // Se a subida falhar, vai pelo link, como antes.
  let mediaId: string | undefined;
  try {
    mediaId = await uploadMedia(phoneNumberId, token, bytes, VOICE_MIME, "audio.ogg");
  } catch {
    mediaId = undefined;
  }

  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) => sendMediaMessage(phoneNumberId, token, dest, { kind: "audio", link: signed.signedUrl, mediaId, voice: true }));
  } catch (e) {
    await bucket.remove([tmp]);
    return { ok: false, error: sendErrorMessage(e) };
  }
  const rec = await recordOutboundMessage(conv, { wamid, body: "[Áudio]", msgType: "audio" }, ctx.viewer.id);
  // O arquivo fica onde está: a Meta baixa pelo link depois de aceitar o envio (ver sendPhoto).
  if (rec.ok) await admin.from("messages").update({ media_path: tmp, media_mime: "audio/ogg" }).eq("id", rec.messageId);
  revalidatePath(`/${slug}/conversas`);
  return rec.ok ? { ok: true } : rec;
}

const transferSchema = z.object({
  conversationId: z.uuid(),
  pipelineId: z.uuid("Escolha o funil."),
  /** Pessoa que recebe; vazio = automático (rodízio ou ordem de prioridade do funil). */
  userId: z.uuid().nullable(),
});

/**
 * Transferir o lead: muda de funil (1ª etapa) e/ou de pessoa. Sem pessoa escolhida, quem recebe
 * é o rodízio/ordem do funil (ex.: Varejo → CPAP cai com a Thays na IC e com a Isabela na LocPress).
 * Vendedor transfere as conversas dele e as da fila; gestor e admin, qualquer uma.
 */
export async function transferLead(slug: string, input: z.input<typeof transferSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const conv = await loadConversation(ctx, d.conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada." };
  if (!ctx.manager && conv.assigned_to && conv.assigned_to !== ctx.viewer.id) return { ok: false, error: "Esta conversa é de outro vendedor." };
  if (!conv.lead_id) return { ok: false, error: "Esta conversa não tem lead." };

  const admin = createAdminClient();
  const { data: lead } = await admin.from("leads").select("id, pipeline_id, owner_id, closed_at").eq("id", conv.lead_id).eq("company_id", ctx.company.id).maybeSingle<{ id: string; pipeline_id: string; owner_id: string | null; closed_at: string | null }>();
  if (!lead || lead.closed_at) return { ok: false, error: "O lead já foi finalizado." };
  const { data: pipeline } = await admin.from("pipelines").select("id, name").eq("id", d.pipelineId).eq("company_id", ctx.company.id).maybeSingle<{ id: string; name: string }>();
  if (!pipeline) return { ok: false, error: "Funil não encontrado." };
  let personName: string | null = null;
  if (d.userId) {
    const { data: m } = await admin.from("memberships").select("user_id, profiles(full_name, active)").eq("company_id", ctx.company.id).eq("user_id", d.userId).maybeSingle<{ user_id: string; profiles: { full_name: string | null; active: boolean } | null }>();
    if (!m?.profiles?.active) return { ok: false, error: "Esta pessoa não faz parte da equipe ativa da empresa." };
    personName = m.profiles.full_name;
  }

  // 1) Funil: a 1ª etapa aberta do funil novo. O banco passa o lead para quem recebe nesse funil.
  if (pipeline.id !== lead.pipeline_id) {
    const { data: stage } = await admin.from("stages").select("id").eq("pipeline_id", pipeline.id).eq("kind", "open").order("position").limit(1).maybeSingle<{ id: string }>();
    if (!stage) return { ok: false, error: "O funil não tem etapa aberta." };
    const { error } = await admin.from("leads").update({ pipeline_id: pipeline.id, stage_id: stage.id }).eq("id", lead.id);
    if (error) return { ok: false, error: "Não foi possível mudar o funil." };
  }
  // 2) Pessoa: escolhida, ou o próximo do rodízio/ordem (quando continua no mesmo funil).
  if (d.userId) {
    await admin.from("leads").update({ owner_id: d.userId }).eq("id", lead.id);
    await admin.from("conversations").update({ assigned_to: d.userId }).eq("id", conv.id);
  } else if (pipeline.id === lead.pipeline_id) {
    await admin.from("leads").update({ owner_id: null }).eq("id", lead.id);
    await admin.from("conversations").update({ assigned_to: null }).eq("id", conv.id);
    const { data: next } = await admin.rpc("assign_lead_by_rotation", { p_lead: lead.id });
    if (!next) {
      // Ninguém disponível agora: volta para quem estava, para não ficar sem dono.
      await admin.from("leads").update({ owner_id: lead.owner_id }).eq("id", lead.id);
      await admin.from("conversations").update({ assigned_to: lead.owner_id }).eq("id", conv.id);
      return { ok: false, error: "Ninguém disponível neste funil agora. O lead continua com quem estava." };
    }
  }

  const { data: after } = await admin.from("leads").select("owner_id, profiles:owner_id(full_name)").eq("id", lead.id).maybeSingle<{ owner_id: string | null; profiles: { full_name: string | null } | null }>();
  const who = personName ?? after?.profiles?.full_name ?? "a fila";
  await admin.from("activities").insert({
    company_id: ctx.company.id,
    lead_id: lead.id,
    kind: "assignment",
    user_id: ctx.viewer.id,
    body: `Transferido por ${ctx.viewer.fullName}: funil ${pipeline.name}, com ${who}.`,
  });
  revalidatePath(`/${slug}/conversas`);
  revalidatePath(`/${slug}/funil`);
  return { ok: true, message: `Lead transferido para ${pipeline.name}, com ${who}.` };
}

const menuSchema = z.object({ conversationId: z.uuid(), text: z.string().trim().min(1, "Escreva a mensagem.").max(1024, "Texto de no máximo 1.024 caracteres.") });

/**
 * Resposta com os botões de assunto (ex.: /saudacao): o texto vai com os botões da triagem da
 * empresa (Automações → Triagem no WhatsApp). O botão tocado leva o lead ao funil certo.
 */
export async function sendMenuReply(slug: string, input: z.input<typeof menuSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = menuSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const prep = await prepareMediaSend(ctx, parsed.data.conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;

  const { data: cfg } = await ctx.supabase
    .from("whatsapp_triage")
    .select("options")
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ options: { title?: string; pipeline_id?: string | null }[] | null }>();
  const options = (cfg?.options ?? []).filter((o) => o.title?.trim() && o.pipeline_id).slice(0, 3);
  if (!options.length) return { ok: false, error: "Cadastre os botões em Automações → Triagem no WhatsApp." };

  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) =>
      sendButtonsMessage(phoneNumberId, token, dest, parsed.data.text, options.map((o) => ({ id: `TRIAGEM:${o.pipeline_id}`, title: o.title!.trim() }))),
    );
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const body = `${parsed.data.text}\nOpções: ${options.map((o) => o.title!.trim()).join(" · ")}`;
  const rec = await recordOutboundMessage(conv, { wamid, body, msgType: "text" }, ctx.viewer.id);
  revalidatePath(`/${slug}/conversas`);
  return rec.ok ? { ok: true } : rec;
}

// ---------------------------------------------------------------------
// Localização: enviar um ponto (loja, endereço de entrega, onde a pessoa está), pedir a do
// cliente e manter os locais salvos da empresa (migration 0040).
// ---------------------------------------------------------------------

const coord = { latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) };
const optionalText = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what} longo demais (máximo de ${max} caracteres).`)
    .optional()
    .transform((v) => v || null);

const locationSchema = z.object({
  conversationId: z.uuid(),
  ...coord,
  name: optionalText(80, "Nome"),
  address: optionalText(200, "Endereço"),
});

/**
 * Envia uma localização. WhatsApp: cartão com mapa (mensagem livre, só na janela de 24 h).
 * Instagram e Messenger não têm esse tipo de mensagem: vai o texto com o link do mapa.
 */
export async function sendLocation(slug: string, input: z.input<typeof locationSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Localização inválida." };
  const { conversationId, ...place } = parsed.data;
  const body = locationBody(place);
  const preview = `[Localização] ${placeLabel(place)}`.trim();

  const igConv = await loadConversation(ctx, conversationId);
  if (igConv?.channel === "instagram" || igConv?.channel === "messenger") {
    if (!ctx.manager && igConv.assigned_to && igConv.assigned_to !== ctx.viewer.id) return { ok: false, error: "Esta conversa é de outro vendedor." };
    const text = [place.name, place.address, mapsUrl(place)].filter(Boolean).join("\n");
    let sent: Awaited<ReturnType<typeof sendInstagramText>>;
    try {
      sent = await sendInstagramText(igConv, text);
    } catch (e) {
      return { ok: false, error: instagramErrorText(e) };
    }
    if (!sent.ok) return sent;
    const r = await recordOutbound(ctx, igConv, { wamid: sent.mid, body, msgType: "location", preview });
    revalidatePath(`/${slug}/conversas`);
    return r;
  }

  const prep = await prepareMediaSend(ctx, conversationId);
  if (!prep.ok) return prep;
  const { conv, phoneNumberId, token, to } = prep.p;
  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) => sendLocationMessage(phoneNumberId, token, dest, place));
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const r = await recordOutbound(ctx, conv, { wamid, body, msgType: "location", preview });
  revalidatePath(`/${slug}/conversas`);
  return r;
}

const requestSchema = z.object({
  conversationId: z.uuid(),
  text: z.string().trim().min(1, "Escreva o pedido.").max(1024, "Pedido longo demais (máximo de 1.024 caracteres)."),
});

/** Pede a localização do cliente: ele recebe o texto com o botão "Enviar localização" (só WhatsApp). */
export async function requestLocation(slug: string, input: z.input<typeof requestSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Pedido inválido." };
  const prep = await prepareMediaSend(ctx, parsed.data.conversationId);
  if (!prep.ok) {
    // prepareSend recusa conversas do Instagram com um texto sobre modelos; aqui o motivo é outro.
    const other = await loadConversation(ctx, parsed.data.conversationId);
    if (other && other.channel !== "whatsapp") return { ok: false, error: "O pedido de localização com botão só existe no WhatsApp. Peça por texto." };
    return prep;
  }
  const { conv, phoneNumberId, token, to } = prep.p;
  let wamid: string;
  try {
    wamid = await sendWithNinthDigitRetry(to, (dest) => sendLocationRequest(phoneNumberId, token, dest, parsed.data.text));
  } catch (e) {
    return { ok: false, error: sendErrorMessage(e) };
  }
  const r = await recordOutbound(ctx, conv, {
    wamid,
    body: `${parsed.data.text}\n[Botão: Enviar localização]`,
    msgType: "interactive",
    preview: parsed.data.text,
  });
  revalidatePath(`/${slug}/conversas`);
  return r;
}

const MAPS_HELP =
  "Não encontrei as coordenadas neste link. Abra o local no Google Maps, toque em Compartilhar e copie o link, ou informe as coordenadas (ex.: -5.0892, -42.8016).";

/**
 * Coordenadas de um link do Google Maps. O link curto (maps.app.goo.gl) não traz as coordenadas:
 * o servidor segue o redirecionamento, só entre endereços do próprio Google.
 */
export async function resolveMapsLink(
  slug: string,
  link: string,
): Promise<{ ok: true; latitude: number; longitude: number } | { ok: false; error: string }> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const direct = parseCoordinates(link);
  if (direct) return { ok: true, ...direct };

  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return { ok: false, error: MAPS_HELP };
  }
  let found: Coordinates | null = null;
  try {
    for (let hop = 0; hop < 6 && !found; hop++) {
      if (url.protocol !== "https:" || !isGoogleMapsHost(url.hostname)) break;
      const res = await fetch(url, { redirect: "manual", cache: "no-store", headers: { "accept-language": "pt-BR" }, signal: AbortSignal.timeout(6000) });
      const next = res.headers.get("location");
      if (next) {
        url = new URL(next, url);
        // A página de consentimento do Google leva o destino no parâmetro "continue".
        found = parseCoordinates(url.toString()) ?? parseCoordinates(url.searchParams.get("continue") ?? "");
        continue;
      }
      if (res.ok) {
        // Sem redirecionamento: as coordenadas costumam vir na prévia do mapa dentro da página.
        const html = (await res.text()).slice(0, 400_000);
        const m = /center=(-?\d{1,3}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/.exec(html) ?? /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(html);
        if (m) found = parseCoordinates(`${m[1]}, ${m[2]}`);
      }
      break;
    }
  } catch {
    return { ok: false, error: "Não foi possível abrir o link do Google Maps agora. Tente de novo ou informe as coordenadas." };
  }
  return found ? { ok: true, ...found } : { ok: false, error: MAPS_HELP };
}

export type SavedPlace = { id: string; name: string; address: string | null; latitude: number; longitude: number };

const placeSchema = z.object({
  ...coord,
  name: z.string().trim().min(1, "Dê um nome ao local (ex.: Loja LocPress).").max(80, "Nome longo demais (máximo de 80 caracteres)."),
  address: optionalText(200, "Endereço"),
});

/** Salva um local da empresa para toda a equipe enviar (só gestão; o RLS confere de novo). */
export async function savePlace(slug: string, input: z.input<typeof placeSchema>): Promise<ActionResult & { place?: SavedPlace }> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  if (!ctx.manager) return { ok: false, error: "Só a gestão salva locais da empresa." };
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Local inválido." };
  const { data, error } = await ctx.supabase
    .from("company_places")
    .insert({ company_id: ctx.company.id, created_by: ctx.viewer.id, ...parsed.data })
    .select("id, name, address, latitude, longitude")
    .single<SavedPlace>();
  if (error || !data) {
    if (error?.code === "23505") return { ok: false, error: "Já existe um local salvo com este nome." };
    if (error?.code === "PGRST205" || error?.code === "42P01") {
      return { ok: false, error: "Os locais salvos ainda não foram ativados no banco (migration 0040). Enquanto isso, envie pelo link ou pela localização atual." };
    }
    return { ok: false, error: "Não foi possível salvar o local." };
  }
  revalidatePath(`/${slug}/conversas`);
  return { ok: true, message: "Local salvo para a equipe.", place: data };
}

/** Exclui um local salvo (só gestão). */
export async function deletePlace(slug: string, id: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  if (!ctx.manager) return { ok: false, error: "Só a gestão exclui locais da empresa." };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Local inválido." };
  const { error } = await ctx.supabase.from("company_places").delete().eq("id", id).eq("company_id", ctx.company.id);
  if (error) return { ok: false, error: "Não foi possível excluir o local." };
  revalidatePath(`/${slug}/conversas`);
  return { ok: true, message: "Local excluído." };
}
