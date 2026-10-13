"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { GraphError, markAsRead, sendTextMessage } from "@/lib/whatsapp/graph";
import { isWindowOpen } from "@/lib/whatsapp/window";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function context(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company) return null;
  return { viewer, company, manager: isManager(company.role), supabase: await createClient() };
}
type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>;

const NO_ACCESS = { ok: false as const, error: "Sem acesso a esta empresa." };

type ConvRow = {
  id: string;
  company_id: string;
  assigned_to: string | null;
  lead_id: string | null;
  last_inbound_at: string | null;
  whatsapp_number_id: string | null;
  contacts: { phone_e164: string | null } | null;
  whatsapp_numbers: { phone_number_id: string | null; status: string } | null;
};

/** Carrega a conversa pelo cliente do usuário: se o RLS esconder, ele não tem acesso (docs/WHATSAPP.md, seção 4.1). */
async function loadConversation(ctx: Ctx, conversationId: string) {
  const { data } = await ctx.supabase
    .from("conversations")
    .select("id, company_id, assigned_to, lead_id, last_inbound_at, whatsapp_number_id, contacts(phone_e164), whatsapp_numbers(phone_number_id, status)")
    .eq("id", conversationId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<ConvRow>();
  return data;
}

function tokenError(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.code === 190) return "O token de acesso do número expirou. Reconecte o número em Canais com um token permanente.";
    if (e.code === 131047) return "A janela de 24 horas fechou. Use um modelo de mensagem aprovado.";
    if (e.code === 131030) return "Este número não está na lista de destinatários permitidos do número de teste da Meta.";
    return `A Meta recusou o envio: ${e.message}`;
  }
  return "Não foi possível enviar a mensagem.";
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

  const conv = await loadConversation(ctx, parsed.data.conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada." };
  // Vendedor responde nas dele e nas da fila (e passa a ser o responsável); gestor/admin em todas.
  if (!ctx.manager && conv.assigned_to && conv.assigned_to !== ctx.viewer.id) {
    return { ok: false, error: "Esta conversa é de outro vendedor." };
  }

  const number = conv.whatsapp_numbers;
  if (!number?.phone_number_id || number.status !== "connected") {
    return { ok: false, error: "O número desta conversa não está conectado. Veja em Canais e integrações." };
  }
  // Janela de 24 h conferida no servidor, não só na tela (CLAUDE.md, regra 4).
  if (!isWindowOpen(conv.last_inbound_at)) {
    return { ok: false, error: "A janela de 24 horas está fechada. Fora dela, só modelos de mensagem aprovados." };
  }
  const to = conv.contacts?.phone_e164?.replace(/\D/g, "");
  if (!to) return { ok: false, error: "O contato não tem telefone." };

  const admin = createAdminClient();
  const { data: cred } = await admin.from("whatsapp_credentials").select("access_token").eq("number_id", conv.whatsapp_number_id!).maybeSingle<{ access_token: string }>();
  if (!cred) return { ok: false, error: "O número não tem token de acesso. Reconecte em Canais." };

  let wamid: string;
  try {
    wamid = await sendTextMessage(number.phone_number_id, cred.access_token, to, parsed.data.text);
  } catch (e) {
    return { ok: false, error: tokenError(e) };
  }

  const now = new Date().toISOString();
  const { error: msgError } = await admin.from("messages").insert({
    company_id: conv.company_id,
    conversation_id: conv.id,
    direction: "out",
    sender: "user",
    user_id: ctx.viewer.id,
    msg_type: "text",
    body: parsed.data.text,
    wa_message_id: wamid,
    status: "sent",
    source: "orvya",
    sent_at: now,
  });
  if (msgError) return { ok: false, error: "A mensagem foi enviada, mas não ficou registrada. Recarregue a página." };

  // Equipe respondeu: a IA pausa nesta conversa (CLAUDE.md, regra 8) e quem respondeu assume, se estava na fila.
  await admin
    .from("conversations")
    .update({
      ai_enabled: false,
      needs_human: false,
      assigned_to: conv.assigned_to ?? ctx.viewer.id,
      last_message_at: now,
      last_preview: parsed.data.text.slice(0, 160),
      last_direction: "out",
    })
    .eq("id", conv.id);
  if (conv.lead_id) {
    const { data: lead } = await admin.from("leads").select("owner_id").eq("id", conv.lead_id).maybeSingle<{ owner_id: string | null }>();
    await admin
      .from("leads")
      .update({ last_contact_at: now, ...(lead && !lead.owner_id ? { owner_id: ctx.viewer.id } : {}) })
      .eq("id", conv.lead_id);
  }

  revalidatePath(`/${slug}/conversas`);
  return { ok: true };
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
