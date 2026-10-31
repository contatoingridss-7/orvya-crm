import type { SupabaseClient } from "@supabase/supabase-js";

// Direcionamento por palavra-chave: a primeira mensagem do cliente escolhe o funil do lead novo
// (ex.: "cpap" abre no funil CPAP). Configurado em Automações → Distribuição de leads (migration 0020).
// O rodízio entre vendedores acontece depois, no banco, já no funil escolhido.

export type Route = { pipeline_id: string; keywords: string[] };

export const normalizeKeyword = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Primeira rota cuja palavra-chave aparece no texto (comparação sem acento e sem maiúscula). */
export function matchRoute(routes: Route[], text: string | null | undefined): string | null {
  if (!text) return null;
  const t = normalizeKeyword(text);
  for (const r of routes) {
    if (r.keywords.some((k) => {
      const nk = normalizeKeyword(k);
      return nk.length >= 3 && t.includes(nk);
    })) return r.pipeline_id;
  }
  return null;
}

export function parseRoutes(value: unknown): Route[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is { pipeline_id: string; keywords: unknown[] } => !!r && typeof r === "object" && typeof (r as Route).pipeline_id === "string" && Array.isArray((r as Route).keywords))
    .map((r) => ({ pipeline_id: r.pipeline_id, keywords: r.keywords.filter((k): k is string => typeof k === "string") }));
}

/** Funil indicado pelas rotas da empresa para esta mensagem (null = usar o funil padrão). */
export async function routePipeline(admin: SupabaseClient, companyId: string, text: string | null | undefined): Promise<string | null> {
  if (!text) return null;
  const { data } = await admin.from("lead_distribution").select("routes").eq("company_id", companyId).maybeSingle<{ routes: unknown }>();
  const pipelineId = matchRoute(parseRoutes(data?.routes), text);
  if (!pipelineId) return null;
  // A rota só vale para funil da própria empresa.
  const { data: p } = await admin.from("pipelines").select("id").eq("id", pipelineId).eq("company_id", companyId).maybeSingle<{ id: string }>();
  return p?.id ?? null;
}
