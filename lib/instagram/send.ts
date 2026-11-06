import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SendConversation } from "@/lib/whatsapp/send";
import { sendDirectText } from "./graph";
import { instagramWindow } from "./window";

/** Envia texto da equipe pelo Direct. Conferência de permissão (RLS) fica com quem chama. */
export async function sendInstagramText(conv: SendConversation, text: string): Promise<{ ok: true; mid: string } | { ok: false; error: string }> {
  const window = instagramWindow(conv.last_inbound_at);
  if (window === "closed") {
    return { ok: false, error: "O Instagram e o Messenger só permitem responder até 7 dias depois da última mensagem do cliente. Aguarde ele escrever de novo." };
  }
  // Messenger usa a mesma Página (e o mesmo token) da conta do Instagram conectada.
  const igsid = conv.channel === "messenger" ? conv.contacts?.messenger_id : conv.contacts?.instagram_id;
  if (!igsid || !conv.instagram_account_id) return { ok: false, error: "Esta conversa não está ligada à Página da empresa." };

  const admin = createAdminClient();
  const [{ data: account }, { data: cred }] = await Promise.all([
    admin.from("instagram_accounts").select("page_id, status").eq("id", conv.instagram_account_id).maybeSingle<{ page_id: string; status: string }>(),
    admin.from("instagram_credentials").select("page_access_token").eq("account_id", conv.instagram_account_id).maybeSingle<{ page_access_token: string }>(),
  ]);
  if (!account || account.status !== "connected" || !cred) return { ok: false, error: "O Instagram desta empresa não está conectado. Veja em Canais." };

  const mid = await sendDirectText(account.page_id, cred.page_access_token, igsid, text, window === "human");
  return { ok: true, mid };
}
