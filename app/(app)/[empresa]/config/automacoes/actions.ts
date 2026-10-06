"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Automações: gestor e admin editam (SPEC 1); o RLS confere de novo. */
async function managerContext(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company || !isManager(company.role)) return null;
  return { company, supabase: await createClient() };
}

const NOT_ALLOWED: ActionResult = { ok: false, error: "Só gestor ou administrador altera as automações." };

const ruleSchema = z.object({
  pipelineId: z.uuid(),
  stageId: z.uuid("Escolha a etapa."),
  taskTitle: z.string().trim().min(3, "Descreva a tarefa.").max(200),
  dueInDays: z.coerce.number().int().min(0, "Prazo inválido.").max(365, "Prazo de no máximo 365 dias."),
});

export async function createRule(slug: string, input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const { data: stage } = await ctx.supabase
    .from("stages")
    .select("id, kind")
    .eq("id", d.stageId)
    .eq("pipeline_id", d.pipelineId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; kind: string }>();
  if (!stage) return { ok: false, error: "Etapa não encontrada neste funil." };
  if (stage.kind === "lost") return { ok: false, error: "Não é possível criar tarefa automática para lead perdido." };

  const { error } = await ctx.supabase.from("automation_rules").insert({
    company_id: ctx.company.id,
    pipeline_id: d.pipelineId,
    stage_id: d.stageId,
    task_title: d.taskTitle,
    due_in_days: d.dueInDays,
    enabled: true,
  });
  if (error) return { ok: false, error: "Não foi possível criar a regra." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: "Regra criada. Vale para os leads que entrarem na etapa a partir de agora." };
}

export async function toggleRule(slug: string, ruleId: string, enabled: boolean): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data, error } = await ctx.supabase.from("automation_rules").update({ enabled }).eq("id", ruleId).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível alterar a regra." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: enabled ? "Regra ligada." : "Regra desligada." };
}

export async function deleteRule(slug: string, ruleId: string): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data, error } = await ctx.supabase.from("automation_rules").delete().eq("id", ruleId).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível excluir a regra." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: "Regra excluída. As tarefas que ela já criou continuam." };
}
