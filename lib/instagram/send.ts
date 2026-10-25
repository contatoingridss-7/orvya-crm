import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SendConversation } from "@/lib/whatsapp/send";
import { sendDirectText } from "./graph";
import { instagramWindow } from "./window";

/** Envia texto da equipe pelo Direct. Conferência de permissão (RLS) fica com quem chama. */
export async function sendInstagramText(conv: SendConversation, text: string): Promise<{ ok: true; mid: string } | { ok: false; error: string }> {
  const window = instagramWindow(conv.last_inbound_at);
  if (window === "closed") {
    return { ok: false, error: "O Instagram só permite responder até 7 dias depois da última mensagem do cliente. Aguarde ele escrever de novo." };
  }
  const igsid = conv.contacts?.instagram_id;
  if (!igsid || !conv.instagram_account_id) return { ok: false, error: "Esta conversa não está ligada a uma conta do Instagram." };

  const admin = createAdminClient();
  const [{ data: account }, { data: cred }] = await Promise.all([
    admin.from("instagram_accounts").select("page_id, status").eq("id", conv.instagram_account_id).maybeSingle<{ page_id: string; status: string }>(),
    admin.from("instagram_credentials").select("page_access_token").eq("account_id", conv.instagram_account_id).maybeSingle<{ page_access_token: string }>(),
  ]);
  if (!account || account.status !== "connected" || !cred) return { ok: false, error: "O Instagram desta empresa não está conectado. Veja em Canais." };

  const mid = await sendDirectText(account.page_id, cred.page_access_token, igsid, text, window === "human");
  return { ok: true, mid };
}
