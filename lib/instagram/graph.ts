import "server-only";

import { graph, GraphError } from "@/lib/whatsapp/graph";

// API de Mensagens do Instagram (login do Facebook): envio pela Página ligada à conta
// profissional, com o token da Página. Mesmo host e versão da Graph API do WhatsApp.

export type IgPage = { pageId: string; pageName: string; pageToken: string; igUserId: string; username: string | null; name: string | null };

/** Páginas que o token (usuário do sistema) acessa e que têm conta profissional do Instagram ligada. */
export async function listInstagramPages(systemToken: string): Promise<IgPage[]> {
  const res = await graph<{
    data: { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string; name?: string } }[];
  }>("me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=100", systemToken);
  return res.data
    .filter((p) => p.instagram_business_account?.id && p.access_token)
    .map((p) => ({
      pageId: p.id,
      pageName: p.name,
      pageToken: p.access_token!,
      igUserId: p.instagram_business_account!.id,
      username: p.instagram_business_account!.username ?? null,
      name: p.instagram_business_account!.name ?? null,
    }));
}

/** Instala o app na Página para os webhooks do Instagram chegarem (exige pages_manage_metadata). */
export function subscribePage(pageId: string, pageToken: string) {
  return graph<{ success?: boolean }>(`${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed`, pageToken, { method: "POST" });
}

/**
 * Ativa os avisos: pela Página e, se a Meta recusar (app sem pages_manage_metadata), direto na conta
 * do Instagram. Devolve o erro só quando os dois caminhos falham; a conexão segue assim mesmo.
 */
export async function subscribeInstagram(pageId: string, igUserId: string, pageToken: string): Promise<string | null> {
  try {
    await subscribePage(pageId, pageToken);
    return null;
  } catch (pageError) {
    try {
      await graph<{ success?: boolean }>(`${igUserId}/subscribed_apps?subscribed_fields=messages,comments`, pageToken, { method: "POST" });
      return null;
    } catch {
      return instagramErrorText(pageError);
    }
  }
}

type SendResult = { recipient_id?: string; message_id?: string };

/**
 * Envia texto no Direct. Dentro de 24 h após a última mensagem do cliente: envio normal.
 * De 24 h a 7 dias, só resposta de uma pessoa da equipe, com a etiqueta HUMAN_AGENT.
 */
export async function sendDirectText(
  pageId: string,
  pageToken: string,
  igsid: string,
  text: string,
  humanAgentTag = false,
  quickReplies?: { title: string; payload: string }[],
): Promise<string> {
  const res = await graph<SendResult>(`${pageId}/messages`, pageToken, {
    method: "POST",
    body: {
      recipient: { id: igsid },
      // Botões de resposta rápida (até 13): somem depois que a pessoa toca em um.
      message: quickReplies?.length ? { text, quick_replies: quickReplies.map((q) => ({ content_type: "text", ...q })) } : { text },
      ...(humanAgentTag ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
    },
  });
  if (!res.message_id) throw new GraphError("A Meta não confirmou o envio.", 502);
  return res.message_id;
}

/** Resposta privada a um comentário (uma por comentário, até 7 dias depois dele). */
export async function sendPrivateReply(pageId: string, pageToken: string, commentId: string, text: string): Promise<string> {
  const res = await graph<SendResult>(`${pageId}/messages`, pageToken, {
    method: "POST",
    body: { recipient: { comment_id: commentId }, message: { text } },
  });
  if (!res.message_id) throw new GraphError("A Meta não confirmou o envio.", 502);
  return res.message_id;
}

/** Nome e @ do cliente (só depois que ele mandou mensagem: é a regra de consentimento da Meta). */
export async function fetchIgProfile(igsid: string, pageToken: string): Promise<{ name: string | null; username: string | null }> {
  try {
    const p = await graph<{ name?: string; username?: string }>(`${igsid}?fields=name,username`, pageToken);
    return { name: p.name ?? null, username: p.username ?? null };
  } catch {
    return { name: null, username: null };
  }
}

export function instagramErrorText(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.code === 190) return "O token da Página expirou. Reconecte o Instagram em Canais.";
    if (e.code === 10 || e.code === 200) {
      return "Sem permissão para enviar: confira as permissões do token (instagram_manage_messages) e se o app tem acesso avançado aprovado pela Meta.";
    }
    if (e.code === 551 || /outside of allowed window|janela/i.test(e.message)) {
      return "Fora do prazo do Instagram: só dá para responder até 24 horas depois da última mensagem do cliente (7 dias para resposta da equipe).";
    }
    return `A Meta recusou: ${e.message}`;
  }
  return "Não foi possível enviar pelo Instagram.";
}
