import "server-only";
import type { createClient } from "@/lib/supabase/server";

// Limite mensal de mensagens pagas (modelos) por empresa — migration 0026.
// Sem limite cadastrado = livre. Passou do limite: vendedor usa o link grátis; gestor/admin seguem.

/** missing = tabela ainda não existe (migration 0026 não rodada): fica sem limite. */
export type PaidBudget = { used: number; limit: number | null; missing?: boolean };

type Db = Awaited<ReturnType<typeof createClient>>;

export async function loadPaidBudget(supabase: Db, companyId: string): Promise<PaidBudget> {
  const [usedRes, limitRes] = await Promise.all([
    supabase.rpc("paid_messages_this_month", { p_company: companyId }),
    supabase.from("whatsapp_paid_budget").select("monthly_limit").eq("company_id", companyId).maybeSingle<{ monthly_limit: number }>(),
  ]);
  return { used: typeof usedRes.data === "number" ? usedRes.data : 0, limit: limitRes.data?.monthly_limit ?? null, missing: !!limitRes.error };
}

/** Mensagem de bloqueio para o vendedor que passou do limite (null = pode enviar). */
export function budgetBlock(b: PaidBudget, manager: boolean): string | null {
  if (manager || b.limit === null || b.used < b.limit) return null;
  return `A empresa já usou as ${b.limit} mensagens pagas deste mês. Use o link grátis ou peça ao gestor para enviar.`;
}
