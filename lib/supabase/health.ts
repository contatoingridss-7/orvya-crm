import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type DbHealth =
  | { state: "offline"; message: string }
  | { state: "no-schema" }
  | { state: "schema-ok"; counts: Record<string, number> | null };

const SEED_TABLES = ["companies", "pipelines", "stages", "automation_rules", "products", "whatsapp_numbers"] as const;

/**
 * Diagnóstico da Fase 0: o projeto responde? A migration foi aplicada? O seed entrou?
 * As contagens só aparecem com a service_role configurada (sem login, o RLS esconde tudo).
 */
export async function checkDatabase(): Promise<DbHealth> {
  const supabase = await createClient();
  // GET (não HEAD): a resposta HEAD não traz corpo, e o erro de tabela inexistente vem sem código.
  const { error, status } = await supabase.from("companies").select("id").limit(1);

  if (error) {
    // PGRST205 / 42P01 / 404: a tabela não existe (migration ainda não aplicada)
    if (error.code === "PGRST205" || error.code === "42P01" || status === 404) return { state: "no-schema" };
    return { state: "offline", message: error.message };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { state: "schema-ok", counts: null };

  const admin = createAdminClient();
  const results = await Promise.all(
    SEED_TABLES.map(async (table) => {
      const { count } = await admin.from(table).select("id", { head: true, count: "exact" });
      return [table, count ?? 0] as const;
    }),
  );
  return { state: "schema-ok", counts: Object.fromEntries(results) };
}
