"use server";

import { revalidatePath } from "next/cache";
import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";
import { isManager } from "@/lib/auth/roles";
import { getViewer } from "@/lib/auth/viewer";
import { TIMEZONE } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function context(slug: string) {
  const viewer = await getViewer();
  if (!viewer?.active) return null;
  const company = viewer.companies.find((c) => c.slug === slug);
  if (!company) return null;
  return { viewer, company, manager: isManager(company.role), supabase: await createClient() };
}

const NO_ACCESS = { ok: false as const, error: "Sem acesso a esta empresa." };

function refresh(slug: string) {
  revalidatePath(`/${slug}/tarefas`);
  revalidatePath(`/${slug}/funil`);
}

const createSchema = z.object({
  title: z.string().trim().min(3, "Descreva a tarefa.").max(200),
  leadId: z.string(),
  // "2026-10-06T09:00" no horário de Teresina (campo datetime-local)
  dueLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Informe o prazo."),
  ownerId: z.string(),
});

export async function createTask(slug: string, input: z.input<typeof createSchema>): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const d = parsed.data;

  // Vendedor só cria tarefa para si (SPEC 4.7); o RLS também exige isso.
  const ownerId = ctx.manager ? d.ownerId || ctx.viewer.id : ctx.viewer.id;

  if (d.leadId) {
    const { data: lead } = await ctx.supabase.from("leads").select("id").eq("id", d.leadId).eq("company_id", ctx.company.id).maybeSingle();
    if (!lead) return { ok: false, error: "Lead não encontrado." };
  }

  const { error } = await ctx.supabase.from("tasks").insert({
    company_id: ctx.company.id,
    lead_id: d.leadId || null,
    title: d.title,
    due_at: fromZonedTime(d.dueLocal, TIMEZONE).toISOString(),
    owner_id: ownerId,
    created_by: ctx.viewer.id,
    origin: "manual",
  });
  if (error) return { ok: false, error: "Não foi possível criar a tarefa." };

  refresh(slug);
  return { ok: true, message: "Tarefa criada." };
}

/** Concluir ou reabrir. Só o responsável pela tarefa ou gestor (RLS). */
export async function setTaskDone(slug: string, taskId: string, done: boolean): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const { data, error } = await ctx.supabase
    .from("tasks")
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq("id", taskId)
    .eq("company_id", ctx.company.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Só o responsável pela tarefa ou o gestor pode alterá-la." };
  refresh(slug);
  return { ok: true, message: done ? "Tarefa concluída." : "Tarefa reaberta." };
}

/** Adia o prazo em N dias, mantendo o horário. */
export async function postponeTask(slug: string, taskId: string, days: number): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  if (!Number.isInteger(days) || days < 1 || days > 30) return { ok: false, error: "Prazo inválido." };

  const { data: task } = await ctx.supabase.from("tasks").select("due_at").eq("id", taskId).maybeSingle<{ due_at: string }>();
  if (!task) return { ok: false, error: "Tarefa não encontrada." };
  // Tarefa atrasada é adiada a partir de hoje, não do prazo antigo.
  const base = Math.max(new Date(task.due_at).getTime(), Date.now());
  const due = new Date(base + days * 86_400_000).toISOString();

  const { data, error } = await ctx.supabase.from("tasks").update({ due_at: due }).eq("id", taskId).select("id");
  if (error || !data?.length) return { ok: false, error: "Só o responsável pela tarefa ou o gestor pode adiá-la." };
  refresh(slug);
  return { ok: true, message: days === 1 ? "Tarefa adiada para amanhã." : `Tarefa adiada em ${days} dias.` };
}

/** Excluir: quem criou a tarefa ou gestor (RLS). */
export async function deleteTask(slug: string, taskId: string): Promise<ActionResult> {
  const ctx = await context(slug);
  if (!ctx) return NO_ACCESS;
  const { data, error } = await ctx.supabase.from("tasks").delete().eq("id", taskId).eq("company_id", ctx.company.id).select("id");
  if (error || !data?.length) return { ok: false, error: "Só quem criou a tarefa ou o gestor pode excluí-la." };
  refresh(slug);
  return { ok: true, message: "Tarefa excluída." };
}
