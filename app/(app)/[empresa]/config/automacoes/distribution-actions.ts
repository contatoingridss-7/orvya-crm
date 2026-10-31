"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { normalizeKeyword } from "@/lib/crm/routing";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const schema = z.object({
  enabled: z.boolean(),
  routes: z.array(z.object({ pipelineId: z.uuid(), keywords: z.string().max(500) })).max(20),
  workDays: z.record(z.uuid(), z.array(z.number().int().min(1).max(7)).max(7)),
});

/** Rodízio e direcionamento por palavra-chave: admin, ou gestor com acesso às configurações (o RLS confere de novo). */
export async function saveDistribution(slug: string, input: z.input<typeof schema>): Promise<ActionResult> {
  const viewer = await getViewer();
  const company = viewer?.active ? viewer.companies.find((c) => c.slug === slug) : undefined;
  if (!company?.canConfigure) return { ok: false, error: "Só gestor com acesso às configurações ou administrador altera a distribuição." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const routes = d.routes
    .map((r) => ({ pipeline_id: r.pipelineId, keywords: [...new Set(r.keywords.split(",").map(normalizeKeyword).filter((k) => k.length >= 3))].slice(0, 20) }))
    .filter((r) => r.keywords.length > 0);
  const workDays = Object.fromEntries(Object.entries(d.workDays).map(([id, days]) => [id, [...new Set(days)].sort()]));

  const supabase = await createClient();
  const { error } = await supabase
    .from("lead_distribution")
    .upsert({ company_id: company.id, enabled: d.enabled, routes, work_days: workDays, updated_at: new Date().toISOString() }, { onConflict: "company_id" });
  if (error) return { ok: false, error: "Não foi possível salvar. Confira se a migration 0020 foi rodada." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: d.enabled ? "Distribuição salva. O rodízio está ligado." : "Distribuição salva. O rodízio está desligado." };
}
