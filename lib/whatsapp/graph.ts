import "server-only";

import { graphBase } from "./config";

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

type GraphErrorBody = { error?: { message?: string; code?: number; error_user_msg?: string } };

/** Chamada à Graph API da Meta com o token do número (nunca sai do servidor). */
export async function graph<T>(path: string, token: string, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${graphBase()}/${path.replace(/^\//, "")}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || data.error) {
    const e = data.error;
    throw new GraphError(e?.error_user_msg || e?.message || `Erro ${res.status} na Meta`, res.status, e?.code);
  }
  return data;
}

export type PhoneNumberInfo = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
};

/** Confere se o token tem acesso ao número e devolve os dados públicos dele. */
export function fetchPhoneNumber(phoneNumberId: string, token: string) {
  return graph<PhoneNumberInfo>(`${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, token);
}

/** Inscreve o app na conta do WhatsApp (WABA) para os webhooks chegarem. */
export function subscribeApp(wabaId: string, token: string) {
  return graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, token, { method: "POST" });
}
