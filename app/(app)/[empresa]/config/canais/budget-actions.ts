"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const schema = z.number().int().min(0, "O limite não pode ser negativo.").max(100000).nullable();

/** Limite mensal de mensagens pagas: gestor com acesso às configurações ou admin (o RLS confere de novo). null = sem limite. */
export async function savePaidBudget(slug: string, limit: number | null): Promise<ActionResult> {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : undefined;
  if (!company?.canConfigure) return { ok: false, error: "Só gestor com acesso às configurações ou administrador altera o limite." };
  const parsed = schema.safeParse(limit);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Limite inválido." };

  const supabase = await createClient();
  const { error } =
    parsed.data === null
      ? await supabase.from("whatsapp_paid_budget").delete().eq("company_id", company.id)
      : await supabase
          .from("whatsapp_paid_budget")
          .upsert({ company_id: company.id, monthly_limit: parsed.data, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return { ok: false, error: "Não foi possível salvar. Confira se a migration 0026 foi rodada." };

  revalidatePath(`/${slug}/config/canais`);
  revalidatePath(`/${slug}/conversas`);
  return { ok: true, message: parsed.data === null ? "Limite removido." : `Limite salvo: ${parsed.data} mensagens pagas por mês.` };
}
