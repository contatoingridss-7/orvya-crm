import "server-only";

import { graphBase } from "./config";
import { graph, GraphError } from "./graph";

// Cadastro integrado da Meta (Embedded Signup), com o app da VÉR7ICE como Tech Provider.
// O cliente entra com a conta dele, escolhe o número (inclusive o que já usa no app
// WhatsApp Business: coexistência) e o Orvya recebe um token da empresa, sem copiar nada.

export type SignupConfig = { appId: string; configId: string };

/** IDs públicos para a tela (o segredo nunca sai do servidor). Null = cadastro integrado não configurado. */
export function signupConfig(): SignupConfig | null {
  const appId = process.env.META_ES_APP_ID?.trim();
  const configId = process.env.META_ES_CONFIG_ID?.trim();
  return appId && configId && process.env.META_ES_APP_SECRET?.trim() ? { appId, configId } : null;
}

/** Troca o código do cadastro (vale 30 segundos) pelo token da empresa (usuário do sistema de integração). */
export async function exchangeSignupCode(code: string): Promise<string> {
  const appId = process.env.META_ES_APP_ID?.trim();
  const secret = process.env.META_ES_APP_SECRET?.trim();
  if (!appId || !secret) throw new GraphError("Cadastro integrado da Meta não configurado na Vercel.", 503);
  const params = new URLSearchParams({ client_id: appId, client_secret: secret, code });
  const res = await fetch(`${graphBase()}/oauth/access_token?${params}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string; code?: number } };
  if (!res.ok || !data.access_token) {
    throw new GraphError(data.error?.message ?? "A Meta não liberou o acesso. Tente conectar de novo.", res.status, data.error?.code);
  }
  return data.access_token;
}

type WabaPhone = { id: string; display_phone_number?: string; is_on_biz_app?: boolean };

/** Número da conta, quando a Meta não o devolve na tela (coexistência): o que está no app, ou o único. */
export async function findWabaPhone(wabaId: string, token: string): Promise<string | null> {
  const res = await graph<{ data?: WabaPhone[] }>(`${wabaId}/phone_numbers?fields=id,display_phone_number,is_on_biz_app`, token);
  const list = res.data ?? [];
  return (list.find((p) => p.is_on_biz_app) ?? (list.length === 1 ? list[0] : undefined))?.id ?? null;
}

/** Coexistência: pede a sincronização de contatos e do histórico do app (uma vez cada, até 24 h depois de conectar). */
export async function requestAppSync(phoneNumberId: string, token: string): Promise<string[]> {
  const failures: string[] = [];
  for (const syncType of ["smb_app_state_sync", "history"] as const) {
    try {
      await graph(`${phoneNumberId}/smb_app_data`, token, { method: "POST", body: { messaging_product: "whatsapp", sync_type: syncType } });
    } catch (e) {
      failures.push(`${syncType === "history" ? "histórico" : "contatos"}: ${e instanceof Error ? e.message : "sem resposta"}`);
    }
  }
  return failures;
}
