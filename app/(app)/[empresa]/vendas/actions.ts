"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Apaga um período importado por engano (só gestor/admin; o RLS confere de novo). */
export async function deleteSalesPeriod(slug: string, reportId: string): Promise<ActionResult> {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : null;
  if (!company || !isManager(company.role)) return { ok: false, error: "Só gestor ou administrador apaga períodos." };
  if (!z.uuid().safeParse(reportId).success) return { ok: false, error: "Período inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("sales_reports").delete().eq("id", reportId).eq("company_id", company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível apagar o período." };
  revalidatePath(`/${slug}/vendas`);
  return { ok: true, message: "Período apagado do histórico." };
}
