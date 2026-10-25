import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { googleErrorText, listGoogleAccounts, type GoogleAccount } from "./google";

const GRANT_TTL_MS = 60 * 60 * 1000;

/** Acesso recém-autorizado pela própria pessoa, dentro de 1 hora. Usa o cliente service_role. */
export async function loadGoogleGrant(admin: SupabaseClient, grantId: string, viewerId: string): Promise<{ refreshToken: string } | null> {
  const { data } = await admin
    .from("ad_oauth_grants")
    .select("refresh_token, created_at")
    .eq("id", grantId)
    .eq("created_by", viewerId)
    .maybeSingle<{ refresh_token: string; created_at: string }>();
  if (!data || Date.now() - new Date(data.created_at).getTime() > GRANT_TTL_MS) return null;
  return { refreshToken: data.refresh_token };
}

export type GoogleChoice = { grantId: string; accounts: GoogleAccount[] } | { grantId: string; error: string };

/** Contas que o login alcança, para a administradora escolher qual liga a esta empresa. */
export async function loadGoogleChoice(admin: SupabaseClient, grantId: string, viewerId: string): Promise<GoogleChoice> {
  const grant = await loadGoogleGrant(admin, grantId, viewerId);
  if (!grant) return { grantId, error: "O login da Google expirou. Clique em Conectar Google Ads de novo." };
  try {
    return { grantId, accounts: await listGoogleAccounts(grant.refreshToken) };
  } catch (e) {
    return { grantId, error: googleErrorText(e) };
  }
}
