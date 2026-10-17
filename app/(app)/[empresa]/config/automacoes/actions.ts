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
  trigger: z.enum(["stage", "delivered", "stale"]).default("stage"),
  afterDays: z.coerce.number().int().min(1, "Informe há quantos dias parado.").max(365).optional(),
  repeatDays: z.coerce.number().int().min(1, "Repetição inválida.").max(365).optional(),
});

export async function createRule(slug: string, input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  const { data: stage } = await ctx.supabase
    .from("stages")
    .select("id, kind, logistics")
    .eq("id", d.stageId)
    .eq("pipeline_id", d.pipelineId)
    .eq("company_id", ctx.company.id)
    .maybeSingle<{ id: string; kind: string; logistics: string | null }>();
  if (!stage) return { ok: false, error: "Etapa não encontrada neste funil." };
  if (stage.kind === "lost") return { ok: false, error: "Não é possível criar tarefa automática para lead perdido." };
  if (d.trigger === "delivered" && !stage.logistics) return { ok: false, error: "A opção ao entregar só vale para etapas de entrega ou adaptação." };
  if (d.trigger === "stale" && !d.afterDays) return { ok: false, error: "Informe há quantos dias o lead está parado." };
  if (d.trigger === "stale" && stage.kind !== "open") return { ok: false, error: "Parado na etapa só vale para etapas em aberto." };

  const { error } = await ctx.supabase.from("automation_rules").insert({
    company_id: ctx.company.id,
    pipeline_id: d.pipelineId,
    stage_id: d.stageId,
    task_title: d.taskTitle,
    due_in_days: d.dueInDays,
    enabled: true,
    trigger_event: d.trigger,
    after_days: d.trigger === "stale" ? d.afterDays : null,
    repeat_days: d.trigger === "stale" ? null : (d.repeatDays ?? null),
  });
  if (error) return { ok: false, error: "Não foi possível criar a regra." };
  revalidatePath(`/${slug}/config/automacoes`);
  return {
    ok: true,
    message:
      d.trigger === "delivered"
        ? "Regra criada. Vale para as próximas entregas confirmadas pela expedição."
        : d.trigger === "stale"
          ? "Regra criada. O CRM confere os leads parados de hora em hora."
          : "Regra criada. Vale para os leads que entrarem na etapa a partir de agora.",
  };
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

// ---------------------------------------------------------------------
// Tarefas prontas ("O que precisa ser feito")
// ---------------------------------------------------------------------
const templateSchema = z.object({
  title: z.string().trim().min(3, "Escreva a tarefa.").max(200),
  pipelineId: z.string(),
});

export async function createTemplate(slug: string, input: z.input<typeof templateSchema>): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;
  if (d.pipelineId) {
    const { data: p } = await ctx.supabase.from("pipelines").select("id").eq("id", d.pipelineId).eq("company_id", ctx.company.id).maybeSingle();
    if (!p) return { ok: false, error: "Funil não encontrado." };
  }
  const { error } = await ctx.supabase
    .from("task_templates")
    .insert({ company_id: ctx.company.id, pipeline_id: d.pipelineId || null, title: d.title, position: 100 });
  if (error) return { ok: false, error: "Não foi possível salvar a tarefa pronta." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: "Tarefa pronta incluída. Já aparece para a equipe." };
}

export async function toggleTemplate(slug: string, id: string, active: boolean): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data, error } = await ctx.supabase.from("task_templates").update({ active }).eq("id", id).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível alterar a tarefa pronta." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: active ? "Tarefa pronta ligada." : "Tarefa pronta escondida da lista." };
}

export async function deleteTemplate(slug: string, id: string): Promise<ActionResult> {
  const ctx = await managerContext(slug);
  if (!ctx) return NOT_ALLOWED;
  const { data, error } = await ctx.supabase.from("task_templates").delete().eq("id", id).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível excluir a tarefa pronta." };
  revalidatePath(`/${slug}/config/automacoes`);
  return { ok: true, message: "Tarefa pronta excluída." };
}
