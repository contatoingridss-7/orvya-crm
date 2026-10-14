import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type WabaAccount = { wabaId: string; token: string };

type Row = { id: string; waba_id: string | null; whatsapp_credentials: { access_token: string } | { access_token: string }[] | null };

/**
 * Contas do WhatsApp (WABA) dos números conectados da empresa, uma por WABA distinta,
 * com o token de um número conectado dela. Só servidor (cliente service_role).
 */
export async function connectedAccounts(admin: SupabaseClient, companyId: string): Promise<WabaAccount[]> {
  const { data } = await admin
    .from("whatsapp_numbers")
    .select("id, waba_id, whatsapp_credentials(access_token)")
    .eq("company_id", companyId)
    .eq("status", "connected")
    .not("waba_id", "is", null)
    .order("slot")
    .returns<Row[]>();

  const byWaba = new Map<string, WabaAccount>();
  for (const n of data ?? []) {
    const cred = Array.isArray(n.whatsapp_credentials) ? n.whatsapp_credentials[0] : n.whatsapp_credentials;
    const token = cred?.access_token;
    if (n.waba_id && token && !byWaba.has(n.waba_id)) byWaba.set(n.waba_id, { wabaId: n.waba_id, token });
  }
  return [...byWaba.values()];
}
