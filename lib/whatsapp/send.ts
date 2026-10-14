import "server-only";

// Envio pelo WhatsApp compartilhado entre as ações da tela Conversas e a fila de envio
// (docs/WHATSAPP.md, seção 4). Quem chama é responsável por conferir a permissão do usuário
// (cliente autenticado + RLS) antes; aqui só ficam as regras do envio em si.

import { createAdminClient } from "@/lib/supabase/admin";
import { GraphError, sendTemplateMessage } from "./graph";
import { fillTemplate } from "./templates";

/** Colunas da conversa necessárias para enviar (vale para o cliente do usuário e o admin). */
export const SEND_CONVERSATION_SELECT =
  "id, company_id, assigned_to, lead_id, last_inbound_at, whatsapp_number_id, contacts(phone_e164), whatsapp_numbers(phone_number_id, status)";

export type SendConversation = {
  id: string;
  company_id: string;
  assigned_to: string | null;
  lead_id: string | null;
  last_inbound_at: string | null;
  whatsapp_number_id: string | null;
  contacts: { phone_e164: string | null } | null;
  whatsapp_numbers: { phone_number_id: string | null; status: string } | null;
};

export type Destination = { phoneNumberId: string; token: string; to: string };

/** Mensagem de erro da Meta em português, para a tela e para a fila de envio. */
export function sendErrorMessage(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.code === 190) return "O token de acesso do número expirou. Reconecte o número em Canais com um token permanente.";
    if (e.code === 131047) return "A janela de 24 horas fechou. Use um modelo de mensagem aprovado.";
    if (e.code === 131030) return "Este número não está na lista de destinatários permitidos do número de teste da Meta.";
    if (e.code === 132001) return "A Meta não encontrou este modelo para o número da conversa. Confira se ele foi aprovado na mesma conta e clique em “Atualizar status” em Canais.";
    if (e.code === 132000) return "A quantidade de campos não bate com o modelo aprovado na Meta. Atualize o status em Canais.";
    if (e.code === 132015) return "Este modelo foi pausado pela Meta por baixa qualidade. Use outro modelo.";
    if (e.code === 132016) return "Este modelo foi desativado pela Meta. Use outro modelo.";
    if (e.code === 131049) return "A Meta segurou a entrega para preservar a qualidade (limite de mensagens de marketing para este cliente). Tente mais tarde.";
    return `A Meta recusou o envio: ${e.message}`;
  }
  return "Não foi possível enviar a mensagem.";
}

/**
 * Celular brasileiro: a Meta às vezes identifica o cliente sem o nono dígito (5586 9999-0000),
 * mas o número pode estar registrado com ele (5586 99999-0000), e vice-versa. Se a Meta recusar
 * o destinatário (131030 = fora da lista do número de teste; 131026 = não entregável),
 * tenta uma vez com a outra versão.
 */
export async function sendWithNinthDigitRetry(to: string, send: (dest: string) => Promise<string>): Promise<string> {
  try {
    return await send(to);
  } catch (e) {
    const retryable = e instanceof GraphError && (e.code === 131030 || e.code === 131026);
    const alt = ninthDigitVariant(to);
    if (!retryable || !alt) throw e;
    return send(alt);
  }
}

function ninthDigitVariant(digits: string): string | null {
  if (!digits.startsWith("55")) return null;
  if (digits.length === 12 && /[6-9]/.test(digits[4] ?? "")) return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  if (digits.length === 13 && digits[4] === "9") return `${digits.slice(0, 4)}${digits.slice(5)}`;
  return null;
}

/** Número conectado, telefone do contato e token (lido com service_role) antes de qualquer envio. */
export async function resolveDestination(conv: SendConversation): Promise<{ ok: true; d: Destination } | { ok: false; error: string }> {
  const number = conv.whatsapp_numbers;
  if (!number?.phone_number_id || number.status !== "connected") {
    return { ok: false, error: "O número desta conversa não está conectado. Veja em Canais e integrações." };
  }
  const to = conv.contacts?.phone_e164?.replace(/\D/g, "");
  if (!to) return { ok: false, error: "O contato não tem telefone." };

  const { data: cred } = await createAdminClient()
    .from("whatsapp_credentials")
    .select("access_token")
    .eq("number_id", conv.whatsapp_number_id!)
    .maybeSingle<{ access_token: string }>();
  if (!cred) return { ok: false, error: "O número não tem token de acesso. Reconecte em Canais." };
  return { ok: true, d: { phoneNumberId: number.phone_number_id, token: cred.access_token, to } };
}

export type ApprovedTemplate = { name: string; language: string; body: string; variables: string[] | null };

/** Envia um modelo aprovado (com o retry do nono dígito). Devolve o wamid e o texto final. */
export async function deliverTemplate(d: Destination, tpl: ApprovedTemplate, values: string[]): Promise<{ wamid: string; body: string }> {
  const wamid = await sendWithNinthDigitRetry(d.to, (dest) =>
    sendTemplateMessage(d.phoneNumberId, d.token, dest, { name: tpl.name, language: tpl.language, params: values }),
  );
  return { wamid, body: fillTemplate(tpl.body, tpl.variables ?? [], values) };
}

/**
 * Registra a mensagem enviada e atualiza conversa e lead (docs/WHATSAPP.md, seção 4, passos 5 e 6).
 * Equipe respondeu: a IA pausa nesta conversa (CLAUDE.md, regra 8) e quem enviou assume, se estava na fila.
 * `preferLeadOwner`: na fila de envio, a conversa sem responsável vai para o dono do lead (se houver),
 * e não para o gestor que agendou.
 */
export async function recordOutboundMessage(
  conv: SendConversation,
  msg: { wamid: string; body: string; msgType: "text" | "template"; templateName?: string },
  userId: string | null,
  opts: { preferLeadOwner?: boolean } = {},
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: inserted, error: msgError } = await admin
    .from("messages")
    .insert({
      company_id: conv.company_id,
      conversation_id: conv.id,
      direction: "out",
      sender: "user",
      user_id: userId,
      msg_type: msg.msgType,
      template_name: msg.templateName ?? null,
      body: msg.body,
      wa_message_id: msg.wamid,
      status: "sent",
      source: "orvya",
      sent_at: now,
    })
    .select("id")
    .single<{ id: string }>();
  if (msgError || !inserted) return { ok: false, error: "A mensagem foi enviada, mas não ficou registrada. Recarregue a página." };

  const lead = conv.lead_id
    ? (await admin.from("leads").select("owner_id").eq("id", conv.lead_id).maybeSingle<{ owner_id: string | null }>()).data
    : null;
  const assignee = conv.assigned_to ?? (opts.preferLeadOwner ? lead?.owner_id : null) ?? userId;

  await admin
    .from("conversations")
    .update({
      ai_enabled: false,
      needs_human: false,
      assigned_to: assignee,
      last_message_at: now,
      last_preview: msg.body.slice(0, 160),
      last_direction: "out",
    })
    .eq("id", conv.id);
  if (conv.lead_id) {
    // Lead sem responsável: na tela vira de quem enviou; na fila, de quem ficou com a conversa.
    const newOwner = opts.preferLeadOwner ? assignee : userId;
    await admin
      .from("leads")
      .update({ last_contact_at: now, ...(lead && !lead.owner_id && newOwner ? { owner_id: newOwner } : {}) })
      .eq("id", conv.lead_id);
  }
  return { ok: true, messageId: inserted.id };
}
